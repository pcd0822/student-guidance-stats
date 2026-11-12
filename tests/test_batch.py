"""여러 월 파일 한 번에 올리기 · 여러 달 합계 파일 막기 · 제외 여러 명 한 번에 추가.

샘플 없이 돌도록 지어낸 학생으로 나이스 모양 파일을 만든다.
"""
import io

import openpyxl
import pytest
from fastapi.testclient import TestClient

# (반, 번호, 이름) — 지어낸 학생
ROSTER = [(1, 1, "홍길동"), (1, 2, "김철수"), (2, 1, "이영희"), (2, 2, "박민수")]


def neis_xlsx(d_from, d_to, values):
    """values: {이름: (결석, 지각, 조퇴, 결과)} — 미인정 칸만 채운다."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([None] * 25 + ["2026.11.12."])
    ws.append([None] * 9 + ["결석자 조회"])
    ws.append([None, "기간:", None, d_from, None, None, "-", None, d_to])
    ws.append(["학년", "학   과", "반", "번호", "성명", "결석일수", "결  석", None, None, None, "지  각", None, None, None, "조  퇴", None, None, None, "결  과"])
    ws.append([None] * 6 + ["질병", "미인정", "기타", "인정"] * 4)
    last_class = None
    for i, (c, n, name) in enumerate(ROSTER):
        a, l, e, r = values.get(name, (0, 0, 0, 0))
        row = [3 if i == 0 else None, "", c if c != last_class else None, n, name, a]
        row += [0, a, 0, 0, 0, l, 0, 0, 0, e, 0, 0, 0, r, 0, 0]
        ws.append(row)
        last_class = c
    ws.append(["합   계", None, None, None, len(ROSTER)])
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    from app import db
    db.reset_init_cache()
    from app.server import app
    with TestClient(app) as c:
        c.put("/api/settings", json={"current_year": 2026, "grades": [3], "setup_done": True})
        yield c


def _preview(client, files):
    r = client.post("/api/upload/preview-many", files=[("files", (n, d)) for n, d in files])
    assert r.status_code == 200, r.text
    return r.json()


def test_many_monthly_files_at_once(client):
    files = [
        ("9월.xlsx", neis_xlsx("2026.09.01", "2026.09.30", {"홍길동": (1, 2, 0, 0)})),
        ("10월.xlsx", neis_xlsx("2026.10.01", "2026.10.31", {"홍길동": (0, 1, 3, 0), "이영희": (3, 0, 0, 0)})),
        ("8월.xlsx", neis_xlsx("2026.08.01", "2026.08.31", {})),
    ]
    pv = _preview(client, files)
    assert [(p["file_name"], p["ok"], p["months"]) for p in pv] == [
        ("9월.xlsx", True, [9]), ("10월.xlsx", True, [10]), ("8월.xlsx", True, [8])]
    r = client.post("/api/upload/commit-many", json={"grades": [3], "items": [{"token": p["token"]} for p in pv]})
    assert r.status_code == 200, r.text
    assert [(f["month"], f["saved"]) for f in r.json()["files"]] == [(9, {"3": 4}), (10, {"3": 4}), (8, {"3": 4})]
    st = client.get("/api/state").json()
    assert st["months_by_grade"] == {"3": [8, 9, 10]}
    # 9~10월을 더하면 이월 규칙대로: 결석 1 + ⌊(2+1+3)/3⌋ = 3점
    d = client.get("/api/dashboard", params={"grade": 3, "lookup_months": "9,10", "target_months": "9,10"}).json()
    row = next(x for x in d["lookup"] if x["name"] == "홍길동")
    assert row["raw"] == {"abs": 1, "late": 3, "leave": 3, "result": 0} and row["score"] == 3
    assert {t["name"] for t in d["targets"]} == {"홍길동", "이영희"}

    # 다시 올리면 덮어쓰기 확인
    pv = _preview(client, files[:1])
    r = client.post("/api/upload/commit-many", json={"grades": [3], "items": [{"token": pv[0]["token"]}]})
    assert r.status_code == 409 and "3학년 9월" in r.json()["detail"]


def test_multi_month_file_is_refused(client):
    pv = _preview(client, [("전체.xlsx", neis_xlsx("2026.03.01", "2026.10.31", {"홍길동": (5, 0, 0, 0)}))])[0]
    assert pv["ok"] is False and pv["multi_month"] is True and "달별로 나눌 수 없습니다" in pv["error"]
    r = client.post("/api/upload/commit-many", json={"grades": [3], "items": [{"token": pv["token"], "month": 10}]})
    assert r.status_code == 400 and "한 달씩" in r.json()["detail"]
    # 예전 단일 업로드 길도 막힌다(10월 하나로 몰아 저장되던 문제)
    r = client.post("/api/upload/commit", json={"grades": [3], "token": pv["token"], "month": 10})
    assert r.status_code == 400
    assert client.get("/api/state").json()["months_by_grade"] == {}


def test_two_files_same_month_refused(client):
    a = neis_xlsx("2026.09.01", "2026.09.30", {})
    pv = _preview(client, [("a.xlsx", a), ("b.xlsx", a)])
    r = client.post("/api/upload/commit-many", json={"grades": [3], "items": [{"token": p["token"]} for p in pv]})
    assert r.status_code == 400 and "9월 파일이 두 개" in r.json()["detail"]


def test_unreadable_file_reported_but_others_ok(client):
    pv = _preview(client, [("x.xlsx", b"not an excel"), ("9.xlsx", neis_xlsx("2026.09.01", "2026.09.30", {}))])
    assert pv[0]["ok"] is False and "token" not in pv[0] and pv[0]["error"]
    assert pv[1]["ok"] is True


def _load(client):
    files = [("9.xlsx", neis_xlsx("2026.09.01", "2026.09.30", {"홍길동": (2, 0, 4, 0), "김철수": (0, 0, 2, 0)})),
             ("10.xlsx", neis_xlsx("2026.10.01", "2026.10.31", {"홍길동": (0, 0, 6, 0), "김철수": (0, 0, 1, 0)}))]
    pv = _preview(client, files)
    client.post("/api/upload/commit-many", json={"grades": [3], "items": [{"token": p["token"]} for p in pv]})


def test_bulk_exclusion_whole_month(client):
    _load(client)
    r = client.post("/api/exclusions/bulk", json={"student_ids": ["30101", "30102", "30102"], "reason": "숙려제", "mode": "all", "months": [9, 10]})
    assert r.status_code == 200, r.text
    assert r.json()["saved"] == 2 and r.json()["unknown"] == []
    ex = {e["student_id"]: e for e in client.get("/api/exclusions").json()}
    assert set(ex) == {"30101", "30102"}
    assert ex["30101"]["months"]["9"] == [{"reason": "숙려제", "mode": "all"}]
    d = client.get("/api/dashboard", params={"grade": 3, "lookup_months": "9,10", "target_months": "9,10"}).json()
    assert d["targets"] == [] and d["summary"]["excluded"] == 2


def test_bulk_exclusion_documented_counts_and_merge(client):
    _load(client)
    # 기존 등록(다른 사유)에 더해진다
    client.put("/api/exclusions", json={"student_id": "30101", "months": {"9": [{"reason": "병원", "mode": "documented", "counts": {"abs": 2}}]}})
    body = {"student_ids": ["30101", "30102"], "reason": "학원 수강", "mode": "documented", "months": [9],
            "counts": {"30101": {"9": {"leave": 3}}, "30102": {"9": {"leave": 2}}}}
    r = client.post("/api/exclusions/bulk", json=body)
    assert r.status_code == 200, r.text
    ex = {e["student_id"]: e for e in client.get("/api/exclusions").json()}
    assert [x["reason"] for x in ex["30101"]["months"]["9"]] == ["병원", "학원 수강"]
    assert ex["30102"]["months"]["9"][0]["counts"]["leave"] == 2
    # 같은 사유로 다시 넣으면 바뀐다(쌓이지 않음)
    body["counts"]["30101"]["9"]["leave"] = 4
    client.post("/api/exclusions/bulk", json=body)
    ex = {e["student_id"]: e for e in client.get("/api/exclusions").json()}
    assert [x["counts"]["leave"] for x in ex["30101"]["months"]["9"] if x["reason"] == "학원 수강"] == [4]


def test_bulk_exclusion_all_or_nothing(client):
    _load(client)
    body = {"student_ids": ["30101", "30102"], "reason": "학원 수강", "mode": "documented", "months": [10],
            "counts": {"30101": {"10": {"leave": 5}}, "30102": {"10": {"leave": 9}}}}  # 김철수 10월 조퇴는 1회
    r = client.post("/api/exclusions/bulk", json=body)
    assert r.status_code == 400
    errs = r.json()["data"]["errors"]
    assert [e["student_id"] for e in errs] == ["30102"] and "기록은 1회" in errs[0]["message"]
    assert client.get("/api/exclusions").json() == []  # 한 명도 저장되지 않음


def test_bulk_exclusion_whole_period_and_unknown(client):
    _load(client)
    r = client.post("/api/exclusions/bulk", json={"student_ids": ["30101", "39999"], "reason": "자퇴", "all_period": True})
    assert r.status_code == 200, r.text
    assert r.json()["unknown"] == ["39999"]
    ex = {e["student_id"]: e for e in client.get("/api/exclusions").json()}
    assert ex["30101"]["all_period"] is True and ex["30101"]["all_reason"] == "자퇴"
