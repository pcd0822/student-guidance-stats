#!/usr/bin/env bash
# 생활지도·학생선도 통계 — 실행 스크립트 (macOS·리눅스)
#
# 하는 일
#  1. 자기 폴더로 이동
#  2. Python 3.10 이상을 찾는다. 없으면 uv 로 최신 Python 을 이 폴더의 .tools/ 안에 자동 설치한다
#     (관리자 권한 필요 없음, 이 폴더 밖은 건드리지 않음)
#  3. .venv 가 없거나 Python 이 3.10 미만이면 새로 만든다
#  4. requirements.txt 가 바뀌었을 때만 패키지 설치
#  5. python -m app 실행
set -e
cd "$(dirname "$0")"

ROOT="$PWD"
TOOLS="$ROOT/.tools"
export UV_PYTHON_INSTALL_DIR="$TOOLS/python"   # uv 가 받은 Python 은 여기에만
export UV_CACHE_DIR="$TOOLS/cache"
export UV_PYTHON_INSTALL_BIN=0                  # ~/.local/bin 에 링크를 만들지 않음
FALLBACK_PY="3.13"                              # 최신판에서 패키지가 안 깔릴 때 쓸 버전

pause_exit() {
  echo "$1"
  read -r -p "엔터를 누르면 닫습니다" _ || true
  exit 1
}

venv_ok() {
  [ -x .venv/bin/python ] && .venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null
}

find_system_python() {
  for c in python3.15 python3.14 python3.13 python3.12 python3.11 python3.10 python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

UV=""
get_uv() {
  if [ -n "$UV" ]; then return 0; fi
  if [ -x "$TOOLS/uv/uv" ]; then UV="$TOOLS/uv/uv"; return 0; fi
  if command -v uv >/dev/null 2>&1; then UV="$(command -v uv)"; return 0; fi
  echo "Python 설치 도구(uv)를 내려받습니다…"
  mkdir -p "$TOOLS"
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh -o "$TOOLS/uv-install.sh"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TOOLS/uv-install.sh" https://astral.sh/uv/install.sh
  else
    pause_exit "인터넷에서 내려받을 도구(curl/wget)가 없습니다. https://www.python.org/downloads/ 에서 Python 을 직접 설치하십시오."
  fi
  env UV_UNMANAGED_INSTALL="$TOOLS/uv" INSTALLER_NO_MODIFY_PATH=1 sh "$TOOLS/uv-install.sh" >/dev/null
  rm -f "$TOOLS/uv-install.sh"
  [ -x "$TOOLS/uv/uv" ] || pause_exit "uv 를 설치하지 못했습니다. https://www.python.org/downloads/ 에서 Python 을 직접 설치하십시오."
  UV="$TOOLS/uv/uv"
}

# uv 로 Python 을 받아 .venv 를 만든다. 인자: 버전(빈칸이면 최신판)
make_managed_venv() {
  get_uv
  local ver="${1:-}"
  echo "Python ${ver:-최신판}을 이 폴더 안에 설치합니다(처음 한 번)…"
  if [ -n "$ver" ]; then
    "$UV" python install --no-bin "$ver"
    "$UV" venv --clear --seed --managed-python --python "$ver" .venv >/dev/null
  else
    "$UV" python install --no-bin
    "$UV" venv --clear --seed --managed-python --python 3 .venv >/dev/null
  fi
}

MANAGED=0
if ! venv_ok; then
  if [ -z "${GS_FORCE_MANAGED:-}" ] && PY="$(find_system_python)"; then
    echo "가상 환경을 만듭니다($("$PY" --version))…"
    "$PY" -m venv --clear .venv
  else
    make_managed_venv ""
    MANAGED=1
  fi
fi
echo "$(.venv/bin/python --version) 로 실행합니다."

install_requirements() {
  local hash_file=.venv/.requirements.sha256
  local new_hash old_hash
  new_hash=$(.venv/bin/python -c 'import hashlib;print(hashlib.sha256(open("requirements.txt","rb").read()+open("requirements-window.txt","rb").read()).hexdigest())')
  old_hash=$(cat "$hash_file" 2>/dev/null || true)
  if [ "$new_hash" != "$old_hash" ]; then
    echo "필요한 패키지를 설치합니다(처음 한 번, 몇 분 걸릴 수 있습니다)…"
    .venv/bin/python -m pip install --upgrade pip >/dev/null || return 1
    .venv/bin/python -m pip install -r requirements.txt || return 1
    # 앱 창 패키지는 실패해도 브라우저로 열 수 있으니 멈추지 않는다
    .venv/bin/python -m pip install -r requirements-window.txt || echo "앱 창 패키지를 설치하지 못해 기본 브라우저로 엽니다."
    echo "$new_hash" > "$hash_file"
  fi
}

if ! install_requirements; then
  if [ "$MANAGED" = "1" ]; then
    echo "최신 Python 에 맞는 패키지가 아직 없어 Python $FALLBACK_PY 로 다시 시도합니다…"
    make_managed_venv "$FALLBACK_PY"
    install_requirements || pause_exit "패키지를 설치하지 못했습니다. 인터넷 연결을 확인하십시오."
  else
    pause_exit "패키지를 설치하지 못했습니다. 인터넷 연결을 확인하십시오."
  fi
fi

exec .venv/bin/python -m app "$@"
