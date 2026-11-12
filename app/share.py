"""교내망 링크 공유.

업무 담당자 컴퓨터에서 앱이 켜져 있는 동안, 같은 학교망의 다른 컴퓨터가
http://<이 컴퓨터 IP>:<포트>/s/<암호키> 로 「미인정 출결 현황」 을 읽기 전용으로 본다.

- 본 앱 서버(127.0.0.1)와 따로 도는 작은 서버다. 이 서버에는 현황 보기·xlsx 내려받기
  세 주소만 있고, 설정·제외·회의록 같은 다른 기능은 없다.
- 암호키가 맞지 않거나 공유가 꺼져 있으면 404 를 돌려준다. 「새 주소 만들기」 로 키를 바꾸면
  옛 주소는 바로 막힌다.
- 자료는 학교망 밖으로 나가지 않는다(외부 서버 없음).
"""
from __future__ import annotations

import os
import secrets
import socket
import threading
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from . import db
from . import report as RP
from . import service as S

DEFAULT_PORT = 8790
KEY = "share"

_lock = threading.Lock()
_server: Any = None
_thread: Optional[threading.Thread] = None
_port: Optional[int] = None
_error: Optional[str] = None


# ---------------------------------------------------------------- 설정

def get_conf(conn) -> Dict[str, Any]:
    c = db.get_setting(conn, KEY) or {}
    return {"enabled": bool(c.get("enabled")), "token": c.get("token") or "", "port": int(c.get("port") or DEFAULT_PORT)}


def _save_conf(conn, conf: Dict[str, Any]) -> None:
    db.set_setting(conn, KEY, conf)


def new_token() -> str:
    return secrets.token_urlsafe(18)


def lan_ips() -> List[str]:
    """이 컴퓨터의 학교망 IP. 외부로 패킷을 보내지 않는다(UDP connect 는 경로만 정한다)."""
    ips: List[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))
            ips.append(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return [ip for ip in ips if not ip.startswith("127.") and not ip.startswith("169.254.") and ip != "0.0.0.0"]


# ---------------------------------------------------------------- 공유 서버

share_app = FastAPI(title="미인정 출결 현황 공유", docs_url=None, redoc_url=None, openapi_url=None)


def _check(token: str) -> None:
    with db.session() as conn:
        c = get_conf(conn)
    if not c["enabled"] or not c["token"] or not secrets.compare_digest(token.encode(), c["token"].encode()):
        raise S.AppError("공유 주소가 없거나 꺼져 있습니다", 404)


@share_app.exception_handler(S.AppError)
def _err(_: Request, e: S.AppError):
    if e.status == 404:
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'><title>공유 꺼짐</title>"
            "<body style='font-family:sans-serif;padding:40px;color:#44403c'>"
            "<h2>열 수 없는 주소입니다</h2><p>공유가 꺼졌거나 새 주소로 바뀌었습니다. 업무 담당 선생님께 새 주소를 받으십시오.</p></body>",
            status_code=404,
        )
    return JSONResponse({"detail": e.message}, status_code=e.status)


def _months(s: Optional[str]) -> List[int]:
    return [int(x) for x in (s or "").split(",") if x.strip().isdigit() and 1 <= int(x) <= 12]


@share_app.get("/s/{token}")
def view(token: str):
    _check(token)
    return HTMLResponse(RP.view_html("live"), headers={"Cache-Control": "no-store"})


@share_app.get("/s/{token}/data")
def data(token: str):
    _check(token)
    with db.session() as conn:
        return JSONResponse(RP.build(conn), headers={"Cache-Control": "no-store"})


@share_app.get("/s/{token}/report.xlsx")
def xlsx(token: str, scope: str = "all", grade: Optional[int] = None, cls: Optional[int] = None,
         sid: Optional[str] = None, months: Optional[str] = None):
    _check(token)
    with db.session() as conn:
        d = RP.build(conn)
    body = RP.to_xlsx(d, scope, grade, cls, sid, _months(months))
    from urllib.parse import quote

    name = RP.title_of(d, scope, grade, cls, sid) + ".xlsx"
    return Response(body, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename*=UTF-8''%s" % quote(name)})


@share_app.get("/{rest:path}")
def nothing(rest: str):
    return Response("Not Found", status_code=404)


def _port_free(p: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", p))
            return True
        except OSError:
            return False


def _start(port: int) -> None:
    """공유 서버를 띄운다(이미 떠 있으면 그대로). port 가 쓰이고 있으면 다음 번호 9개까지 시도."""
    global _server, _thread, _port, _error
    if _server is not None and _thread is not None and _thread.is_alive():
        return
    import uvicorn

    _error = None
    cand = [p for p in range(port, port + 10) if _port_free(p)]
    if not cand:
        _error = "포트 %d~%d 가 모두 쓰이고 있습니다" % (port, port + 9)
        return
    p = cand[0]
    cfg = uvicorn.Config(share_app, host=os.environ.get("GS_SHARE_HOST", "0.0.0.0"), port=p,
                         log_level="warning", access_log=False)
    srv = uvicorn.Server(cfg)
    t = threading.Thread(target=srv.run, daemon=True, name="share-server")
    t.start()
    for _ in range(50):
        if srv.started:
            break
        if not t.is_alive():
            break
        time.sleep(0.1)
    if not srv.started:
        _error = "공유 서버를 열지 못했습니다"
        srv.should_exit = True
        return
    _server, _thread, _port = srv, t, p


def _stop() -> None:
    global _server, _thread, _port
    srv, t = _server, _thread
    _server, _thread, _port = None, None, None
    if srv is not None:
        srv.should_exit = True
    if t is not None:
        t.join(timeout=5)


def running() -> bool:
    return _server is not None and _thread is not None and _thread.is_alive()


def status(conn) -> Dict[str, Any]:
    c = get_conf(conn)
    on = c["enabled"] and running()
    port = _port or c["port"]
    ips = lan_ips() if on else []
    return {
        "enabled": c["enabled"], "running": on, "port": port, "error": _error if c["enabled"] else None,
        "urls": ["http://%s:%d/s/%s" % (ip, port, c["token"]) for ip in ips] if on else [],
    }


def apply(conn, action: str) -> Dict[str, Any]:
    with _lock:
        c = get_conf(conn)
        if action == "enable":
            c["enabled"] = True
            if not c["token"]:
                c["token"] = new_token()
            _save_conf(conn, c)
            _start(c["port"])
        elif action == "disable":
            c["enabled"] = False
            _save_conf(conn, c)
            _stop()
        elif action == "rotate":
            c["token"] = new_token()
            _save_conf(conn, c)
        else:
            raise S.AppError("알 수 없는 동작입니다", 400)
        return status(conn)


def autostart() -> None:
    """앱을 켤 때 공유가 켜져 있었으면 다시 연다."""
    if os.environ.get("GS_SHARE_DISABLE"):
        return
    with db.session() as conn:
        c = get_conf(conn)
    if c["enabled"]:
        with _lock:
            _start(c["port"])


def shutdown() -> None:
    with _lock:
        _stop()
