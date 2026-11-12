"""학생 관리(명단·학적)와 제외 달 칩 규칙. 지어낸 학생만 쓴다."""
import pytest
from fastapi.testclient import TestClient

from tests.test_batch import neis_xlsx


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    from app import db
    db.reset_init_cache()
    from app.server import app
    with TestClient(app) as c:
        c.put("/api/settings", json={"current_year": 2026, "grades": [3], "setup_done": True})
        files = [("9.xlsx", neis_xlsx("2026.09.01", "2026.09.30", {"홍길동": (3, 0, 0, 0)})),
                 ("10.xlsx", neis_xlsx("2026.10.01", "2026.10.31", {"홍길동": (1, 0, 0, 0), "김철수": (0, 0, 2, 0)}))]
        pv = c.post("/api/upload/preview-many", files=[("files", f) for f in files]).json()
        assert c.post("/api/upload/commit-many", json={"grades": [3], "items": [{"token": p["token"]} for p in pv]}).status_code == 200
        yield c


def _roster(c):
    return {s["student_id"]: s for s in c.get("/api/roster").json()["students"]}


def test_roster_filled_from_uploads(client):
    r = _roster(client)
    assert set(r) == {"30101", "30102", "30201", "30202"}
    h = r["30101"]
    assert (h["name"], h["class"], h["number"], h["status"], h["crisis"], h["source"]) == ("홍길동", 1, 1, "재학", False, "upload")
    assert h["score"] == 4 and h["is_target"] is True and h["months"] == [9, 10]


def test_edit_status_survives_reupload(client):
    r = client.put("/api/roster/30102", json={"status": "휴학", "status_date": "2026.10.15", "crisis": True, "note": "상담 중"})
    assert r.status_code == 200, r.text
    assert r.json()["student"]["status_date"] == "2026-10-15"
    # 같은 달을 다시 올려도 학적 정보는 남는다
    pv = client.post("/api/upload/preview-many", files=[("files", ("10.xlsx", neis_xlsx("2026.10.01", "2026.10.31", {})))]).json()
    client.post("/api/upload/commit-many", json={"grades": [3], "overwrite": True, "items": [{"token": pv[0]["token"]}]})
    k = _roster(client)["30102"]
    assert (k["status"], k["crisis"], k["note"]) == ("휴학", True, "상담 중")
    # 대시보드·개인별 통계에 학적이 보인다
    d = client.get("/api/dashboard", params={"grade": 3, "lookup_months": "9"}).json()
    assert all("status" in x for x in d["lookup"])
    assert client.get("/api/personal/30102").json()["roster"]["status"] == "휴학"


def test_crisis_flag_defaults_meeting_kind(client):
    client.put("/api/roster/30101", json={"status": "재학", "crisis": True})
    d = client.post("/api/meetings/draft", json={"grade": 3, "student_ids": ["30101"], "basis_month": 10}).json()
    assert d["students"][0]["kind"] == "crisis" and d["crisis_text"] == "생활지도 진행하지 않음"


def test_status_change_registers_exclusion_from_that_month(client):
    r = client.put("/api/roster/30101", json={"status": "자퇴", "status_date": "2026-10-20", "apply_exclusion": True})
    assert r.status_code == 200, r.text
    ex = {e["student_id"]: e for e in client.get("/api/exclusions").json()}["30101"]
    # 10월부터 학년도 끝(2월)까지, 아직 자료 없는 달도 미리 등록
    assert sorted(int(m) for m in ex["months"]) == [1, 2, 10, 11, 12]
    assert ex["months"]["10"][0] == {"reason": "자퇴", "mode": "all", "note": "학적 변동 2026-10-20"}
    assert _roster(client)["30101"]["score"] == 3  # 9월 결석 3만 남음
    bad = client.put("/api/roster/30101", json={"status": "재학", "apply_exclusion": True})
    assert bad.status_code == 400


def test_manual_add_delete_and_paste(client):
    r = client.post("/api/roster", json={"student_id": "30305", "name": "전입생", "status": "재학"})
    assert r.status_code == 200 and r.json()["student"]["source"] == "manual"
    assert client.post("/api/roster", json={"student_id": "30305", "name": "x"}).status_code == 400
    assert client.get("/api/students/30305").json()["name"] == "전입생"
    assert client.delete("/api/roster/30101").status_code == 400  # 출결 자료가 있는 학생
    assert client.delete("/api/roster/30305").status_code == 200
    text = "학번\t이름\t학적\t변동일\t위기\n30102\t김철수\t전출\t2026.11.3\tO\n30306\t새학생\n30307\t이상\t없는상태\n"
    r = client.post("/api/roster/import", json={"text": text}).json()
    assert (r["added"], r["updated"], r["skipped"]) == (1, 1, 1) and len(r["errors"]) == 1
    k = _roster(client)
    assert (k["30102"]["status"], k["30102"]["status_date"], k["30102"]["crisis"]) == ("전출", "2026-11-03", True)
    assert k["30306"]["name"] == "새학생"


def test_bulk_exclusion_skips_months_without_unexcused(client):
    # 김철수는 9월 미인정이 없다 → 9월은 건너뛰고 10월만
    r = client.post("/api/exclusions/bulk", json={"student_ids": ["30101", "30102"], "reason": "학원", "mode": "all", "months": [9, 10]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["saved"] == 2
    assert body["skipped"] == [{"student_id": "30102", "name": "김철수", "month": 9}]
    ex = {e["student_id"]: e for e in client.get("/api/exclusions").json()}
    assert sorted(ex["30102"]["months"]) == ["10"]
    # 미인정이 하나도 없는 학생은 저장하지 않는다
    r = client.post("/api/exclusions/bulk", json={"student_ids": ["30201"], "reason": "학원", "mode": "all", "months": [9]})
    assert r.json()["saved"] == 0
