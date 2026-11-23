"""검은 창 없이 켜기(v1.0.6): 바탕 화면 바로 가기 → start.vbs → pythonw -m app --launcher.
설치가 더 필요하거나 앱 창을 못 열면 보이는 start.bat 창으로 넘긴다."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

import app.__main__ as entry
from app import paths

ROOT = paths.ROOT_DIR


def test_requirements_hash_matches_bootstrap(tmp_path):
    """bootstrap.ps1 의 Get-ReqHash 와 같은 값이어야 설치 여부를 바르게 판단한다."""
    if os.name != "nt":
        pytest.skip("PowerShell 은 윈도우에서만")
    ps = ("$a=[IO.File]::ReadAllBytes('%s');$b=[IO.File]::ReadAllBytes('%s');"
          "$h=[Security.Cryptography.SHA256]::Create().ComputeHash([byte[]]($a+$b));"
          "($h|ForEach-Object{$_.ToString('x2')}) -join ''") % (ROOT / "requirements.txt", ROOT / "requirements-window.txt")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout.strip()
    assert out == entry.requirements_hash(ROOT)


def test_requirements_ready(tmp_path):
    for name in ("requirements.txt", "requirements-window.txt"):
        (tmp_path / name).write_bytes((ROOT / name).read_bytes())
    assert not entry.requirements_ready(tmp_path)  # .venv 없음
    (tmp_path / ".venv").mkdir()
    (tmp_path / ".venv" / ".requirements.sha256").write_text(entry.requirements_hash(tmp_path), encoding="ascii")
    assert entry.requirements_ready(tmp_path)
    (tmp_path / "requirements.txt").write_text("새패키지==1.0\n", encoding="utf-8")
    assert not entry.requirements_ready(tmp_path)  # 업데이트로 패키지가 바뀜


@pytest.fixture()
def handed(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(entry, "hand_over", lambda root, extra: calls.append(list(extra)))
    monkeypatch.setattr(entry, "run_server", lambda port: pytest.fail("서버를 띄우면 안 됩니다"))
    monkeypatch.delenv("GS_HANDOFF", raising=False)
    return calls


def test_launcher_hands_over_when_packages_must_be_installed(handed, monkeypatch):
    monkeypatch.setattr(entry, "requirements_ready", lambda root: False)
    monkeypatch.setattr(sys, "argv", ["app", "--launcher"])
    entry.main()
    assert handed == [[]]


def test_launcher_uses_browser_window_when_webview_missing(handed, monkeypatch):
    monkeypatch.setattr(entry, "requirements_ready", lambda root: True)
    monkeypatch.setitem(sys.modules, "webview", None)  # import webview → ImportError
    monkeypatch.setattr(sys, "argv", ["app", "--launcher"])
    entry.main()
    assert handed == [["--browser"]]


def test_launcher_does_not_loop_after_handoff(handed, monkeypatch):
    """start.bat 이 넘겨받아 설치한 뒤 다시 창 없이 켰는데도 맞지 않으면, 또 넘기지 않고 계속 진행한다."""
    monkeypatch.setenv("GS_HANDOFF", "1")
    monkeypatch.setattr(entry, "requirements_ready", lambda root: False)
    monkeypatch.setitem(sys.modules, "webview", None)
    monkeypatch.setattr(sys, "argv", ["app", "--launcher"])
    entry.main()
    assert handed == [["--browser"]]  # 설치 때문에 넘기지는 않음(앱 창 문제로만)


def test_launcher_log_when_no_console(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    entry.launcher_streams()
    print("창 없이 켬")
    sys.stdout.flush()
    assert "창 없이 켬" in (tmp_path / "data" / "launch.log").read_text(encoding="utf-8")
    sys.stdout.close()


def test_start_vbs_is_ascii_crlf_and_falls_back_to_start_bat():
    raw = (ROOT / "start.vbs").read_bytes()
    assert all(b < 128 for b in raw)
    assert b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")
    text = raw.decode("ascii")
    assert '-m app --launcher", 0, False' in text  # 창 숨김
    assert 'start.bat""", 1, False' in text  # 처음 실행은 보이는 창


def test_shortcut_runs_start_vbs():
    ps1 = (ROOT / "scripts" / "install.ps1").read_text(encoding="utf-8-sig")
    assert "wscript.exe" in ps1 and "start.vbs" in ps1
    bat = (ROOT / "start.bat").read_bytes()
    assert all(b < 128 for b in bat)
    assert b"pythonw.exe\" -m app --launcher" in bat
