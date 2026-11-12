"""DB 를 읽고 쓰며 규칙 엔진을 부르는 업무 로직."""
from __future__ import annotations

import calendar
import json
import re
import sqlite3
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional

from . import alerts as A
from . import db
from . import rules as R
from .parse_neis import normalize_id

WEEKDAYS = "월화수목금토일"
DEFAULT_REASONS = ["학원 수강", "숙려제", "자퇴", "위탁 교육", "병원 진료 미처리"]


class AppError(Exception):
    def __init__(self, message: str, status: int = 400, data: Any = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.data = data


# ================================================================ 설정

def default_settings() -> Dict[str, Any]:
    today = date.today()
    return {
        "setup_done": False,
        "school_name": "",
        "current_year": today.year if today.month >= 3 else today.year - 1,
        "grades": [3],
        "rules": R.merge_rules(None),
        "minutes_defaults": {},
        "recent_reasons": list(DEFAULT_REASONS),
    }


def get_settings(conn: sqlite3.Connection) -> Dict[str, Any]:
    s = default_settings()
    stored = db.all_settings(conn)
    s.update({k: v for k, v in stored.items() if v is not None})
    s["rules"] = R.merge_rules(s.get("rules"))
    s["grades"] = sorted({int(g) for g in (s.get("grades") or [3])})
    s["current_year"] = int(s["current_year"])
    return s


def save_settings(conn: sqlite3.Connection, patch: Dict[str, Any]) -> Dict[str, Any]:
    allowed = {"setup_done", "school_name", "current_year", "grades", "rules", "minutes_defaults", "recent_reasons"}
    for k, v in patch.items():
        if k not in allowed:
            continue
        if k == "rules":
            v = R.merge_rules(v)
        db.set_setting(conn, k, v)
    return get_settings(conn)


def rules_of(conn: sqlite3.Connection) -> Dict[str, Any]:
    return get_settings(conn)["rules"]


def ensure_writable(conn: sqlite3.Connection, year: int) -> None:
    cur = get_settings(conn)["current_year"]
    if int(year) != int(cur):
        raise AppError("%d학년도 자료는 읽기 전용입니다. 현재 학년도는 %d학년도입니다" % (int(year), cur), 403)


def school_years(conn: sqlite3.Connection) -> List[int]:
    ys = {int(r[0]) for r in conn.execute("SELECT DISTINCT school_year FROM uploads")}
    ys |= {int(r[0]) for r in conn.execute("SELECT DISTINCT school_year FROM guidance")}
    ys.add(get_settings(conn)["current_year"])
    return sorted(ys, reverse=True)


# ================================================================ 기록 읽기

def data_months(conn: sqlite3.Connection, year: int, grade: Optional[int] = None) -> List[int]:
    q = "SELECT DISTINCT month FROM uploads WHERE school_year = ?"
    args: List[Any] = [year]
    if grade is not None:
        q += " AND grade = ?"
        args.append(grade)
    ms = [int(r[0]) for r in conn.execute(q, args)]
    return R.sort_months(ms, rules_of(conn)["start_month"])


def months_by_grade(conn: sqlite3.Connection, year: int) -> Dict[str, List[int]]:
    out: Dict[str, List[int]] = {}
    start = rules_of(conn)["start_month"]
    for r in conn.execute("SELECT DISTINCT grade, month FROM uploads WHERE school_year = ?", (year,)):
        out.setdefault(str(r["grade"]), []).append(int(r["month"]))
    return {g: R.sort_months(ms, start) for g, ms in out.items()}


def load_students(
    conn: sqlite3.Connection, year: int, grade: Optional[int] = None, student_id: Optional[str] = None
) -> Dict[str, Dict[str, Any]]:
    """{학번: {name, grade, class, number, records: {월: {abs,late,leave,result}}, raw: {월: raw}}}"""
    q = "SELECT * FROM monthly_records WHERE school_year = ?"
    args: List[Any] = [year]
    if grade is not None:
        q += " AND grade = ?"
        args.append(grade)
    if student_id:
        q += " AND student_id = ?"
        args.append(student_id)
    q += " ORDER BY student_id, month"
    out: Dict[str, Dict[str, Any]] = {}
    for r in conn.execute(q, args):
        s = out.setdefault(
            r["student_id"],
            {"student_id": r["student_id"], "name": r["name"], "grade": r["grade"], "class": r["class"],
             "number": r["number"], "records": {}, "raw": {}},
        )
        s["name"] = r["name"] or s["name"]
        s["records"][int(r["month"])] = {k: int(r[k] or 0) for k in R.ITEMS}
        try:
            s["raw"][int(r["month"])] = json.loads(r["raw_json"] or "{}")
        except ValueError:
            s["raw"][int(r["month"])] = {}
    return out


def _parse_exclusion(row: sqlite3.Row) -> Dict[str, Any]:
    d = dict(row)
    try:
        d["months"] = json.loads(d.get("months") or "{}")
    except ValueError:
        d["months"] = {}
    d["all_period"] = bool(d.get("all_period"))
    return d


def load_exclusions(conn: sqlite3.Connection, year: int) -> Dict[str, Dict[str, Any]]:
    return {
        r["student_id"]: _parse_exclusion(r)
        for r in conn.execute("SELECT * FROM exclusions WHERE school_year = ?", (year,))
    }


def load_guidance(conn: sqlite3.Connection, year: int) -> Dict[str, List[Dict[str, Any]]]:
    start = rules_of(conn)["start_month"]
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in conn.execute("SELECT * FROM guidance WHERE school_year = ? ORDER BY step, id", (year,)):
        out.setdefault(r["student_id"], []).append(dict(r))
    for lst in out.values():
        lst.sort(key=lambda g: (g.get("step") or 0, R.school_order(g["month"], start) if g.get("month") else -1))
    return out


def _cells(res: Dict[str, Any], key: str = "raw") -> Dict[str, int]:
    return {k: res[key][k] for k in R.ITEMS}


# ================================================================ ① 월별 미인정 조회

def lookup(conn: sqlite3.Connection, year: int, grade: int, months: Iterable[int], apply: bool = False) -> Dict[str, Any]:
    rules = rules_of(conn)
    months = list(months)
    students = load_students(conn, year, grade)
    excl = load_exclusions(conn, year)
    guid = load_guidance(conn, year)
    rows = []
    for sid, st in students.items():
        res = R.compute_student(st["records"], months, rules, excl.get(sid), guid.get(sid), apply_exclusions=True, apply_reset=apply)
        if not apply:
            # 원자료 그대로: 점수도 원자료로 환산
            sc, carry = R.score(res["raw"], rules)
            tot = res["raw"]
        else:
            sc, carry = res["score"], res["carry"]
            tot = res["eff"]
        if not any(tot.values()):
            continue
        rows.append({
            "student_id": sid, "name": st["name"], "class": st["class"], "number": st["number"],
            "totals": tot, "raw": res["raw"], "doc": res["doc"] if apply else _doc_annotations(res),
            "score": sc, "carry": carry, "months": res["months"],
            "has_exclusion": sid in excl,
        })
    rows.sort(key=lambda r: r["student_id"])
    return {"rows": rows, "months": R.sort_months(months, rules["start_month"])}


def _doc_annotations(res: Dict[str, Any]) -> Dict[str, int]:
    """원자료 보기에서도 「조퇴 10 (서류 7)」을 보여 주기 위한 제외 값 합계."""
    tot = R.empty_counts()
    for pm in res["months"]:
        tot = R.add_counts(tot, pm["doc"])
    return tot


# ================================================================ ③ 대상자 명단

def target_rows(conn: sqlite3.Connection, year: int, grade: int, months: Optional[Iterable[int]] = None) -> List[Dict[str, Any]]:
    rules = rules_of(conn)
    start = rules["start_month"]
    months = list(months) if months is not None else data_months(conn, year, grade)
    students = load_students(conn, year, grade)
    excl = load_exclusions(conn, year)
    guid = load_guidance(conn, year)
    open_alerts = {
        r["student_id"]: (r["n"], r["bt"])
        for r in conn.execute(
            "SELECT student_id, COUNT(*) n, MAX(became_target) bt FROM exclusion_alerts WHERE school_year = ? AND status = 'open' GROUP BY student_id",
            (year,),
        )
    }
    th = int(rules["threshold"])
    out = []
    for sid, st in students.items():
        g = guid.get(sid, [])
        res = R.compute_student(st["records"], months, rules, excl.get(sid), g)
        if res["score"] < th:
            continue
        stage = R.stage_info(len(g), rules, grade)
        last = g[-1] if g else None
        cs = R.counting_start(g, rules)
        out.append({
            "student_id": sid, "name": st["name"], "class": st["class"],
            "totals": res["eff"], "raw": res["raw"], "doc": res["doc"],
            "score": res["score"], "carry": res["carry"], "months": res["months"],
            "stage": stage, "guidance_count": len(g),
            "last_guidance": last, "count_from": cs if cs and cs > 0 else start,
            "alerts": open_alerts.get(sid, (0, 0))[0], "became_target": bool(open_alerts.get(sid, (0, 0))[1]),
        })
    out.sort(key=lambda r: (not r["became_target"], r["student_id"]))
    return out


def dashboard(conn: sqlite3.Connection, year: int, grade: int, lookup_months: List[int], target_months: List[int], apply: bool) -> Dict[str, Any]:
    lk = lookup(conn, year, grade, lookup_months, apply)
    tg = target_rows(conn, year, grade, target_months)
    excluded = conn.execute(
        "SELECT COUNT(*) FROM exclusions WHERE school_year = ? AND substr(student_id, 1, 1) = ?",
        (year, str(grade)),
    ).fetchone()[0]
    open_alerts = conn.execute(
        "SELECT COUNT(*) FROM exclusion_alerts WHERE school_year = ? AND status = 'open' AND substr(student_id,1,1) = ?",
        (year, str(grade)),
    ).fetchone()[0]
    return {
        "lookup": lk["rows"],
        "targets": tg,
        "summary": {"lookup": len(lk["rows"]), "targets": len(tg), "excluded": excluded, "alerts": open_alerts},
        "data_months": data_months(conn, year, grade),
    }


# ================================================================ 업로드 저장

def existing_months(conn: sqlite3.Connection, year: int, grades: Iterable[int], month: int) -> List[Dict[str, Any]]:
    out = []
    for g in grades:
        r = conn.execute(
            "SELECT * FROM uploads WHERE school_year = ? AND grade = ? AND month = ?", (year, g, month)
        ).fetchone()
        if r:
            out.append(dict(r))
    return out


def save_upload(
    conn: sqlite3.Connection, parsed: Dict[str, Any], year: int, month: int, grades: Iterable[int], file_name: str
) -> Dict[str, Any]:
    """체크한 학년만 (학년도, 학년, 월) 단위로 덮어써서 저장한다."""
    ensure_writable(conn, year)
    saved: Dict[str, int] = {}
    for g in sorted({int(x) for x in grades}):
        conn.execute("DELETE FROM uploads WHERE school_year = ? AND grade = ? AND month = ?", (year, g, month))
        conn.execute("DELETE FROM monthly_records WHERE school_year = ? AND grade = ? AND month = ?", (year, g, month))
        studs = [s for s in parsed["students"] if s["grade"] == g]
        cur = conn.execute(
            "INSERT INTO uploads(school_year, grade, month, period_from, period_to, file_name, student_count) VALUES(?,?,?,?,?,?,?)",
            (year, g, month, parsed.get("period_from"), parsed.get("period_to"), file_name, len(studs)),
        )
        uid = cur.lastrowid
        conn.executemany(
            "INSERT INTO monthly_records(school_year, grade, month, class, number, student_id, name, abs, late, leave, result, raw_json, upload_id)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (year, g, month, s["class"], s["number"], s["student_id"], s["name"], s["abs"], s["late"], s["leave"],
                 s["result"], json.dumps(s["raw"], ensure_ascii=False), uid)
                for s in studs
            ],
        )
        saved[str(g)] = len(studs)
    new_alerts = sync_alerts(conn, year)
    st = get_settings(conn)
    if not st.get("school_name") and parsed.get("school_name"):
        db.set_setting(conn, "school_name", parsed["school_name"])
    return {"saved": saved, "new_alerts": new_alerts}


