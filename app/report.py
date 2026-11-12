"""미인정 출결 현황표: 공유 화면·공유 파일·xlsx 가 함께 쓰는 자료.

원자료 그대로 보여 주고, 제외 처리된 달은 회색으로 표시한다(값은 지우지 않는다).
「제외 반영 환산」 은 제외만 반영한 학년도 누적이다(생활지도 초기화는 반영하지 않는다).
"""
from __future__ import annotations

import io
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from . import roster as RO
from . import rules as R
from . import service as S

TEMPLATE = Path(__file__).resolve().parent / "templates" / "share_view.html"
SCOPES = ("all", "class", "student")


def build(conn: sqlite3.Connection, year: Optional[int] = None) -> Dict[str, Any]:
    st = S.get_settings(conn)
    year = int(year or st["current_year"])
    rules = st["rules"]
    start = int(rules["start_month"])
    by_grade = S.months_by_grade(conn, year)
    students = S.load_students(conn, year)
    excl = S.load_exclusions(conn, year)
    roster = RO.roster_map(conn, year)
    out: List[Dict[str, Any]] = []
    for sid, s in students.items():
        months = by_grade.get(str(s["grade"])) or sorted(s["records"])
        res = R.compute_student(s["records"], months, rules, excl.get(sid), None, apply_exclusions=True, apply_reset=False)
        if not any(res["raw"].values()):
            continue
        ro = roster.get(sid) or {}
        out.append({
            "student_id": sid, "name": s["name"], "grade": s["grade"], "class": s["class"], "number": s["number"],
            "status": ro.get("status"), "crisis": bool(ro.get("crisis")),
            "months": {
                str(pm["month"]): {"raw": pm["raw"], "doc": pm["doc"], "all": pm["all_excluded"], "reasons": pm["reasons"]}
                for pm in res["months"]
            },
        })
    out.sort(key=lambda x: x["student_id"])
    conv = rules.get("conversion") or {}
    return {
        "school_name": st.get("school_name") or "",
        "school_year": year,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "start_month": start,
        "items": [{"key": k, "label": R.ITEM_LABELS[k]} for k in R.ITEMS],
        "rules": {"count": {k: bool((rules.get("count") or {}).get(k, True)) for k in R.ITEMS},
                  "mode": conv.get("mode", "weighted"), "n": max(1, int(conv.get("n", 3) or 3))},
        "grades": {g: R.sort_months(ms, start) for g, ms in sorted(by_grade.items()) if ms},
        "students": out,
    }


# ---------------------------------------------------------------- 고르기

def select(data: Dict[str, Any], scope: str = "all", grade: Optional[int] = None, cls: Optional[int] = None,
           sid: Optional[str] = None, months: Optional[Iterable[int]] = None) -> Dict[str, Any]:
    """범위(전체/학급/학생)와 달로 학생·달을 고른다. 결과는 학년·반별 묶음."""
    if scope not in SCOPES:
        raise S.AppError("보기 범위가 올바르지 않습니다", 400)
    rows = data["students"]
    if scope == "student":
        if not sid:
            raise S.AppError("학생을 고르십시오", 400)
        rows = [r for r in rows if r["student_id"] == sid]
    else:
        if grade:
            rows = [r for r in rows if r["grade"] == int(grade)]
        if scope == "class":
            if not grade or not cls:
                raise S.AppError("학년과 반을 고르십시오", 400)
            rows = [r for r in rows if r["class"] == int(cls)]
    want = {int(m) for m in months} if months else None
    groups: Dict[tuple, Dict[str, Any]] = {}
    for r in rows:
        key = (r["grade"], r["class"])
        g = groups.get(key)
        if g is None:
            ms = [int(m) for m in data["grades"].get(str(r["grade"]), [])]
            if want is not None:
                ms = [m for m in ms if m in want]
            g = groups[key] = {"grade": r["grade"], "class": r["class"], "months": ms, "students": []}
        g["students"].append(r)
    return {"groups": [groups[k] for k in sorted(groups)]}


def _sum(r: Dict[str, Any], months: List[int], key: str) -> Dict[str, int]:
    t = R.empty_counts()
    for m in months:
        pm = r["months"].get(str(m))
        if pm:
            t = R.add_counts(t, pm[key])
    return t


def score_text(r: Dict[str, Any], months: List[int], rules: Dict[str, Any]) -> str:
    raw, doc = _sum(r, months, "raw"), _sum(r, months, "doc")
    eff = {k: raw[k] - doc[k] for k in R.ITEMS}
    sc, carry = R.score(eff, {"count": rules["count"], "conversion": {"mode": rules["mode"], "n": rules["n"]}})
    return "%d점" % sc + (" (이월 %d)" % carry if carry else "")


