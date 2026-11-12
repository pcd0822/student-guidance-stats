"""미인정 출결 현황: 자료·xlsx·공유 파일·교내망 공유 서버. 지어낸 학생만 쓴다."""
import io
import json
import re
import urllib.error
import urllib.request

import openpyxl
import pytest
from fastapi.testclient import TestClient

from tests.test_batch import neis_xlsx


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GS_SHARE_HOST", "127.0.0.1")  # 시험에서는 학교망에 열지 않는다
    from app import db
    db.reset_init_cache()
    from app.server import app
    with TestClient(app) as c:
        c.put("/api/settings", json={"current_year": 2026, "grades": [3], "setup_done": True, "school_name": "가나고등학교"})
        files = [("9.xlsx", neis_xlsx("2026.09.01", "2026.09.30", {"홍길동": (1, 2, 0, 0), "이영희": (0, 0, 3, 0)})),
                 ("10.xlsx", neis_xlsx("2026.10.01", "2026.10.31", {"홍길동": (0, 1, 3, 0), "김철수": (2, 0, 0, 1)}))]
        pv = c.post("/api/upload/preview-many", files=[("files", f) for f in files]).json()
        assert c.post("/api/upload/commit-many", json={"grades": [3], "items": [{"token": p["token"]} for p in pv]}).status_code == 200
        # 홍길동 10월 조퇴 3회 중 2회는 서류 확인, 이영희 9월은 그 달 전체 제외
        assert c.put("/api/exclusions", json={"student_id": "30101", "months": {"10": [{"reason": "병원", "mode": "documented", "counts": {"leave": 2}}]}}).status_code == 200
        assert c.put("/api/exclusions", json={"student_id": "30201", "months": {"9": [{"reason": "숙려제", "mode": "all"}]}}).status_code == 200
        yield c
        c.post("/api/share", json={"action": "disable"})


def _stu(d, sid):
    return next(s for s in d["students"] if s["student_id"] == sid)


def test_report_keeps_raw_and_marks_exclusions(client):
    d = client.get("/api/report").json()
    assert d["school_name"] == "가나고등학교" and d["grades"] == {"3": [9, 10]}
    assert [s["student_id"] for s in d["students"]] == ["30101", "30102", "30201"]  # 미인정 없는 학생은 빠진다
    h = _stu(d, "30101")
    assert h["months"]["10"]["raw"]["leave"] == 3 and h["months"]["10"]["doc"]["leave"] == 2 and not h["months"]["10"]["all"]
    y = _stu(d, "30201")
    assert y["months"]["9"]["raw"]["leave"] == 3 and y["months"]["9"]["all"] is True and y["months"]["9"]["reasons"] == ["숙려제"]


def _wb(r):
    assert r.status_code == 200, r.text
    return openpyxl.load_workbook(io.BytesIO(r.content))


def test_xlsx_scopes(client):
    wb = _wb(client.get("/api/report.xlsx", params={"scope": "all"}))
    assert wb.sheetnames == ["3-1", "3-2"]
    ws = wb["3-1"]
    assert [c.value for c in ws[3]][:8] == ["반", "번호", "학번", "이름", "항목", "9월", "10월", "합계"]
    # 홍길동: 4행(결석·지각·조퇴·결과), 10월 조퇴 칸은 「3 (서류 2)」 + 회색
    rows = [[c.value for c in r] for r in ws.iter_rows(min_row=4, max_row=7)]
    assert rows[0][2] == "30101" and rows[0][4] == "미인정 결석" and rows[0][5] == 1
    assert rows[2][6] == "3 (서류 2)" and ws.cell(row=6, column=7).fill.fgColor.rgb.endswith("E7E5E4")
    assert rows[2][7] == "3 (제외 2)"
    # 환산(제외 반영): 결석 1 + ⌊(지각 3 + 조퇴 1)/3⌋ = 2점, 이월 1
    assert rows[0][8] == "2점 (이월 1)"
    # 이영희 9월은 그 달 전체 제외 → 네 칸 모두 회색, 값은 원자료 그대로
    wb2 = _wb(client.get("/api/report.xlsx", params={"scope": "class", "grade": 3, "cls": 2}))
    ws2 = wb2["3-2"]
    assert ws2.cell(row=6, column=6).value == 3 and all(ws2.cell(row=r, column=6).fill.fgColor.rgb.endswith("E7E5E4") for r in range(4, 8))
    # 학생 한 명 + 달 고르기
    wb3 = _wb(client.get("/api/report.xlsx", params={"scope": "student", "sid": "30102", "months": "10"}))
    ws3 = wb3.active
    assert [c.value for c in ws3[3]][5:7] == ["10월", "합계"] and ws3.cell(row=4, column=3).value == "30102"
    assert client.get("/api/report.xlsx", params={"scope": "class", "grade": 3}).status_code == 400
    assert client.get("/api/report.xlsx", params={"scope": "nope"}).status_code == 400


def test_share_file_embeds_data(client):
    r = client.get("/api/share/file")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    html = r.content.decode("utf-8")
    assert "/*__BOOT__*/" not in html
    m = re.search(r"var BOOT = (\{.*?\});\n", html, re.S)
    boot = json.loads(m.group(1))
    assert boot["mode"] == "file" and len(boot["data"]["students"]) == 3
    # 외부 주소를 부르지 않는다
    assert not re.search(r"(src|href)=[\"']https?://", html)


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_lan_share_lifecycle(client):
    st = client.get("/api/share").json()
    assert st["enabled"] is False and st["running"] is False and st["urls"] == []
    st = client.post("/api/share", json={"action": "enable"}).json()
    assert st["enabled"] and st["running"], st
    from app import db, share
    with db.session() as conn:
        token = share.get_conf(conn)["token"]
    base = "http://127.0.0.1:%d" % st["port"]
    assert len(token) >= 20 and all(token in u for u in st["urls"])
    code, body = _get("%s/s/%s" % (base, token))
    assert code == 200 and "미인정 출결 현황" in body.decode("utf-8") and '"mode": "live"' in body.decode("utf-8")
    code, body = _get("%s/s/%s/data" % (base, token))
    assert code == 200 and len(json.loads(body)["students"]) == 3
    code, body = _get("%s/s/%s/report.xlsx?scope=class&grade=3&cls=1" % (base, token))
    assert code == 200 and openpyxl.load_workbook(io.BytesIO(body)).sheetnames == ["3-1"]
    # 다른 기능은 공유 서버에 없다
    assert _get("%s/api/state" % base)[0] == 404
    assert _get("%s/s/wrong-token/data" % base)[0] == 404
    # 새 주소를 만들면 옛 주소는 막힌다
    client.post("/api/share", json={"action": "rotate"})
    assert _get("%s/s/%s/data" % (base, token))[0] == 404
    with db.session() as conn:
        token2 = share.get_conf(conn)["token"]
    assert token2 != token and _get("%s/s/%s/data" % (base, token2))[0] == 200
    # 끄면 서버도 닫힌다
    st = client.post("/api/share", json={"action": "disable"}).json()
    assert st["enabled"] is False and st["running"] is False
    with pytest.raises(Exception):
        urllib.request.urlopen("%s/s/%s" % (base, token2), timeout=2)
    assert client.post("/api/share", json={"action": "boom"}).status_code == 400
