"""나이스 「결석자 조회」 파일 파서.

원본(페이지마다 머리·쪽 번호가 반복되고 학년·반이 띄엄띄엄 적힌 파일)과
사람이 정제한 파일(머리 한 번, 모든 행에 학년·반)을 같은 규칙으로 읽는다.

열 위치(0부터): A=학년(0), C=반(2), D=번호(3), E=성명(4), F=결석일수(5),
결석 6~9 / 지각 10~13 / 조퇴 14~17 / 결과 18~21 (각각 질병·미인정·기타·인정).
미인정은 7, 11, 15, 19열.
"""
from __future__ import annotations

import io
import math
import re
from datetime import date
from typing import Any, Dict, List, Optional

COL_GRADE, COL_CLASS, COL_NUM, COL_NAME, COL_ABS_DAYS = 0, 2, 3, 4, 5
GROUPS = {"abs": 6, "late": 10, "leave": 14, "result": 18}
KINDS = ["sick", "unexcused", "other", "approved"]  # 질병·미인정·기타·인정
ITEMS = ["abs", "late", "leave", "result"]

_DATE_RE = re.compile(r"(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")
_NUM_RE = re.compile(r"^[+-]?\d+(\.\d+)?$")


class ParseError(ValueError):
    pass


# ---------------------------------------------------------------- 파일 → 2차원 배열

def read_matrix(data: bytes, filename: str = "") -> List[List[Any]]:
    """첫 시트를 2차원 배열로 읽는다. 내용(매직 바이트)을 보고 형식을 고른다."""
    if not data:
        raise ParseError("파일이 비어 있습니다")
    head = data[:8]
    if head.startswith(b"PK"):
        return _read_xlsx(data)
    if head.startswith(b"\xd0\xcf\x11\xe0"):
        try:
            return _read_xls(data)
        except Exception:  # 확장자만 xls 인 다른 형식일 수 있다
            pass
    # 나이스의 .xls 가 실제로는 HTML 표인 경우
    return _read_html(data)


def _read_xlsx(data: bytes) -> List[List[Any]]:
    import warnings

    import openpyxl

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    try:
        ws = wb.worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    finally:
        wb.close()


def _read_xls(data: bytes) -> List[List[Any]]:
    import xlrd

    book = xlrd.open_workbook(file_contents=data)
    sh = book.sheet_by_index(0)
    return [sh.row_values(i) for i in range(sh.nrows)]


def _span(cell: Any, name: str) -> int:
    try:
        return max(1, int(str(cell.get(name) or "1").strip()))
    except ValueError:
        return 1


def html_table_grid(table: Any) -> List[List[Any]]:
    """HTML <table> → 2차원 배열. 병합(rowspan·colspan)된 칸은 같은 값으로 채운다
    (예전에 쓰던 pandas.read_html 과 같은 방식)."""
    grid: List[List[Any]] = []
    pending: Dict[tuple, Any] = {}  # (행, 열) → 위에서 내려온 병합 칸 값
    rows = [tr for tr in table.iter("tr") if tr.getparent() is not None]
    for r, tr in enumerate(rows):
        line: List[Any] = []
        c = 0
        for td in tr:
            if not isinstance(td.tag, str) or td.tag.lower() not in ("td", "th"):
                continue
            while (r, c) in pending:
                line.append(pending.pop((r, c)))
                c += 1
            text = " ".join(td.text_content().split())
            val: Any = text if text else None
            rs, cs = _span(td, "rowspan"), _span(td, "colspan")
            for dc in range(cs):
                line.append(val)
                for dr in range(1, rs):
                    pending[(r + dr, c + dc)] = val
            c += cs
        while (r, c) in pending:
            line.append(pending.pop((r, c)))
            c += 1
        grid.append(line)
    return grid


