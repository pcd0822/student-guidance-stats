# CLAUDE.md — 생활지도·학생선도 통계

Claude Code 가 이 저장소에서 일할 때 먼저 읽는 문서입니다. 사람이 읽는 설치·이어 하기 안내는 `docs/HANDOFF.md`, 업무 규칙(원래 작업 지시서를 개인정보 없이 줄인 것)은 `docs/SPEC.md` 에 있습니다.

## 사용자와 대화 방식

- 사용자는 고등학교 교사이고, 이 앱을 학교 업무용 윈도우 컴퓨터에서 씁니다. 개발자는 아닙니다.
- **모든 답변·안내·화면 문구는 한국어 합니다체**로 씁니다.
- 선택할 게 있으면 번호를 붙인 선택지와 권장안을 내고, 사용자가 고르면 진행합니다. 땜질보다 구조적인 해결을 좋아합니다.
- 작업을 마치면 로컬에서 테스트·빌드로 확인한 다음, 무엇을 고쳤고 학교 컴퓨터에서 무엇을 하면 되는지 짧게 알립니다.

## 절대 지킬 것 (개인정보)

- 학생 자료는 그 컴퓨터 안에만 둡니다. 외부 서버나 CDN 을 부르는 코드는 넣지 않습니다. 첫 설치 때 패키지를 내려받는 것만 예외입니다.
- 진짜 학생·교사 이름, 학교 이름이 든 것은 **git 에 넣지 않습니다**. `.gitignore` 에 이미 들어 있습니다.
  - `reference/*.xlsx`: 나이스 샘플
  - `reference/minutes_template.hwpx`: 원본 회의록
  - `생활지도_학생선도_데스크톱앱_프롬프트.md`: 원래 작업 지시서
  - `data/`: 앱 DB
- 커밋 전에는 `git diff --cached` 로 올라갈 내용에 실명이 없는지 훑어봅니다. 테스트와 예시에는 지어낸 이름(홍길동, 김철수 등)만 씁니다.
- 기본 양식 `app/templates/minutes_template.hwpx` 는 형식만 남긴 빈 양식입니다. `tests/test_minutes.py` 가 이를 지킵니다.
- 화면 스크린샷은 실명이 보이므로 저장소에 넣지 않습니다.

## git·배포 흐름

- 원격 저장소는 `https://github.com/pcd0822/student-guidance-stats` 이고 공개입니다. 기본 브랜치는 `main` 입니다.
- 커밋 작성자는 반드시 `pcd0822 <224205797+pcd0822@users.noreply.github.com>` 로 합니다. 새 컴퓨터에서는 저장소 안에서 `git config user.name` / `user.email` 을 먼저 맞춥니다.
- **커밋은 Claude 가 하고, Push 는 사용자가 GitHub Desktop 에서 누릅니다.** 커밋은 사용자가 하자고 할 때만 합니다.
- 새 판을 내는 순서:
  1. `app/__init__.py` 의 `__version__` 을 올립니다.
  2. `cd frontend && npm run build` 로 화면을 빌드합니다. 결과 `app/static` 도 커밋합니다.
  3. 테스트를 돌리고 커밋합니다. 사용자가 Push 합니다.
  4. GitHub Actions `check` 가 깨끗한 윈도우·맥에서 설치·테스트·앱 창 시험을 합니다.
  5. 통과하면 `release` 가 `v{__version__}` 릴리스와 `GuidanceStats-install.zip` 을 자동으로 만듭니다.
  6. 학교 컴퓨터에서는 바탕 화면의 「생활지도 통계 업데이트」를 누르면 됩니다. `data/` 는 남습니다.
- Actions 상태를 볼 때 GitHub API 를 짧은 간격으로 계속 부르면 요청 한도가 바닥납니다. 간격을 길게 두거나 `git ls-remote` 나 릴리스 내려받기 주소로 확인합니다.
- 버전 기록:

  | 판 | 바뀐 것 |
  |---|---|
  | 1.0.0 | 첫 판 |
  | 1.0.1 | pandas 를 빼서 학교 PC 설치 오류를 고침 |
  | 1.0.2 | 여러 달 파일을 한 번에 올림, 제외 일괄 추가 |
  | 1.0.3 | pywebview recursion 문제를 고침 |
  | 1.0.4 | 학생 관리(학적), 제외 처리 개선, 저장 표시·스피너 |

## 구조

```
app/__init__.py      __version__
app/__main__.py      실행 진입점: pywebview 창 / --browser / --no-open / --window-selftest N
app/server.py        FastAPI 엔드포인트, SPA 정적 파일 제공
app/service.py       DB 업무 로직(대시보드·제외·생활지도·회의록·개인별 통계)
app/rules.py         생활규정 엔진(순수 함수, settings.rules 만 읽음)
app/alerts.py        「서류에 없는 내역」 알림
app/roster.py        학생 관리(학적 상태·위기관리·비고, 명단 동기화·붙여넣기)
app/parse_neis.py    나이스 원본 파서(xlsx / xls / HTML 위장 xls)
app/minutes.py       hwpx 생성(양식 section0.xml 복사·수정)
app/db.py            SQLite 스키마(data/app.db)
frontend/src/        React 18 + Vite 5 + TS + Tailwind 3 (pages/, components/ui.tsx, lib/api.ts)
tests/               pytest(55개). 샘플 xlsx 가 없으면 일부는 건너뜀
scripts/             bootstrap.ps1(윈도우 실행 준비), install.ps1(설치·업데이트·바로 가기)
installer/           install.bat + README.txt → 릴리스 zip
start.sh / start.command / start.bat   실행 스크립트
.github/workflows/   check.yml, release.yml
```