def list_uploads(conn: sqlite3.Connection, year: int) -> List[Dict[str, Any]]:
    start = rules_of(conn)["start_month"]
    rows = [dict(r) for r in conn.execute("SELECT * FROM uploads WHERE school_year = ?", (year,))]
    rows.sort(key=lambda r: (r["grade"], R.school_order(r["month"], start)))
    return rows


def delete_upload(conn: sqlite3.Connection, upload_id: int) -> None:
    r = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if not r:
        raise AppError("업로드 기록이 없습니다", 404)
    ensure_writable(conn, r["school_year"])
    conn.execute("DELETE FROM monthly_records WHERE upload_id = ?", (upload_id,))
    conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
    sync_alerts(conn, r["school_year"])


# ================================================================ 학생 찾기

def student_info(conn: sqlite3.Connection, year: int, sid: str) -> Optional[Dict[str, Any]]:
    sid = normalize_id(sid)
    if not sid:
        return None
    st = load_students(conn, year, student_id=sid).get(sid)
    if not st:
        r = conn.execute(
            "SELECT student_id, name, grade FROM monthly_records WHERE student_id = ? ORDER BY school_year DESC LIMIT 1", (sid,)
        ).fetchone()
        if not r:
            return None
        return {"student_id": sid, "name": r["name"], "grade": r["grade"], "records": {}}
    return {"student_id": sid, "name": st["name"], "grade": st["grade"], "class": st["class"],
            "records": {str(m): v for m, v in st["records"].items()}}