def _read_html(data: bytes) -> List[List[Any]]:
    """나이스의 .xls 가 실제로는 HTML 표인 경우. lxml 만으로 읽는다(pandas 불필요)."""
    from lxml import html as lxml_html

    text = None
    for enc in ("utf-8", "cp949", "euc-kr"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None or "<t" not in text.lower():
        raise ParseError("엑셀(.xlsx/.xls) 파일을 읽지 못했습니다")
    try:
        doc = lxml_html.fromstring(text)
    except Exception as e:  # pragma: no cover - 형식 오류
        raise ParseError("표를 찾지 못했습니다: %s" % e)
    # 안쪽에 다른 표가 없는 표만(바깥 틀 표 제외)
    tables = [t for t in doc.iter("table") if not list(t.iter("table"))[1:]]
    grids = [html_table_grid(t) for t in tables]
    grids = [g for g in grids if g]
    if not grids:
        raise ParseError("표를 찾지 못했습니다")
    # 페이지마다 표가 나뉘어 있을 수 있으니 열이 충분한 표를 차례로 이어 붙인다
    wide = [g for g in grids if max(len(r) for r in g) >= 20] or [max(grids, key=len)]
    rows: List[List[Any]] = []
    for g in wide:
        rows.extend(g)
    return rows


# ---------------------------------------------------------------- 셀 값 다루기

def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "") or (isinstance(v, float) and math.isnan(v))


def as_number(v: Any) -> Optional[float]:
    """숫자 또는 숫자 모양 문자열이면 값, 아니면 None."""
    if isinstance(v, bool) or _blank(v):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if _NUM_RE.match(s):
        return float(s)
    return None


def to_int(v: Any) -> int:
    """빈칸·문자 → 0, 2.0 → 2"""
    n = as_number(v)
    if n is None:
        return 0
    return max(0, int(math.floor(n)))


def cell(row: List[Any], i: int) -> Any:
    return row[i] if i < len(row) else None


def format_student_id(grade: int, klass: int, number: int) -> str:
    """학년×10000 + 반×100 + 번호, 5자리로 앞을 0으로 채움 (Code.gs formatStudentId)"""
    return str(max(0, grade * 10000 + klass * 100 + number)).zfill(5)


def normalize_id(v: Any) -> str:
    """숫자만 남기고 5자리로 0을 채움 (Code.gs normalizeId_)"""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = re.sub(r"[^0-9]", "", str(v))
    return s.zfill(5) if s else ""


# ---------------------------------------------------------------- 기간·학교명

def _parse_date(s: Any) -> Optional[date]:
    if isinstance(s, date):
        return s
    if _blank(s):
        return None
    m = _DATE_RE.search(str(s))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def find_period(rows: List[List[Any]]):
    """3행 D열·I열의 기간. 위치가 달라도 '기간' 글자가 있는 행에서 날짜 두 개를 찾는다."""
    for r in rows[:15]:
        texts = [c for c in r if not _blank(c)]
        if any(isinstance(c, str) and "기간" in c for c in texts):
            ds = [d for d in (_parse_date(c) for c in texts) if d]
            if ds:
                return ds[0], (ds[1] if len(ds) > 1 else ds[0])
    # '기간' 글자가 없으면 앞쪽에서 처음 보이는 날짜 두 개
    for r in rows[:15]:
        ds = [d for d in (_parse_date(c) for c in r) if d]
        if len(ds) >= 2:
            return ds[0], ds[1]
    return None, None


def find_school_name(rows: List[List[Any]]) -> str:
    """페이지 꼬리 행(Q열='/')의 X열, 없으면 '학교'로 끝나는 글자."""
    for r in rows:
        if str(cell(r, 16) or "").strip() == "/":
            v = cell(r, 23)
            if isinstance(v, str) and v.strip():
                return v.strip()
    for r in rows:
        for c in r:
            if isinstance(c, str) and re.search(r"학교\s*$", c.strip()) and len(c.strip()) <= 20:
                return c.strip()
    return ""