def title_of(data: Dict[str, Any], scope: str, grade: Optional[int], cls: Optional[int], sid: Optional[str]) -> str:
    y = data["school_year"]
    if scope == "student":
        r = next((x for x in data["students"] if x["student_id"] == sid), None)
        return "%d학년도_미인정출결_%s%s" % (y, sid or "", "_" + r["name"] if r and r["name"] else "")
    if scope == "class":
        return "%d학년도_미인정출결_%d-%d" % (y, int(grade or 0), int(cls or 0))
    return "%d학년도_미인정출결_%s" % (y, "%d학년" % int(grade) if grade else "전체")


# ---------------------------------------------------------------- xlsx

def to_xlsx(data: Dict[str, Any], scope: str = "all", grade: Optional[int] = None, cls: Optional[int] = None,
            sid: Optional[str] = None, months: Optional[Iterable[int]] = None) -> bytes:
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    sel = select(data, scope, grade, cls, sid, months)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    thin = Side(style="thin", color="B8B2A7")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)
    head_fill = PatternFill("solid", fgColor="EFEAE0")
    ex_fill = PatternFill("solid", fgColor="E7E5E4")
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    labels = [it["label"] for it in data["items"]]
    keys = [it["key"] for it in data["items"]]
    if not sel["groups"]:
        ws = wb.create_sheet("미인정 출결")
        ws.append(["조건에 맞는 학생이 없습니다."])
    for g in sel["groups"]:
        ws = wb.create_sheet("%d-%d" % (g["grade"], g["class"]))
        ms = g["months"]
        head = ["반", "번호", "학번", "이름", "항목"] + ["%d월" % m for m in ms] + ["합계", "제외 반영 환산"]
        ws.append(["%s %d학년도 미인정 출결 현황 · %d학년 %d반" % (data["school_name"], data["school_year"], g["grade"], g["class"])])
        ws.append(["%s 기준 · 원자료 그대로이며 회색 칸은 제외 처리된 달입니다(서류 n: 서류로 확인한 횟수)" % data["generated_at"]])
        ws.append(head)
        ws["A1"].font = Font(bold=True, size=13)
        ws["A2"].font = Font(size=9, color="6B6560")
        for c in ws[3]:
            c.font = Font(bold=True)
            c.fill = head_fill
            c.alignment = center
            c.border = box
        row = 4
        for r in g["students"]:
            raw_t, doc_t = _sum(r, ms, "raw"), _sum(r, ms, "doc")
            name = r["name"] or ""
            if r.get("status") and r["status"] != "재학":
                name += " (%s)" % r["status"]
            for i, (k, lab) in enumerate(zip(keys, labels)):
                vals: List[Any] = [r["class"], r["number"], r["student_id"], name, "미인정 " + lab] if i == 0 else ["", "", "", "", "미인정 " + lab]
                fills: List[bool] = []
                for m in ms:
                    pm = r["months"].get(str(m))
                    v, d = (pm["raw"][k], pm["doc"][k]) if pm else (0, 0)
                    txt: Any = v if v else "-"
                    if pm and not pm["all"] and d:
                        txt = "%d (서류 %d)" % (v, d)
                    vals.append(txt)
                    fills.append(bool(pm and (pm["all"] or d)))
                tv, td = raw_t[k], doc_t[k]
                vals.append(("%d (제외 %d)" % (tv, td)) if td else (tv if tv else "-"))
                vals.append(score_text(r, ms, data["rules"]) if i == 0 else "")
                ws.append(vals)
                for j, c in enumerate(ws[row]):
                    c.border = box
                    c.alignment = center
                    if 5 <= j < 5 + len(ms) and fills[j - 5]:
                        c.fill = ex_fill
                        c.font = Font(color="78716C")
                row += 1
            for col in (1, 2, 3, 4, len(head)):
                ws.merge_cells(start_row=row - 4, start_column=col, end_row=row - 1, end_column=col)
        widths = [5, 5, 8, 11, 12] + [7] * len(ms) + [11, 14]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "F4"
        ws.page_setup.orientation = "landscape"
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.print_title_rows = "3:3"
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


# ---------------------------------------------------------------- 공유 화면(HTML)

def _embed(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False).replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def view_html(mode: str, data: Optional[Dict[str, Any]] = None) -> str:
    """mode='live': 교내망 링크(같은 주소의 data 를 불러옴) / 'file': 자료를 담은 한 파일."""
    html = TEMPLATE.read_text(encoding="utf-8")
    boot = {"mode": mode, "data": data if mode == "file" else None}
    return html.replace("/*__BOOT__*/null", _embed(boot))