# ================================================================ 제외

def list_exclusions(conn: sqlite3.Connection, year: int) -> List[Dict[str, Any]]:
    excl = load_exclusions(conn, year)
    students = load_students(conn, year)
    out = []
    for sid, e in sorted(excl.items()):
        st = students.get(sid)
        e["records"] = {str(m): v for m, v in (st["records"].items() if st else [])}
        e["name"] = e.get("name") or (st["name"] if st else "")
        out.append(e)
    return out


def _validate_exclusion(e: Dict[str, Any], records: Dict[int, Dict[str, int]]) -> None:
    for m, ents in (e.get("months") or {}).items():
        if not isinstance(ents, list):
            raise AppError("%s월 항목 형식이 올바르지 않습니다" % m)
        for ent in ents:
            if not str(ent.get("reason", "")).strip():
                raise AppError("%s월 사유를 입력해 주십시오" % m)
            if ent.get("mode") not in ("all", "documented"):
                raise AppError("%s월 제외 방식을 골라 주십시오" % m)
        rec = records.get(int(m))
        if rec is None:
            continue
        for k in R.ITEMS:
            tot = sum(int((ent.get("counts") or {}).get(k, 0) or 0) for ent in ents if ent.get("mode") == "documented")
            if tot > rec[k]:
                raise AppError("%s월 %s: 기록은 %d회입니다. 서류 횟수 %d회는 기록보다 많습니다" % (m, R.ITEM_LABELS[k], rec[k], tot))


