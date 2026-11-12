"""7-3절 검증: 생성한 hwpx 를 다시 풀어 XML 파싱 → 표 구조를 텍스트로 덤프해 입력값과 비교.

이름·학번은 모두 지어낸 값이다.
"""
import io
import zipfile

from app import minutes as M
from app.paths import DEFAULT_TEMPLATE

PAYLOAD = {
    "school_year": 2026, "grade": 3, "seq": 4, "dept_name": "3학년부", "start_month": 3,
    "title": "2026 제4차 3학년부 학생선도 소위원회 회의록",
    "datetime_text": "2026년 10월 12일 (월) 12:00~12:20",
    "place": "4층 3학년 쉼마루",
    "chair": "가가가 학년부장",
    "members": "나나나, 다다다, 라라라",
    "agenda": "2026학년도 4차 3학년부 학생선도 소위원회 회부 학생에 대한 회의",
    "referred_line": "9월 미인정 결석 누적합 기준 초과: 39901 홍길동, 39902 김철수",
    "basis_date_text": "2026. 9. 30.",
    "crisis_text": "생활지도 진행하지 않음",
    "students": [{
        "student_id": "39901", "name": "홍길동", "kind": "guidance",
        "months": [{"month": 9, "label": "9월", "abs": "-", "others": "12 / - / -"}],
        "total_lines": ["8월 1차 생활지도", "9월 합계: 미인정 지각 12회 (환산 4점)"],
        "measure_text": "(2차) 교내 환경정화활동",
    }],
}

EXPECTED = """2026 제4차 3학년부 학생선도 소위원회 회의록
TABLE 7x3
[0,0 1x1] 일시
[0,1 1x2] 2026년 10월 12일 (월) 12:00~12:20
[1,0 1x1] 장소
[1,1 1x2] 4층 3학년 쉼마루
[2,0 2x1] 참석자
[2,1 1x1] 위원장
[2,2 1x1] 가가가 학년부장
[3,1 1x1] 위원
[3,2 1x1] 나나나, 다다다, 라라라
[4,0 1x1] 심의 안건
[4,1 1x2] 2026학년도 4차 3학년부 학생선도 소위원회 회부 학생에 대한 회의
[5,0 1x3] 심의 내용
[6,0 1x3]
[안건1: 2026학년도 4차 3학년부 학생선도 소위원회 회부 학생에 대한 회의]
1. 학생선도 소위원회 회부 학생
1) 9월 미인정 결석 누적합 기준 초과: 39901 홍길동, 39902 김철수
2. 학생선도 소위원회 회부 학생 위반 사항(2026. 9. 30. 기준)
TABLE 4x3
[0,0 1x2] 월별 미인정 내역
[0,2 1x1] 39901 홍길동
[1,0 2x1] 9월
[1,1 1x1] 결석
[1,2 1x1] -
[2,1 1x1] 지각/조퇴/결과
[2,2 1x1] 12 / - / -
[3,0 1x2] 총합
[3,2 1x1] 8월 1차 생활지도 ⏎ 9월 합계: 미인정 지각 12회 (환산 4점)
3. 회부학생 지도 방안
1) 위기관리학생에 대한 생활지도 방안: 생활지도 진행하지 않음
2) 3학년부 생활지도 운영 계획에 따른 생활지도 대상자
TABLE 2x3
[0,0 1x1] 학번
[0,1 1x1] 이름
[0,2 1x1] 생활지도 내역
[1,0 1x1] 39901
[1,1 1x1] 홍길동
[1,2 1x1] (2차) 교내 환경정화활동"""

# 빈 양식에 남아 있어도 되는 글자(형식 이름)
FORM_LABELS = {
    "학생선도 소위원회 회의록", "일시", "장소", "참석자", "위원장", "위원", "심의 안건", "심의 내용",
    "[안건1: ]", "1. 학생선도 소위원회 회부 학생", "1)", "2. 학생선도 소위원회 회부 학생 위반 사항( 기준)",
    "월별 미인정 내역", "결석", "지각/조퇴/결과", "총합", "3. 회부학생 지도 방안",
    "1) 위기관리학생에 대한 생활지도 방안:", "2) 학년부 생활지도 운영 계획에 따른 생활지도 대상자",
    "학번", "이름", "생활지도 내역",
}


def _norm(lines):
    return [" ".join(l.split()) for l in lines if l.strip()]



def test_default_template_has_no_personal_info():
    """기본 양식은 형식만 있고 값·이름·작성자 정보가 없다."""
    root = M.Template(DEFAULT_TEMPLATE).section()
    texts = {" ".join((t.text or "").split()) for t in root.iter(M.q("t"))} - {""}
    assert texts <= FORM_LABELS, texts - FORM_LABELS
    with zipfile.ZipFile(DEFAULT_TEMPLATE) as z:
        hpf = z.read("Contents/content.hpf").decode("utf-8")
        assert "creator\" content=\"text\"/>" in hpf and "lastsaveby\" content=\"text\"/>" in hpf
        assert z.read("Preview/PrvText.txt").decode("utf-8").strip() == "학생선도 소위원회 회의록"
    assert M.check_tables(root) == []


