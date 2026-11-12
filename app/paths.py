"""파일 위치. 모든 데이터는 이 컴퓨터의 data/ 폴더 안에만 둔다."""
from __future__ import annotations

import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
STATIC_DIR = APP_DIR / "static"
DEFAULT_TEMPLATE = APP_DIR / "templates" / "minutes_template.hwpx"


def data_dir() -> Path:
    d = Path(os.environ.get("APP_DATA_DIR") or (ROOT_DIR / "data"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def db_path() -> Path:
    return data_dir() / "app.db"


def custom_template_path() -> Path:
    return data_dir() / "minutes_template.hwpx"


def template_path() -> Path:
    """설정에서 바꿔 끼운 양식이 있으면 그것을, 없으면 기본 양식을 쓴다."""
    p = custom_template_path()
    return p if p.exists() else DEFAULT_TEMPLATE


def tmp_dir() -> Path:
    d = data_dir() / "tmp"
    d.mkdir(parents=True, exist_ok=True)
    return d