def save_exclusion(conn: sqlite3.Connection, year: int, e: Dict[str, Any]) -> Dict[str, Any]:
    ensure_writable(conn, year)
    sid = normalize_id(e.get("student_id"))
    if not sid:
        raise AppError("학번을 입력해 주십시오")
    st = load_students(conn, year, student_id=sid).get(sid)
    records = st["records"] if st else {}
    months = {str(int(m)): ents for m, ents in (e.get("months") or {}).items() if ents}
    for ents in months.values():
        for ent in ents:
            ent["reason"] = str(ent.get("reason", "")).strip()
            if ent.get("mode") == "documented":
                ent["counts"] = {k: max(0, int((ent.get("counts") or {}).get(k, 0) or 0)) for k in R.ITEMS}
            else:
                ent.pop("counts", None)
    e = dict(e, months=months)
    all_period = bool(e.get("all_period"))
    if all_period and not str(e.get("all_reason") or "").strip():
        raise AppError("전체 기간 제외 사유를 입력해 주십시오")
    if not all_period:
        _validate_exclusion(e, records)
    if not all_period and not months:
        raise AppError("제외할 달을 하나 이상 고르십시오")
    name = (e.get("name") or (st["name"] if st else "") or "").strip()
    conn.execute(
        "INSERT INTO exclusions(school_year, student_id, name, all_period, all_reason, months, note, updated_at)"
        " VALUES(?,?,?,?,?,?,?,datetime('now','localtime'))"
        " ON CONFLICT(school_year, student_id) DO UPDATE SET name=excluded.name, all_period=excluded.all_period,"
        " all_reason=excluded.all_reason, months=excluded.months, note=excluded.note, updated_at=excluded.updated_at",
        (year, sid, name, 1 if all_period else 0, (e.get("all_reason") or "").strip(),
         json.dumps(months, ensure_ascii=False), e.get("note") or ""),
    )
    # 최근 쓴 사유 목록
    reasons = [e.get("all_reason")] if all_period else [ent["reason"] for ents in months.values() for ent in ents]
    st_all = get_settings(conn)
    recent = [r for r in reasons if r] + [r for r in st_all.get("recent_reasons", []) if r not in reasons]
    db.set_setting(conn, "recent_reasons", recent[:12])
    new_alerts = sync_alerts(conn, year)
    row = conn.execute("SELECT * FROM exclusions WHERE school_year = ? AND student_id = ?", (year, sid)).fetchone()
    return {"exclusion": _parse_exclusion(row), "new_alerts": new_alerts}


def delete_exclusion(conn: sqlite3.Connection, ex_id: int) -> None:
    r = conn.execute("SELECT * FROM exclusions WHERE id = ?", (ex_id,)).fetchone()
    if not r:
        raise AppError("제외 기록이 없습니다", 404)
    ensure_writable(conn, r["school_year"])
    conn.execute("DELETE FROM exclusions WHERE id = ?", (ex_id,))
    sync_alerts(conn, r["school_year"])


# ================================================================ 알림

def sync_alerts(conn: sqlite3.Connection, year: int) -> int:
    """알림을 지금 기록·제외 상태에 맞춘다. 새로 생긴 알림 수를 돌려준다.

    같은 (학생, 달, 항목, 기록 횟수, 서류 횟수) 알림은 상태(확인함)를 유지한다.
    기록이나 서류 횟수가 바뀌면 키가 달라져 새 알림으로 다시 뜬다.
    """
    rules = rules_of(conn)
    excl = load_exclusions(conn, year)
    guid = load_guidance(conn, year)
    students = load_students(conn, year)
    want: Dict[tuple, Dict[str, Any]] = {}
    for sid, e in excl.items():
        st = students.get(sid)
        if not st:
            continue
        for a in A.compute_alerts(st["records"], e, rules, guid.get(sid)):
            want[(sid, a["month"], a["item"], a["recorded"], a["documented"])] = a
    have = {
        (r["student_id"], r["month"], r["item"], r["recorded"], r["documented"]): r["id"]
        for r in conn.execute("SELECT * FROM exclusion_alerts WHERE school_year = ?", (year,))
    }
    for key, aid in have.items():
        if key not in want:
            conn.execute("DELETE FROM exclusion_alerts WHERE id = ?", (aid,))
        else:
            a = want[key]
            conn.execute(
                "UPDATE exclusion_alerts SET kind = ?, reason = ?, became_target = ? WHERE id = ?",
                (a["kind"], a["reason"], 1 if a.get("became_target") else 0, aid),
            )
    new = 0
    for key, a in want.items():
        if key in have:
            continue
        conn.execute(
            "INSERT INTO exclusion_alerts(school_year, student_id, month, item, recorded, documented, kind, reason, became_target)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (year, key[0], key[1], key[2], key[3], key[4], a["kind"], a["reason"], 1 if a.get("became_target") else 0),
        )
        new += 1
    return new


def list_alerts(conn: sqlite3.Connection, year: int, status: Optional[str] = None, grade: Optional[int] = None) -> List[Dict[str, Any]]:
    start = rules_of(conn)["start_month"]
    q = "SELECT * FROM exclusion_alerts WHERE school_year = ?"
    args: List[Any] = [year]
    if status:
        q += " AND status = ?"
        args.append(status)
    if grade:
        q += " AND substr(student_id,1,1) = ?"
        args.append(str(grade))
    names = {}
    for r in conn.execute("SELECT student_id, name, class FROM monthly_records WHERE school_year = ?", (year,)):
        names[r["student_id"]] = (r["name"], r["class"])
    out = []
    for r in conn.execute(q, args):
        d = dict(r)
        nm, cl = names.get(d["student_id"], ("", None))
        d["name"] = nm
        d["class"] = cl if cl is not None else int(d["student_id"][1:3])
        d["missing"] = d["recorded"] - d["documented"]
        d["text"] = A.alert_text(d, nm)
        out.append(d)
    out.sort(key=lambda d: (not d["became_target"], d["status"] != "open", d["student_id"], R.school_order(d["month"], start), R.ITEMS.index(d["item"])))
    return out


