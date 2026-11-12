"""python -m app — 서버를 띄우고 앱 창을 연다.

pywebview 를 쓸 수 없으면 기본 브라우저로 http://127.0.0.1:<빈 포트> 를 연다.
"""
from __future__ import annotations

import argparse
import base64
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

TITLE = "생활지도·학생선도 통계"


def free_port(preferred: int = 0) -> int:
    for p in ([preferred] if preferred else []) + [0]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("빈 포트를 찾지 못했습니다")


def run_server(port: int) -> threading.Thread:
    import uvicorn

    from .server import app

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=0.5)
            return t
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("서버가 시작되지 않았습니다")


def clean_tmp() -> None:
    from . import paths

    d = paths.data_dir() / "tmp"
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


class JsApi:
    """창 안의 화면이 부르는 기능(파일 저장·열기). 브라우저 모드에서는 쓰지 않는다.

    주의: pywebview 는 이 객체의 공개 속성(이름이 _ 로 시작하지 않는 것)을 끝까지 따라가며
    화면에 내보낸다. 창 객체를 공개 속성으로 두면 윈도우에서 .NET 객체의 Empty.Empty.… 를
    끝없이 따라가다 「maximum recursion depth exceeded」로 멈춘다(v1.0.2 까지의 버그).
    그래서 창은 반드시 _window 처럼 _ 로 시작하는 이름에 둔다.
    """

    def __init__(self):
        self._window = None

    def save_file(self, filename: str, b64: str) -> dict:
        import webview

        try:
            res = self._window.create_file_dialog(webview.SAVE_DIALOG, save_filename=filename)
        except Exception as e:  # pragma: no cover
            return {"ok": False, "error": str(e)}
        if not res:
            return {"ok": False, "cancelled": True}
        path = res if isinstance(res, str) else res[0]
        Path(path).write_bytes(base64.b64decode(b64))
        return {"ok": True, "path": path}

    def open_temp(self, filename: str, b64: str) -> dict:
        """인쇄용: 임시 파일로 저장해 기본 프로그램(미리보기 등)으로 연다."""
        from . import paths

        p = paths.tmp_dir() / filename
        p.write_bytes(base64.b64decode(b64))
        open_path(str(p))
        return {"ok": True, "path": str(p)}

    def reveal(self, path: str) -> dict:
        open_path(str(Path(path).parent))
        return {"ok": True}


_selftest = {"code": 1}


def start_selftest(win, wait: int) -> None:
    """검사용: 창이 뜨면 화면이 그려졌는지·window.pywebview.api 가 이어졌는지 보고 창을 닫는다."""
    import logging

    errors = []

    class Catch(logging.Handler):
        def emit(self, record):
            if record.levelno >= logging.ERROR:
                errors.append(record.getMessage())

    logging.getLogger("pywebview").addHandler(Catch())

    def run():
        deadline = time.time() + wait
        ok, info = False, ""
        while time.time() < deadline and not ok:
            time.sleep(1)
            try:
                info = win.evaluate_js(
                    "JSON.stringify({api: !!(window.pywebview && window.pywebview.api && window.pywebview.api.save_file),"
                    " root: document.querySelectorAll('#root *').length,"
                    " text: (document.body.innerText || '').slice(0, 40)})"
                )
                d = __import__("json").loads(info or "{}")
                ok = bool(d.get("api")) and d.get("root", 0) > 5
            except Exception as e:  # 창이 아직 준비 중
                info = "evaluate_js: %s" % e
        print("창 자체 시험: %s · %s · pywebview 오류 %d건" % ("통과" if ok and not errors else "실패", info, len(errors)), flush=True)
        for m in errors[:5]:
            print("  pywebview 오류: %s" % m[:200], flush=True)
        _selftest["code"] = 0 if ok and not errors else 1
        try:
            win.destroy()
        except Exception:
            os._exit(_selftest["code"])

    def watchdog():
        time.sleep(wait + 30)
        print("창 자체 시험: 시간 초과", flush=True)
        os._exit(2)

    threading.Thread(target=run, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()


def open_path(path: str) -> None:
    if sys.platform == "darwin":
        subprocess.Popen(["open", path])
    elif os.name == "nt":
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", path])


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m app")
    ap.add_argument("--browser", action="store_true", help="앱 창 대신 기본 브라우저로 엽니다")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-open", action="store_true", help="서버만 실행합니다(개발용)")
    ap.add_argument("--window-selftest", type=int, default=0, metavar="초",
                    help="앱 창을 열어 화면·창 기능이 이어졌는지 확인하고 닫습니다(검사용)")
    args = ap.parse_args()

    # 윈도우에서 출력을 파일로 돌리면(cp1252 등) 한글 print 가 앱을 멈추지 않게 한다
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass

    clean_tmp()
    port = free_port(args.port)
    url = "http://127.0.0.1:%d/" % port
    t = run_server(port)
    print("%s — %s" % (TITLE, url), flush=True)

    if args.no_open:
        t.join()
        return

    if not args.browser:
        try:
            import webview

            api = JsApi()
            win = webview.create_window(TITLE, url, width=1360, height=900, min_size=(1024, 680), js_api=api)
            api._window = win  # _ 로 시작해야 화면에 내보내지지 않는다
            if args.window_selftest:
                start_selftest(win, args.window_selftest)
            webview.start()
            if args.window_selftest:
                sys.exit(_selftest["code"])
            return
        except Exception as e:
            print("앱 창을 열지 못해 브라우저로 엽니다: %s" % e, flush=True)

    webbrowser.open(url)
    print("창을 닫아도 서버는 이 터미널에서 계속 돕니다. 끝내려면 Ctrl+C 를 누르십시오.", flush=True)
    try:
        while t.is_alive():
            t.join(1)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
