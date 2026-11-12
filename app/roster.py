"""학생 명단(학년도별)과 학적 정보.

학번·이름·반·번호는 올린 나이스 자료에서 자동으로 채우고(source='upload'),
자료에 아직 없는 학생(전입생 등)은 직접 추가한다(source='manual').
학적 상태·변동일·위기관리학생·비고는 사람이 적는다. 자료를 다시 올려도 지우지 않는다.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import date
from typing import Any, Dict, List, Optional

from . import rules as R
from .parse_neis import normalize_id

STATUSES = ["재학", "전출", "자퇴", "휴학", "학업중단 숙려", "위탁교육", "기타"]
# 이 상태로 바뀌면 「그 달부터 제외 처리에도 등록」을 권한다
LEAVING = {"전출", "자퇴", "휴학", "학업중단 숙려", "위탁교육"}


class RosterError(ValueError):
    pass


def sync_roster(conn: sqlite3.Connection, year: int) -> None:
    """올린 자료에 있는 학생을 명단에 넣고, 이름·반·번호를 가장 최근 달 자료에 맞춘다."""
    start = int(_rules(conn).get("start_month", 3))
    latest: Dict[str, sqlite3.Row] = {}
    for r in conn.execute(
        "SELECT student_id, name, grade, class, number, month FROM monthly_records WHERE school_year = ?", (year,)
    ):
        cur = latest.get(r["student_id"])
        if cur is None or R.school_order(r["month"], start) > R.school_order(cur["month"], start):
            latest[r["student_id"]] = r
    for sid, r in latest.items():
        conn.execute(
            "INSERT INTO students(school_year, student_id, name, grade, class, number, source) VALUES(?,?,?,?,?,?,'upload')"
            " ON CONFLICT(school_year, student_id) DO UPDATE SET name=excluded.name, grade=excluded.grade,"
            " class=excluded.class, number=excluded.number, source='upload'",
            (year, sid, r["name"], r["grade"], r["class"], r["number"]),
        )


def _rules(conn: sqlite3.Connection) -> Dict[str, Any]:
    from . import service as S

    return S.rules_of(conn)


def roster_map(conn: sqlite3.Connection, year: int) -> Dict[str, Dict[str, Any]]:
    return {r["student_id"]: _row(r) for r in conn.execute("SELECT * FROM students WHERE school_year = ?", (year,))}


def _row(r: sqlite3.Row) -> Dict[str, Any]:
    d = dict(r)
    d["crisis"] = bool(d.get("crisis"))
    d["status"] = d.get("status") or "재학"
    return d


def list_roster(conn: sqlite3.Connection, year: int, grade: Optional[int] = None) -> List[Dict[str, Any]]:
    """명단 + 이번 학년도 요약(누적 점수·생활지도 횟수·제외·알림)."""
    from . import service as S

    sync_roster(conn, year)
    rules = S.rules_of(conn)
    studs = S.load_students(conn, year, grade)
    excl = S.load_exclusions(conn, year)
    guid = S.load_guidance(conn, year)
    alerts: Dict[str, int] = {}
    for r in conn.execute(
        "SELECT student_id, COUNT(*) n FROM exclusion_alerts WHERE school_year = ? AND status = 'open' GROUP BY student_id", (year,)
    ):
        alerts[r["student_id"]] = r["n"]
    q = "SELECT * FROM students WHERE school_year = ?"
    args: List[Any] = [year]
    if grade:
        q += " AND grade = ?"
        args.append(grade)
    out = []
    for r in conn.execute(q + " ORDER BY student_id", args):
        d = _row(r)
        st = studs.get(d["student_id"])
        g = guid.get(d["student_id"], [])
        if st:
            res = R.compute_student(st["records"], list(st["records"].keys()), rules, excl.get(d["student_id"]), g)
            d.update(score=res["score"], carry=res["carry"], months=R.sort_months(st["records"].keys(), rules["start_month"]),
                     raw=res["raw"])
        else:
            d.update(score=None, carry=None, months=[], raw=None)
        d["guidance_count"] = len(g)
        d["has_exclusion"] = d["student_id"] in excl
        d["alerts"] = alerts.get(d["student_id"], 0)
        d["is_target"] = d["score"] is not None and d["score"] >= int(rules["threshold"])
        out.append(d)
    return out


def _clean_date(v: Any) -> Optional[str]:
    if v in (None, ""):
        return None
    m = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", str(v))
    if not m:
        raise RosterError("변동일 형식이 올바르지 않습니다(예: 2026-10-15)")
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        raise RosterError("변동일이 올바른 날짜가 아닙니다")


def save_student(conn: sqlite3.Connection, year: int, body: Dict[str, Any], create: bool = False) -> Dict[str, Any]:
    """학적 정보 저장. create 면 명단에 없는 학생을 직접 추가한다.

    body.apply_exclusion 이 참이면 변동일이 속한 달부터 학년도 끝까지
    「그 달 전체 제외」를 학적 상태를 사유로 제외 처리에도 등록한다(아직 자료가 없는 달 포함).
    """
    from . import service as S

    S.ensure_writable(conn, year)
    sid = normalize_id(body.get("student_id"))
    if not sid or len(sid) != 5:
        raise RosterError("학번(5자리)을 입력해 주십시오")
    status = str(body.get("status") or "재학").strip()
    if status not in STATUSES:
        raise RosterError("학적 상태를 목록에서 고르십시오")
    status_date = _clean_date(body.get("status_date"))
    crisis = 1 if body.get("crisis") else 0
    note = str(body.get("note") or "").strip()
    exists = conn.execute("SELECT * FROM students WHERE school_year = ? AND student_id = ?", (year, sid)).fetchone()
    if create:
        if exists:
            raise RosterError("%s 학생은 이미 명단에 있습니다" % sid)
        name = str(body.get("name") or "").strip()
        if not name:
            raise RosterError("이름을 입력해 주십시오")
        conn.execute(
            "INSERT INTO students(school_year, student_id, name, grade, class, number, status, status_date, crisis, note, source)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,'manual')",
            (year, sid, name, int(sid[0]), int(sid[1:3]), int(sid[3:5]), status, status_date, crisis, note),
        )
    else:
        if not exists:
            raise RosterError("%s 학생이 명단에 없습니다" % sid)
        name = str(body.get("name") or "").strip() or exists["name"]
        # 나이스 자료에서 온 이름은 다음 업로드 때 다시 맞춰진다
        conn.execute(
            "UPDATE students SET name=?, status=?, status_date=?, crisis=?, note=?, updated_at=datetime('now','localtime')"
            " WHERE school_year = ? AND student_id = ?",
            (name, status, status_date, crisis, note, year, sid),
        )
    added_ex = None
    if body.get("apply_exclusion"):
        if status == "재학":
            raise RosterError("재학 상태에는 제외를 등록하지 않습니다")
        if not status_date:
            raise RosterError("제외를 등록하려면 변동일을 입력해 주십시오")
        rules = S.rules_of(conn)
        start = int(rules["start_month"])
        m0 = int(status_date[5:7])
        months = [m for m in R.school_months(start) if R.school_order(m, start) >= R.school_order(m0, start)]
        added_ex = S.bulk_add_exclusions(conn, year, {
            "student_ids": [sid], "reason": status, "mode": "all", "months": months,
            "note": "학적 변동 %s" % status_date, "skip_empty": False,
        })
    row = conn.execute("SELECT * FROM students WHERE school_year = ? AND student_id = ?", (year, sid)).fetchone()
    return {"student": _row(row), "exclusion": added_ex}


def delete_student(conn: sqlite3.Connection, year: int, sid: str) -> None:
    from . import service as S

    S.ensure_writable(conn, year)
    sid = normalize_id(sid)
    if conn.execute("SELECT 1 FROM monthly_records WHERE school_year = ? AND student_id = ?", (year, sid)).fetchone():
        raise RosterError("올린 출결 자료에 있는 학생은 지울 수 없습니다. 학적 상태를 바꾸십시오")
    conn.execute("DELETE FROM students WHERE school_year = ? AND student_id = ?", (year, sid))


def import_paste(conn: sqlite3.Connection, year: int, text: str) -> Dict[str, Any]:
    """엑셀에서 복사한 줄: 학번 · 이름 · (학적 상태) · (변동일) · (위기관리: O/예/1) · (비고)

    명단에 있으면 학적 정보만 고치고, 없으면 새로 추가한다. 머리행 등 학번이 없는 줄은 건너뛴다.
    """
    from . import service as S

    S.ensure_writable(conn, year)
    sync_roster(conn, year)
    added, updated, skipped, errors = 0, 0, 0, []
    for no, line in enumerate((text or "").splitlines(), 1):
        if not line.strip():
            continue
        cells = [c.strip() for c in (line.split("\t") if "\t" in line else re.split(r"\s*,\s*|\s{2,}", line.strip()))]
        if len(cells) == 1:
            cells = line.split()
        digits = re.sub(r"\D", "", cells[0]) if cells else ""
        if not 4 <= len(digits) <= 5:
            skipped += 1
            continue
        sid = normalize_id(digits)
        status = cells[2] if len(cells) > 2 and cells[2] else "재학"
        body = {
            "student_id": sid,
            "name": cells[1] if len(cells) > 1 else "",
            "status": status,
            "status_date": cells[3] if len(cells) > 3 else None,
            "crisis": (cells[4].upper() in ("O", "○", "Y", "YES", "예", "1", "TRUE", "위기")) if len(cells) > 4 else False,
            "note": cells[5] if len(cells) > 5 else "",
        }
        exists = conn.execute("SELECT * FROM students WHERE school_year = ? AND student_id = ?", (year, sid)).fetchone()
        if exists:
            # 붙여 넣은 칸만 바꾼다
            if len(cells) <= 2:
                skipped += 1
                continue
            if len(cells) <= 4:
                body["crisis"] = bool(exists["crisis"])
            if len(cells) <= 5:
                body["note"] = exists["note"] or ""
        try:
            save_student(conn, year, body, create=not exists)
            if exists:
                updated += 1
            else:
                added += 1
        except RosterError as e:
            errors.append("%d번째 줄(%s): %s" % (no, sid, e))
    return {"added": added, "updated": updated, "skipped": skipped, "errors": errors}