def ack_alert(conn: sqlite3.Connection, alert_id: int, status: str = "acknowledged") -> None:
    r = conn.execute("SELECT * FROM exclusion_alerts WHERE id = ?", (alert_id,)).fetchone()
    if not r:
        raise AppError("알림이 없습니다", 404)
    ensure_writable(conn, r["school_year"])
    conn.execute("UPDATE exclusion_alerts SET status = ? WHERE id = ?", (status, alert_id))


def alerts_xlsx(conn: sqlite3.Connection, year: int, grade: Optional[int] = None) -> bytes:
    import io

    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill

    rows = [a for a in list_alerts(conn, year, None, grade) if a["status"] == "open"]
    wb = openpyxl.Workbook()
    head = ["반", "학번", "이름", "달", "항목", "기록 횟수", "서류 횟수", "서류에 없는 횟수", "사유", "비고"]

    def fill(ws, items):
        ws.append(head)
        for c in ws[1]:
            c.font = Font(bold=True)
            c.fill = PatternFill("solid", fgColor="EFEAE0")
            c.alignment = Alignment(horizontal="center")
        for a in items:
            ws.append([a["class"], a["student_id"], a["name"], "%d월" % a["month"], "미인정 " + R.ITEM_LABELS[a["item"]],
                       a["recorded"], a["documented"], a["missing"], a.get("reason") or "",
                       ("대상자 됨" if a["became_target"] else "") + (" · 서류 미등록" if a["kind"] == "undocumented" else "")])
        widths = [6, 9, 10, 6, 12, 10, 10, 15, 18, 18]
        for i, w in enumerate(widths):
            ws.column_dimensions[chr(65 + i)].width = w

    ws = wb.active
    ws.title = "전체"
    rows.sort(key=lambda a: (a["class"] or 0, a["student_id"]))
    fill(ws, rows)
    for cl in sorted({a["class"] for a in rows}):
        fill(wb.create_sheet("%d반" % cl), [a for a in rows if a["class"] == cl])
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


# ================================================================ 생활지도 이력

def parse_month_num(v: Any) -> int:
    """"5월", "5", 5 → 5. 1~12 사이 값이 없으면 0 (Code.gs parseMonthNum_)"""
    if v is None:
        return 0
    for s in re.findall(r"\d+", str(v)):
        n = int(s)
        if 1 <= n <= 12:
            return n
    return 0


def list_guidance(conn: sqlite3.Connection, year: int, grade: Optional[int] = None) -> List[Dict[str, Any]]:
    q = "SELECT g.*, m.seq AS meeting_seq FROM guidance g LEFT JOIN meetings m ON m.id = g.meeting_id WHERE g.school_year = ?"
    args: List[Any] = [year]
    if grade:
        q += " AND g.grade = ?"
        args.append(grade)
    q += " ORDER BY g.student_id, g.step, g.id"
    return [dict(r) for r in conn.execute(q, args)]


def save_guidance(conn: sqlite3.Connection, year: int, g: Dict[str, Any], gid: Optional[int] = None) -> Dict[str, Any]:
    ensure_writable(conn, year)
    sid = normalize_id(g.get("student_id"))
    if not sid:
        raise AppError("학번을 입력해 주십시오")
    month = int(g.get("month") or 0) or None
    if month is not None and not 1 <= month <= 12:
        raise AppError("실시 월이 올바르지 않습니다")
    name = (g.get("name") or "").strip()
    if not name:
        info = student_info(conn, year, sid)
        name = info["name"] if info else ""
    grade = int(g.get("grade") or sid[0])
    step = g.get("step")
    if not step:
        n = conn.execute("SELECT COUNT(*) FROM guidance WHERE school_year = ? AND student_id = ?", (year, sid)).fetchone()[0]
        step = n + 1 if gid is None else n
    vals = (sid, name, grade, int(step), month, g.get("date") or "", g.get("measure") or "", g.get("note") or "")
    if gid is None:
        cur = conn.execute(
            "INSERT INTO guidance(school_year, student_id, name, grade, step, month, date, measure, note, meeting_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (year,) + vals + (g.get("meeting_id"),),
        )
        gid = cur.lastrowid
    else:
        r = conn.execute("SELECT * FROM guidance WHERE id = ?", (gid,)).fetchone()
        if not r:
            raise AppError("기록이 없습니다", 404)
        conn.execute(
            "UPDATE guidance SET student_id=?, name=?, grade=?, step=?, month=?, date=?, measure=?, note=? WHERE id = ?",
            vals + (gid,),
        )
    sync_alerts(conn, year)
    return dict(conn.execute("SELECT * FROM guidance WHERE id = ?", (gid,)).fetchone())


def delete_guidance(conn: sqlite3.Connection, gid: int) -> None:
    r = conn.execute("SELECT * FROM guidance WHERE id = ?", (gid,)).fetchone()
    if not r:
        raise AppError("기록이 없습니다", 404)
    ensure_writable(conn, r["school_year"])
    conn.execute("DELETE FROM guidance WHERE id = ?", (gid,))
    sync_alerts(conn, r["school_year"])


def _paste_rows(text: str) -> List[List[str]]:
    rows = []
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        cells = line.split("\t") if "\t" in line else re.split(r"\s{2,}|,", line)
        rows.append([c.strip() for c in cells])
    return rows


