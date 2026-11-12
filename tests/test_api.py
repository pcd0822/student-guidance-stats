"""API 흐름: 원본 업로드 → 대상자 → 제외·알림 → 회의록 → hwpx → 확정."""
import io
import zipfile
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient

REF = Path(__file__).resolve().parent.parent / "reference"
RAW = REF / "neis_raw_sample.xlsx"
pytestmark = pytest.mark.skipif(not RAW.exists(), reason="샘플 파일 없음")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    from app import db
    db.reset_init_cache()
    from app.server import app
    with TestClient(app) as c:
        c.put("/api/settings", json={"current_year": 2026, "grades": [3], "setup_done": True,
                                     "rules": {"measures": {"3": {"1": "담임 상담", "2": "교내 환경정화활동", "3": "학부모 상담", "final": "선도위원회 회부"}}}})
        yield c


def _xlsx_from_raw(month_from: str, month_to: str, edit=None) -> bytes:
    """원본 샘플의 기간·값을 바꾼 파일(다른 달 자료 흉내)."""
    wb = openpyxl.load_workbook(RAW)
    ws = wb.worksheets[0]
    for row in ws.iter_rows():
        for c in row:
            if c.value == "2026.10.01":
                c.value = month_from
            elif c.value == "2026.10.31":
                c.value = month_to
    if edit:
        edit(ws)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def _upload(client, data: bytes, grades=(3,), month=None, overwrite=False):
    r = client.post("/api/upload/preview", files={"file": ("download.xlsx", data)})
    assert r.status_code == 200, r.text
    pv = r.json()
    body = {"token": pv["token"], "grades": list(grades), "month": month or pv["suggested_month"],
            "school_year": pv["school_year"], "overwrite": overwrite}
    return pv, client.post("/api/upload/commit", json=body)


def test_full_flow(client):
    pv, r = _upload(client, RAW.read_bytes())
    assert pv["months"] == [10] and pv["school_year"] == 2026
    assert {g["grade"]: g["count"] for g in pv["grades"]} == {1: 72, 2: 61, 3: 139}
    assert r.status_code == 200 and r.json()["saved"] == {"3": 139}

    # 같은 달 다시 올리면 확인 요구 → 덮어쓰기(두 번 더해지지 않음)
    _, r2 = _upload(client, RAW.read_bytes())
    assert r2.status_code == 409
    _, r3 = _upload(client, RAW.read_bytes(), overwrite=True)
    assert r3.status_code == 200

    st = client.get("/api/state").json()
    assert st["months_by_grade"] == {"3": [10]}
    assert st["settings"]["school_name"].endswith("학교")

    d = client.get("/api/dashboard", params={"grade": 3, "lookup_months": "10"}).json()
    assert d["summary"]["lookup"] > 0
    # 덮어쓰기 뒤에도 값이 한 번만 더해졌는지: 30107 학생 미인정 결석 9
    row = next(x for x in d["lookup"] if x["student_id"] == "30107")
    assert row["raw"]["abs"] == 9 and row["score"] == 9
    targets = {t["student_id"]: t for t in d["targets"]}
    assert "30107" in targets
    assert targets["30107"]["stage"]["label"] == "학년부 생활지도(1차)"
    assert targets["30107"]["stage"]["measure"] == "담임 상담"

    # 서류 횟수 제외 + 서류에 없는 내역 알림
    r = client.put("/api/exclusions", json={"student_id": "30107", "months": {"10": [
        {"reason": "학원 수강", "mode": "documented", "counts": {"abs": 20}}]}})
    assert r.status_code == 400 and "기록은 9회" in r.json()["detail"]
    r = client.put("/api/exclusions", json={"student_id": "30107", "months": {"10": [
        {"reason": "학원 수강", "mode": "documented", "counts": {"abs": 7}}]}})
    assert r.status_code == 200 and r.json()["new_alerts"] == 1
    al = client.get("/api/alerts", params={"status": "open"}).json()
    assert len(al) == 1 and al[0]["missing"] == 2 and al[0]["month"] == 10
    d = client.get("/api/dashboard", params={"grade": 3, "lookup_months": "10"}).json()
    assert "30107" not in {t["student_id"] for t in d["targets"]}  # 2점
    # 확인함 → 같은 값이면 다시 뜨지 않음
    client.post("/api/alerts/%d/ack" % al[0]["id"])
    client.put("/api/exclusions", json={"student_id": "30107", "months": {"10": [
        {"reason": "학원 수강", "mode": "documented", "counts": {"abs": 7}}]}})
    assert client.get("/api/alerts", params={"status": "open"}).json() == []
    x = client.get("/api/alerts/export.xlsx")
    assert x.status_code == 200 and x.content[:2] == b"PK"

    # 회의록: 대상자 2명, 1명은 위기관리학생
    ids = [t["student_id"] for t in d["targets"]][:2]
    draft = client.post("/api/meetings/draft", json={"grade": 3, "student_ids": ids, "basis_month": 10,
                                                     "opts": {"date": "2026-11-16", "kinds": {ids[1]: "crisis"}}}).json()
    assert draft["seq"] == 1
    assert draft["title"] == "2026 제1차 3학년부 학생선도 소위원회 회의록"
    assert draft["datetime_text"].startswith("2026년 11월 16일 (월)")
    assert draft["basis_date_text"] == "2026. 10. 31."
    assert draft["students"][0]["total_lines"][-1].startswith("10월 합계: 미인정")
    m = client.post("/api/meetings", json=draft).json()
    h = client.get("/api/meetings/%d/hwpx" % m["id"])
    assert h.status_code == 200
    assert "filename*=UTF-8''2026_%EC%A0%9C1%EC%B0%A8" in h.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(h.content)) as z:
        sec = z.read("Contents/section0.xml").decode("utf-8")
    assert ids[0] in sec and ids[1] in sec
    fin = client.post("/api/meetings/%d/finalize" % m["id"]).json()
    assert fin["guidance_added"] == 1  # 위기관리학생은 이력에 쌓지 않음
    g = client.get("/api/guidance").json()
    assert [(x["student_id"], x["step"], x["month"]) for x in g] == [(ids[0], 1, 10)]
    # 지도한 달까지 초기화 → 대상자에서 빠지고, 다음 회차는 2
    d = client.get("/api/dashboard", params={"grade": 3, "lookup_months": "10"}).json()
    assert ids[0] not in {t["student_id"] for t in d["targets"]}
    assert ids[1] in {t["student_id"] for t in d["targets"]}
    draft2 = client.post("/api/meetings/draft", json={"grade": 3, "student_ids": [ids[1]]}).json()
    assert draft2["seq"] == 2

    # 개인별 통계
    p = client.get("/api/personal/%s" % ids[0]).json()
    assert p["guidance"][0]["step"] == 1 and p["months"][0]["counted"] is False

    # 다음 달(11월) 자료: 지도받은 학생이 다시 셀 수 있어야 함
    _, r = _upload(client, _xlsx_from_raw("2026.11.01", "2026.11.30"))
    assert r.status_code == 200
    d = client.get("/api/dashboard", params={"grade": 3, "lookup_months": "10,11"}).json()
    t = {x["student_id"]: x for x in d["targets"]}
    assert ids[0] in t and t[ids[0]]["stage"]["label"] == "학년부 생활지도(2차)"
    assert [pm["month"] for pm in t[ids[0]]["months"] if pm["counted"]] == [11]
    # 서류 미등록 알림(11월, 30107)
    al = client.get("/api/alerts", params={"status": "open"}).json()
    assert any(a["student_id"] == "30107" and a["month"] == 11 and a["kind"] == "undocumented" for a in al)