def test_render_into_blank_template():
    gen = M.read_hwpx_section(M.render_hwpx(PAYLOAD))
    got = [l for l in _norm(M.dump_section(gen))]
    assert got == _norm(EXPECTED.splitlines())
    assert M.check_tables(gen) == []


def test_template_roundtrip_same_text():
    """만든 회의록을 다시 양식으로 넣고 같은 값으로 만들면 같은 텍스트가 나온다."""
    first = M.render_hwpx(PAYLOAD)
    again = M.render_hwpx(PAYLOAD, M.Template(data=first))
    assert _norm(M.dump_section(M.read_hwpx_section(again))) == _norm(M.dump_section(M.read_hwpx_section(first)))


def test_zip_layout():
    out = M.render_hwpx(PAYLOAD)
    with zipfile.ZipFile(io.BytesIO(out)) as z:
        infos = z.infolist()
        assert infos[0].filename == "mimetype"
        assert infos[0].compress_type == zipfile.ZIP_STORED
        assert z.read("mimetype") == b"application/hwp+zip"
        names = [i.filename for i in infos]
        with zipfile.ZipFile(DEFAULT_TEMPLATE) as t:
            assert names == [i.filename for i in t.infolist()]
            assert z.read("Contents/header.xml") == t.read("Contents/header.xml")
        assert "2026 제4차" in z.read("Preview/PrvText.txt").decode("utf-8")
        assert "2026 제4차 3학년부 학생선도 소위원회 회의록" in z.read("Contents/content.hpf").decode("utf-8")
        # 바꾼 문단의 줄 배치 정보는 지운다
        assert b"linesegarray" not in z.read("Contents/section0.xml")


def _student(i, months, kind="guidance"):
    return {
        "student_id": "399%02d" % i, "name": "학생%d" % i, "kind": kind,
        "months": [{"month": m, "label": "%d월" % m, "abs": str(i), "others": "%d / - / 10 (서류 7, 학원 수강)" % m} for m in months],
        "total_lines": ["8월 1차 생활지도", "9~10월 누적: 미인정 결석 %d회 (환산 %d점)" % (i, i), "참고: 3~10월 전체 누적"],
        "measure_text": "(2차) 교내 환경정화활동 %d" % i,
    }


def test_many_students_split_tables_and_structure():
    students = [_student(i, [9, 10] if i % 2 else [10, 11, 12, 1]) for i in range(1, 8)]
    students[2]["kind"] = "crisis"
    p = dict(PAYLOAD, students=students, referred_line="x")
    gen = M.read_hwpx_section(M.render_hwpx(p))
    assert M.check_tables(gen) == []
    tables = list(gen.iter(M.q("tbl")))
    # 표1 + 표2 3개(3·3·1명) + 표3 1개
    assert len(tables) == 5
    t2s = tables[1:4]
    assert [int(t.get("colCnt")) for t in t2s] == [5, 5, 3]
    for t in t2s:
        assert int(t.find(M.q("sz")).get("width")) == 46510
    # 첫 표: 학생 1~3, 달 합집합 9,10,11,12,1 (학년도 순서)
    t = t2s[0]
    assert int(t.get("rowCnt")) == 1 + 2 * 5 + 1
    months = [M.cell_lines(M.cell_at(t, 1 + 2 * i, 0))[0] for i in range(5)]
    assert months == ["9월", "10월", "11월", "12월", "1월"]
    assert M.cell_lines(M.cell_at(t, 0, 2)) == ["39901 학생1"]
    assert M.cell_lines(M.cell_at(t, 2, 2)) == ["9 / - / 10 (서류 7, 학원 수강)"]
    assert M.cell_lines(M.cell_at(t, 5, 2)) == ["-"]  # 학생1은 11월 기록 없음
    last = int(t.get("rowCnt")) - 1
    assert M.cell_lines(M.cell_at(t, last, 0)) == ["총합"]
    assert M.cell_lines(M.cell_at(t, last, 3)) == students[1]["total_lines"]
    # 표3: 위기관리학생(3번) 빠짐 → 6명 + 머리
    t3 = tables[4]
    assert int(t3.get("rowCnt")) == 7
    ids = [M.cell_lines(M.cell_at(t3, r, 0))[0] for r in range(1, 7)]
    assert "39903" not in ids and ids[0] == "39901"
    assert M.cell_lines(M.cell_at(t3, 1, 2)) == ["(2차) 교내 환경정화활동 1"]
    # 표2에는 위기관리학생도 남는다
    assert M.cell_lines(M.cell_at(t2s[0], 0, 4)) == ["39903 학생3"]
    # 번호 문단은 직접 쓴 번호 + paraPrIDRef=0
    assert not [x for x in gen.iter(M.q("p")) if x.get("paraPrIDRef") == "23"]


def test_no_students():
    p = dict(PAYLOAD, students=[])
    gen = M.read_hwpx_section(M.render_hwpx(p))
    assert M.check_tables(gen) == []
    assert "해당 학생 없음" in "\n".join(M.dump_section(gen))


def test_validate_default_template():
    M.validate_template(DEFAULT_TEMPLATE.read_bytes())