def import_paste(conn: sqlite3.Connection, year: int, kind: str, text: str) -> Dict[str, Any]:
    """기존 시트의 2️⃣(J:L: 학번·이름·사유) 또는 4️⃣(S:X: 학번·이름·1회·2회·3회·학생선도위원회) 붙여넣기."""
    ensure_writable(conn, year)
    rules = rules_of(conn)
    added, skipped = 0, 0
    for cells in _paste_rows(text):
        sid = normalize_id(cells[0]) if cells else ""
        if not sid or not re.search(r"\d", cells[0]) or len(re.sub(r"\D", "", cells[0])) < 4:
            skipped += 1  # 머리행 등
            continue
        name = cells[1] if len(cells) > 1 else ""
        if kind == "exclusion":
            reason = (cells[2] if len(cells) > 2 else "") or "기존 제외 명단"
            if conn.execute("SELECT 1 FROM exclusions WHERE school_year = ? AND student_id = ?", (year, sid)).fetchone():
                skipped += 1
                continue
            conn.execute(
                "INSERT INTO exclusions(school_year, student_id, name, all_period, all_reason, months, note) VALUES(?,?,?,?,?,?,?)",
                (year, sid, name, 1, reason, "{}", "기존 시트에서 옮겨 옴 — 달별 사유로 고쳐 주십시오"),
            )
            added += 1
        else:
            for i, v in enumerate(cells[2:6]):
                if not v:
                    continue
                step = i + 1
                if conn.execute(
                    "SELECT 1 FROM guidance WHERE school_year = ? AND student_id = ? AND step = ?", (year, sid, step)
                ).fetchone():
                    skipped += 1
                    continue
                month = parse_month_num(v) or None
                stage = R.stage_info(i, rules, int(sid[0]))
                conn.execute(
                    "INSERT INTO guidance(school_year, student_id, name, grade, step, month, measure, note) VALUES(?,?,?,?,?,?,?,?)",
                    (year, sid, name, int(sid[0]), step, month, stage["measure"] or stage["label"],
                     "기존 시트에서 옮겨 옴" + ("" if month else " (월 읽기 실패: %s)" % v)),
                )
                added += 1
    sync_alerts(conn, year)
    return {"added": added, "skipped": skipped}


# ================================================================ 개인별 통계

def personal(conn: sqlite3.Connection, year: int, sid: str) -> Dict[str, Any]:
    sid = normalize_id(sid)
    if not sid:
        raise AppError("학번을 입력해 주십시오")
    rules = rules_of(conn)
    st = load_students(conn, year, student_id=sid).get(sid)
    if not st:
        raise AppError("%d학년도 자료에서 %s 학생을 찾지 못했습니다" % (year, sid), 404)
    excl = load_exclusions(conn, year).get(sid)
    g = load_guidance(conn, year).get(sid, [])
    months = list(st["records"].keys())
    res = R.compute_student(st["records"], months, rules, excl, g)
    raw_score, raw_carry = R.score(res["raw"], rules)
    # 달마다 누적(초기화·제외 반영) 흐름
    running = []
    for i in range(len(res["months"])):
        upto = [pm["month"] for pm in res["months"][: i + 1]]
        r2 = R.compute_student(st["records"], upto, rules, excl, g)
        running.append({"month": upto[-1], "score": r2["score"], "carry": r2["carry"]})
    for pm, rn in zip(res["months"], running):
        pm["cum_score"], pm["cum_carry"] = rn["score"], rn["carry"]
        pm["detail"] = st["raw"].get(pm["month"], {})
    stage = R.stage_info(len(g), rules, st["grade"])
    return {
        "student_id": sid, "name": st["name"], "grade": st["grade"], "class": st["class"], "number": st["number"],
        "months": res["months"], "raw": res["raw"], "eff": res["eff"], "doc": res["doc"],
        "score": res["score"], "carry": res["carry"], "raw_score": raw_score, "raw_carry": raw_carry,
        "is_target": res["score"] >= int(rules["threshold"]), "next_stage": stage,
        "guidance": g, "exclusion": excl,
        "count_from": R.counting_start(g, rules),
    }


# ================================================================ 회의록 초안

def _korean_date(d: date) -> str:
    return "%d년 %d월 %d일 (%s)" % (d.year, d.month, d.day, WEEKDAYS[d.weekday()])


def calendar_year(school_year: int, month: int, start: int) -> int:
    return school_year if month >= start else school_year + 1


def _cell_text(rawv: int, docv: int, all_ex: bool, reasons: List[str]) -> str:
    if rawv == 0:
        return "-"
    if all_ex:
        return "%d (전체 제외%s)" % (rawv, ", " + ", ".join(reasons) if reasons else "")
    if docv:
        return "%d (서류 %d%s)" % (rawv, docv, ", " + ", ".join(reasons) if reasons else "")
    return str(rawv)


def counts_phrase(t: Dict[str, int], rules: Dict[str, Any]) -> str:
    parts = ["%s %d회" % (R.ITEM_LABELS[k], t[k]) for k in R.ITEMS if t.get(k)]
    if not parts:
        return "미인정 없음"
    return "미인정 " + ", ".join(parts)


def guidance_phrase(g: Dict[str, Any], rules: Dict[str, Any]) -> str:
    n = int((rules.get("stages") or {}).get("count", 3))
    step = int(g.get("step") or 0)
    what = "%d차 생활지도" % step if step and step <= n else (rules.get("stages") or {}).get("final_name", "학생선도위원회")
    return ("%d월 " % g["month"] if g.get("month") else "") + what