def months_between(d1: date, d2: date) -> List[int]:
    out = []
    y, m = d1.year, d1.month
    while (y, m) <= (d2.year, d2.month) and len(out) < 12:
        out.append(m)
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def school_year_for(d: date, start_month: int = 3) -> int:
    """1·2월(시작 월 앞의 달)이면 학년도 = 연도 − 1"""
    return d.year if d.month >= start_month else d.year - 1


# ---------------------------------------------------------------- 학생 행

def parse_matrix(rows: List[List[Any]]) -> Dict[str, Any]:
    """2차원 배열 → 학생 목록 + 기간 + 학교명.

    학생 행 판정: D열(번호)이 숫자이고 E열(성명)이 비어 있지 않은 (숫자가 아닌) 문자열인 행만.
    이 규칙으로 반복 머리행·쪽 번호 행·합계 행이 모두 걸러진다.
    """
    cur_grade: Optional[int] = None
    cur_class: Optional[int] = None
    students: List[Dict[str, Any]] = []
    seen = set()
    for row in rows:
        if not row:
            continue
        g = as_number(cell(row, COL_GRADE))
        if g is not None:
            cur_grade = int(g)
        c = as_number(cell(row, COL_CLASS))
        if c is not None:
            cur_class = int(c)
        num = as_number(cell(row, COL_NUM))
        name = cell(row, COL_NAME)
        if num is None or not isinstance(name, str):
            continue
        name = name.strip()
        if not name or as_number(name) is not None:
            continue
        if cur_grade is None or cur_class is None:
            continue
        number = int(num)
        sid = format_student_id(cur_grade, cur_class, number)
        if sid in seen:  # 같은 학생이 두 번 나오면 첫 줄만
            continue
        seen.add(sid)
        raw: Dict[str, Any] = {"abs_days": to_int(cell(row, COL_ABS_DAYS))}
        for item, base in GROUPS.items():
            raw[item] = {k: to_int(cell(row, base + i)) for i, k in enumerate(KINDS)}
        students.append(
            {
                "grade": cur_grade,
                "class": cur_class,
                "number": number,
                "student_id": sid,
                "name": name,
                "abs": raw["abs"]["unexcused"],
                "late": raw["late"]["unexcused"],
                "leave": raw["leave"]["unexcused"],
                "result": raw["result"]["unexcused"],
                "raw": raw,
            }
        )
    if not students:
        raise ParseError("학생 행을 찾지 못했습니다. 나이스 「결석자 조회」 파일인지 확인해 주십시오")
    d1, d2 = find_period(rows)
    return {
        "period_from": d1.isoformat() if d1 else None,
        "period_to": d2.isoformat() if d2 else None,
        "school_name": find_school_name(rows),
        "students": students,
    }


def parse_file(data: bytes, filename: str = "") -> Dict[str, Any]:
    return parse_matrix(read_matrix(data, filename))


def summarize(parsed: Dict[str, Any], start_month: int = 3) -> Dict[str, Any]:
    """미리 읽기 화면에 보여 줄 요약."""
    grades: Dict[int, Dict[str, int]] = {}
    for s in parsed["students"]:
        g = grades.setdefault(s["grade"], {"grade": s["grade"], "count": 0, "with_unexcused": 0})
        g["count"] += 1
        if any(s[k] for k in ITEMS):
            g["with_unexcused"] += 1
    months: List[int] = []
    suggested = None
    school_year = None
    if parsed.get("period_from"):
        d1 = date.fromisoformat(parsed["period_from"])
        d2 = date.fromisoformat(parsed["period_to"] or parsed["period_from"])
        months = months_between(d1, d2)
        suggested = months[0] if len(months) == 1 else None
        school_year = school_year_for(d1, start_month)
    return {
        "period_from": parsed.get("period_from"),
        "period_to": parsed.get("period_to"),
        "school_name": parsed.get("school_name", ""),
        "months": months,
        "suggested_month": suggested,
        "school_year": school_year,
        "grades": [grades[k] for k in sorted(grades)],
    }
