"""3-4절 수용 기준: 원본(3학년만)과 정제본이 139명, 학번·이름·미인정 4종 모두 일치."""
from pathlib import Path

import pytest

from app.parse_neis import ITEMS, parse_file, parse_matrix, summarize

REF = Path(__file__).resolve().parent.parent / "reference"
RAW = REF / "neis_raw_sample.xlsx"
CLEAN = REF / "cleaned_sample.xlsx"



def _key(students):
    return {s["student_id"]: (s["name"],) + tuple(s[k] for k in ITEMS) for s in students}


@pytest.mark.skipif(not (RAW.exists() and CLEAN.exists()), reason="샘플 파일 없음")
def test_raw_grade3_equals_cleaned():
    raw = parse_file(RAW.read_bytes())
    clean = parse_file(CLEAN.read_bytes())
    raw3 = [s for s in raw["students"] if s["grade"] == 3]
    assert len(raw3) == 139
    assert len(clean["students"]) == 139
    assert _key(raw3) == _key(clean["students"])


@pytest.mark.skipif(not (RAW.exists() and CLEAN.exists()), reason="샘플 파일 없음")
def test_raw_grade_counts():
    raw = parse_file(RAW.read_bytes())
    counts = {}
    for s in raw["students"]:
        counts[s["grade"]] = counts.get(s["grade"], 0) + 1
    assert counts == {1: 72, 2: 61, 3: 139}


@pytest.mark.skipif(not (RAW.exists() and CLEAN.exists()), reason="샘플 파일 없음")
def test_period_month_and_school():
    raw = parse_file(RAW.read_bytes())
    assert raw["period_from"] == "2026-10-01"
    assert raw["period_to"] == "2026-10-31"
    assert raw["school_name"].endswith("학교")
    s = summarize(raw)
    assert s["months"] == [10] and s["suggested_month"] == 10 and s["school_year"] == 2026


@pytest.mark.skipif(not (RAW.exists() and CLEAN.exists()), reason="샘플 파일 없음")
def test_integers_and_ids():
    raw = parse_file(RAW.read_bytes())
    for s in raw["students"]:
        assert len(s["student_id"]) == 5
        for k in ITEMS:
            assert isinstance(s[k], int)


def test_header_page_and_total_rows_are_ignored():
    """반복 머리행(미인정 글자), 쪽 번호 행(P열 숫자), 합계 행(E열 숫자)은 학생이 아니다."""
    head = [None] * 22
    rows = [
        [None, "기간:", None, "2026.09.01", None, None, "-", None, "2026.09.30"],
        ["학년", "학   과", "반", "번호", "성명", "결석일수", "결  석"] + [None] * 15,
        [None] * 6 + ["질병", "미인정", "기타", "인정"] * 4,
        [3, "", 2, 6, "홍길동", 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [None] * 15 + [1, "/", 8] + [None] * 5 + ["어느고등학교"],
        ["학년", "학   과", "반", "번호", "성명", "결석일수", "결  석"] + [None] * 15,
        [None] * 6 + ["질병", "미인정", "기타", "인정"] * 4,
        [None, None, None, 7, "김철수", 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
        ["합   계", None, None, None, 272, 398] + [0] * 16,
    ]
    out = parse_matrix(rows)
    assert [(s["student_id"], s["name"]) for s in out["students"]] == [("30206", "홍길동"), ("30207", "김철수")]
    assert out["students"][1]["abs"] == 2 and out["students"][1]["leave"] == 1
    assert out["school_name"] == "어느고등학교"


# ---------------------------------------------------------------- .xls 가 실제로는 HTML 표인 경우

def _to_html(rows, merge_grade=False):
    """2차원 배열 → HTML 표. merge_grade 면 학년 칸을 rowspan 으로 병합(나이스 HTML 흉내)."""
    import html as h

    out = ["<html><body><table border=1>"]
    skip = set()
    for r, row in enumerate(rows):
        out.append("<tr>")
        for c, v in enumerate(row):
            if (r, c) in skip:
                continue
            txt = "" if v is None else h.escape(str(int(v)) if isinstance(v, float) and v.is_integer() else str(v))
            if merge_grade and c == 0 and v not in (None, ""):
                n = 1
                while r + n < len(rows) and rows[r + n][0] in (None, "") and rows[r + n][4]:
                    skip.add((r + n, 0))
                    n += 1
                out.append('<td rowspan="%d">%s</td>' % (n, txt))
            else:
                out.append("<td>%s</td>" % txt)
        out.append("</tr>")
    out.append("</table></body></html>")
    return "".join(out).encode("utf-8")


def test_html_table_file_synthetic():
    rows = [
        [None, "기간:", None, "2026.09.01", None, None, "-", None, "2026.09.30"] + [None] * 13,
        ["학년", "학   과", "반", "번호", "성명", "결석일수", "결  석"] + [None] * 15,
        [3, "", 2, 6, "홍길동", 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [None, None, None, 7, "김철수", 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
        ["합   계", None, None, None, 272, 398] + [0] * 16,
    ]
    out = parse_file(_to_html(rows, merge_grade=True), "download.xls")
    assert [(s["student_id"], s["name"], s["late"], s["abs"], s["leave"]) for s in out["students"]] == [
        ("30206", "홍길동", 12, 0, 0), ("30207", "김철수", 0, 2, 1)]
    assert out["period_from"] == "2026-09-01"


@pytest.mark.skipif(not RAW.exists(), reason="샘플 파일 없음")
def test_html_version_of_raw_equals_xlsx():
    from app.parse_neis import read_matrix

    rows = read_matrix(RAW.read_bytes())
    width = max(len(r) for r in rows)
    rows = [list(r) + [None] * (width - len(r)) for r in rows]
    a = parse_file(RAW.read_bytes())
    b = parse_file(_to_html(rows, merge_grade=True), "download.xls")
    assert _key(a["students"]) == _key(b["students"]) and len(b["students"]) == 272
    assert b["school_name"] == a["school_name"]