def student_minutes_block(
    conn: sqlite3.Connection, year: int, grade: int, sid: str, basis_month: int, include_year_total: bool = False
) -> Dict[str, Any]:
    rules = rules_of(conn)
    start = rules["start_month"]
    st = load_students(conn, year, student_id=sid).get(sid)
    if not st:
        raise AppError("%s 학생 기록이 없습니다" % sid, 404)
    excl = load_exclusions(conn, year).get(sid)
    g = load_guidance(conn, year).get(sid, [])
    dm = [m for m in R.sort_months(st["records"].keys(), start) if R.school_order(m, start) <= R.school_order(basis_month, start)]
    cs = R.counting_start(g, rules)
    period = [m for m in dm if R.month_counts_after_reset(m, g, rules)]
    res = R.compute_student(st["records"], period, rules, excl, g)
    month_rows = []
    for pm in res["months"]:
        if not any(pm["raw"].values()):
            continue
        cells = {k: _cell_text(pm["raw"][k], pm["doc"][k], pm["all_excluded"], pm["reasons"]) for k in R.ITEMS}
        month_rows.append({
            "month": pm["month"], "label": "%d월" % pm["month"],
            "abs": cells["abs"], "others": " / ".join([cells["late"], cells["leave"], cells["result"]]),
        })
    lines = []
    if g:
        lines.append(guidance_phrase(g[-1], rules))
    if period:
        p_from = period[0]
        if cs and cs > 0 and R.school_order(cs, start) > R.school_order(p_from, start):
            p_from = cs
        head = "%d월 합계:" % basis_month if p_from == basis_month else "%d~%d월 누적:" % (p_from, basis_month)
        lines.append("%s %s (환산 %d점)" % (head, counts_phrase(res["eff"], rules), res["score"]))
    else:
        lines.append("%d월까지 셀 기록 없음" % basis_month)
    if include_year_total and dm:
        whole = R.compute_student(st["records"], dm, rules, excl, g, apply_reset=False)
        lines.append("참고: %d~%d월 전체 누적 %s" % (dm[0], basis_month, counts_phrase(whole["eff"], rules)))
    stage = R.stage_info(len(g), rules, grade)
    measure = stage["measure"]
    return {
        "student_id": sid, "name": st["name"], "kind": "guidance",
        "step": stage["step"], "stage_short": stage["short"], "stage_final": stage["final"],
        "measure_text": ("(%s) %s" % (stage["short"], measure)).strip(),
        "months": month_rows, "total_lines": lines,
        "score": res["score"], "carry": res["carry"],
    }


def next_seq(conn: sqlite3.Connection, year: int, grade: int) -> int:
    r = conn.execute("SELECT MAX(seq) FROM meetings WHERE school_year = ? AND grade = ?", (year, grade)).fetchone()
    return int(r[0] or 0) + 1