## 개발 명령

```bash
./start.sh                                   # 처음 실행: .venv 를 만들고 앱 실행 (Python 없으면 uv 로 .tools/ 에 설치)
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q                # 테스트
.venv/bin/python -m app --no-open --port 8765
.venv/bin/python -m app --window-selftest 30
cd frontend && npm install && npm run dev    # /api → 8765 프록시
cd frontend && npm run build                 # app/static 에 빌드(커밋 대상)
```

윈도우에서는 `.venv\Scripts\python.exe` 를 씁니다.

## 이미 겪은 함정 (다시 밟지 말 것)

- **학교 PC 에는 컴파일러가 없고, 최신 Python 에 맞는 휠이 없는 패키지가 있습니다.** 패키지를 새로 넣을 때는 순수 Python 이거나 cp313 이상 윈도우 휠이 있는 것만 씁니다. pandas 는 이 문제로 뺐습니다.
  - pip 에는 `--prefer-binary --only-binary=lxml,pydantic-core,cffi,pyobjc-core` 를 줍니다.
  - 실패하면 Python 3.13 으로 다시 시도합니다.
- **PowerShell 5.1 의 함정**
  - .ps1 은 UTF-8 BOM + CRLF 로 저장합니다. .bat 은 ASCII + CRLF 로만 씁니다(한글 금지).
  - stderr 출력이 오류로 취급되므로 `$ErrorActionPreference='Continue'` 를 씁니다.
  - 함수 안의 명령 출력은 반환값이 되어 버립니다. `| Out-Host` 로 돌립니다.
  - `.gitattributes` 에서 `*.bat`, `*.ps1` 은 `-text` 입니다.
- **pywebview js_api** 객체의 공개 속성은 JS 쪽으로 재귀 노출됩니다. 창 객체는 `self._window` 처럼 밑줄 속성으로 둡니다. `tests/test_window_api.py` 와 `--window-selftest` 가 이것을 확인합니다.
- **CI 의 학교 PC 흉내**: `check.yml` 은 vswhere 를 숨겨 컴파일러가 없는 상태를 만들고, `GS_FORCE_MANAGED` / `GS_SIMULATE_NO_WHEEL` 로 대체 경로를 시험합니다. 설치 관련 코드를 바꾸면 이 검사가 그대로 통과해야 합니다.
- **화면 코드**
  - 옛 WebView 를 위해 정규식 lookbehind 를 쓰지 않습니다.
  - 컴포넌트 기본 스타일은 `:where(...)` 로 낮춰 Tailwind 유틸리티가 이기게 합니다.
- **openpyxl** 은 read_only 모드로 열면 나이스 파일이 `[[None]]` 으로 읽힙니다. 일반 모드로 엽니다.
- **hwpx 생성 규칙**
  - mimetype 은 zip 의 첫 항목, 무압축(STORED)으로 넣습니다.
  - 고친 문단의 `linesegarray` 는 지웁니다.
  - 표의 rowCnt·colCnt·cellAddr·cellSpan·열 너비 합을 맞춥니다.
  - 표2 하나에는 학생 3명까지만 둡니다.
  - 한글 프로그램으로 직접 열어 보는 확인은 사용자가 합니다.
- 큰 경로에 `rm -rf` 를 쓰면 안전 검사에 막힙니다. 임시 작업은 새 폴더에서 합니다.

## 이미 확정된 결정

- 회의록을 「확정」하면 **기준 월**까지 누적을 초기화합니다. 회의 날짜의 달이 아닙니다.
- 위기관리학생은 회의록 표2(위반 사항)에는 남기고, 표3(지도 대상)에서는 뺍니다.
- 여러 달을 한 기간으로 받은 나이스 파일(예: 3/1~10/31)은 달별로 나눌 수 없어 받지 않습니다. 달마다 한 파일씩 여러 개를 올립니다.
- 제외 처리의 달 칩은 그 학생에게 미인정이 있는 달만 고를 수 있습니다.
- 학생 관리에는 학적 상태+변동일, 위기관리학생, 비고, 직접 추가·붙여넣기 등록이 있습니다. 자퇴·전출 등은 변동 달부터 학년도 끝까지 제외로도 등록할 수 있습니다.
- 디자인은 `pcd0822/homeroom_manager` 의 `DESIGN.md` 를 따르고, 색만 먹색·청록·인주색으로 바꿨습니다. 자세한 값은 `docs/SPEC.md` 에 있습니다.