def test_readonly_previous_year(client):
    _upload(client, RAW.read_bytes())
    client.post("/api/school-year", json={"year": 2027})
    r = client.put("/api/exclusions", json={"school_year": 2026, "student_id": "30107", "all_period": True, "all_reason": "자퇴"})
    assert r.status_code == 403
    st = client.get("/api/state", params={"school_year": 2026}).json()
    assert st["readonly"] is True and 2026 in st["school_years"]


def test_backup_restore(client):
    _upload(client, RAW.read_bytes())
    b = client.get("/api/backup")
    assert b.status_code == 200
    with zipfile.ZipFile(io.BytesIO(b.content)) as z:
        assert {"app.db", "settings.json", "meta.json"} <= set(z.namelist())
    client.delete("/api/uploads/%d" % client.get("/api/uploads").json()[0]["id"])
    assert client.get("/api/state").json()["months_by_grade"] == {}
    r = client.post("/api/restore", files={"file": ("b.zip", b.content)})
    assert r.status_code == 200
    assert client.get("/api/state").json()["months_by_grade"] == {"3": [10]}


def test_paste_import(client):
    _upload(client, RAW.read_bytes())
    r = client.post("/api/import-paste", json={"kind": "guidance", "text": "학번\t이름\t1회\t2회\t3회\t선도위\n30107\t홍길동\t5월\t9월\t\t\n"})
    assert r.json()["added"] == 2
    g = client.get("/api/guidance").json()
    assert [(x["step"], x["month"]) for x in g] == [(1, 5), (2, 9)]
    r = client.post("/api/import-paste", json={"kind": "exclusion", "text": "30101\t김철수\t자퇴생"})
    assert r.json()["added"] == 1
    ex = client.get("/api/exclusions").json()
    assert ex[0]["all_period"] is True and ex[0]["all_reason"] == "자퇴생"