def build_draft(conn: sqlite3.Connection, year: int, grade: int, student_ids: List[str],
                basis_month: Optional[int] = None, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    opts = opts or {}
    s = get_settings(conn)
    rules = s["rules"]
    start = rules["start_month"]
    dm = data_months(conn, year, grade)
    if basis_month is None:
        if not dm:
            raise AppError("%d학년 자료가 없습니다" % grade)
        basis_month = dm[-1]
    basis_month = int(basis_month)
    seq = int(opts.get("seq") or next_seq(conn, year, grade))
    defaults = (s.get("minutes_defaults") or {}).get(str(grade)) or {}
    mdate = opts.get("date") or date.today().isoformat()
    time_range = opts.get("time_range") if opts.get("time_range") is not None else defaults.get("time_range", "")
    include_year_total = bool(opts.get("include_year_total"))
    kinds = opts.get("kinds") or {}
    studs = []
    for sid in student_ids:
        sid = normalize_id(sid)
        b = student_minutes_block(conn, year, grade, sid, basis_month, include_year_total)
        b["kind"] = kinds.get(sid, "guidance")
        studs.append(b)
    cy = calendar_year(year, basis_month, start)
    last_day = calendar.monthrange(cy, basis_month)[1]
    dept = "%d학년부" % grade
    payload = {
        "school_year": year, "grade": grade, "seq": seq,
        "dept_name": dept, "start_month": start,
        "date": mdate, "time_range": time_range,
        "place": opts.get("place", defaults.get("place", "")),
        "chair": opts.get("chair", defaults.get("chair", "")),
        "members": opts.get("members", defaults.get("members", "")),
        "basis_month": basis_month,
        "guidance_month": basis_month,
        "basis_date_text": "%d. %d. %d." % (cy, basis_month, last_day),
        "basis_phrase": "%d월 미인정 결석 누적합 기준 초과" % basis_month,
        "crisis_text": "생활지도 진행하지 않음",
        "include_year_total": include_year_total,
        "students": studs,
    }
    fill_auto_texts(payload)
    return payload


def fill_auto_texts(p: Dict[str, Any], force: bool = True) -> Dict[str, Any]:
    """회차·일시·학생이 바뀌면 다시 만드는 글자들."""
    y, seq, dept = p["school_year"], p["seq"], p.get("dept_name") or "%d학년부" % p["grade"]
    p["title"] = "%d 제%d차 %s 학생선도 소위원회 회의록" % (y, seq, dept)
    p["agenda"] = "%d학년도 %d차 %s 학생선도 소위원회 회부 학생에 대한 회의" % (y, seq, dept)
    try:
        d = datetime.strptime(p["date"], "%Y-%m-%d").date()
        p["datetime_text"] = (_korean_date(d) + " " + (p.get("time_range") or "")).strip()
    except (ValueError, TypeError, KeyError):
        p["datetime_text"] = p.get("date") or ""
    names = ", ".join("%s %s" % (s["student_id"], s["name"]) for s in p.get("students", []))
    p["referred_line"] = "%s: %s" % (p.get("basis_phrase", ""), names)
    return p


# ================================================================ 회의록 저장

def _meeting_row(r: sqlite3.Row) -> Dict[str, Any]:
    d = dict(r)
    try:
        d["payload"] = json.loads(d.get("payload") or "{}")
    except ValueError:
        d["payload"] = {}
    return d


def list_meetings(conn: sqlite3.Connection, year: int) -> List[Dict[str, Any]]:
    out = []
    for r in conn.execute("SELECT * FROM meetings WHERE school_year = ? ORDER BY grade, seq DESC, id DESC", (year,)):
        d = _meeting_row(r)
        d["student_count"] = len(d["payload"].get("students", []))
        d["title"] = d["payload"].get("title", "")
        d.pop("payload")
        out.append(d)
    return out


def get_meeting(conn: sqlite3.Connection, mid: int) -> Dict[str, Any]:
    r = conn.execute("SELECT * FROM meetings WHERE id = ?", (mid,)).fetchone()
    if not r:
        raise AppError("회의록이 없습니다", 404)
    return _meeting_row(r)


def save_meeting(conn: sqlite3.Connection, payload: Dict[str, Any], mid: Optional[int] = None) -> Dict[str, Any]:
    year, grade = int(payload["school_year"]), int(payload["grade"])
    ensure_writable(conn, year)
    vals = (year, grade, int(payload.get("seq") or 0), payload.get("date"), payload.get("time_range"),
            payload.get("place"), payload.get("chair"), payload.get("members"), payload.get("agenda"),
            json.dumps(payload, ensure_ascii=False))
    if mid is None:
        cur = conn.execute(
            "INSERT INTO meetings(school_year, grade, seq, date, time_range, place, chair, members, agenda, payload) VALUES(?,?,?,?,?,?,?,?,?,?)",
            vals,
        )
        mid = cur.lastrowid
    else:
        m = get_meeting(conn, mid)
        if m["status"] == "final":
            raise AppError("확정한 회의록은 고칠 수 없습니다. 「확정 취소」 후 고쳐 주십시오", 409)
        conn.execute(
            "UPDATE meetings SET school_year=?, grade=?, seq=?, date=?, time_range=?, place=?, chair=?, members=?, agenda=?, payload=?,"
            " updated_at=datetime('now','localtime') WHERE id = ?",
            vals + (mid,),
        )
    return get_meeting(conn, mid)


def delete_meeting(conn: sqlite3.Connection, mid: int) -> None:
    m = get_meeting(conn, mid)
    ensure_writable(conn, m["school_year"])
    conn.execute("DELETE FROM guidance WHERE meeting_id = ?", (mid,))
    conn.execute("DELETE FROM meetings WHERE id = ?", (mid,))
    sync_alerts(conn, m["school_year"])


def finalize_meeting(conn: sqlite3.Connection, mid: int) -> Dict[str, Any]:
    """확정: 표3(생활지도 실시) 학생들에게 생활지도 이력을 쌓는다."""
    m = get_meeting(conn, mid)
    p = m["payload"]
    year = int(m["school_year"])
    ensure_writable(conn, year)
    conn.execute("DELETE FROM guidance WHERE meeting_id = ?", (mid,))
    month = int(p.get("guidance_month") or p.get("basis_month"))
    added = 0
    for s in p.get("students", []):
        if s.get("kind") != "guidance":
            continue
        n = conn.execute("SELECT COUNT(*) FROM guidance WHERE school_year = ? AND student_id = ?", (year, s["student_id"])).fetchone()[0]
        conn.execute(
            "INSERT INTO guidance(school_year, student_id, name, grade, step, month, date, measure, meeting_id, note) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (year, s["student_id"], s["name"], int(m["grade"]), n + 1, month, p.get("date"), s.get("measure_text"), mid,
             "제%d차 회의록 확정" % int(m["seq"] or 0)),
        )
        added += 1
    conn.execute("UPDATE meetings SET status = 'final', updated_at = datetime('now','localtime') WHERE id = ?", (mid,))
    sync_alerts(conn, year)
    return {"meeting": get_meeting(conn, mid), "guidance_added": added}


def unfinalize_meeting(conn: sqlite3.Connection, mid: int) -> Dict[str, Any]:
    m = get_meeting(conn, mid)
    ensure_writable(conn, m["school_year"])
    conn.execute("DELETE FROM guidance WHERE meeting_id = ?", (mid,))
    conn.execute("UPDATE meetings SET status = 'draft', updated_at = datetime('now','localtime') WHERE id = ?", (mid,))
    sync_alerts(conn, m["school_year"])
    return get_meeting(conn, mid)


def meeting_filename(p: Dict[str, Any]) -> str:
    d = (p.get("date") or "").replace("-", ".")
    return "%d_제%d차_%s_학생선도_소위원회_회의록_%s.hwpx" % (
        int(p["school_year"]), int(p["seq"]), p.get("dept_name") or "%d학년부" % int(p["grade"]), d)
