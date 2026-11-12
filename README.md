# 생활지도·학생선도 통계

구글 스프레드시트 + Apps Script(`reference/Code.gs`)로 하던 「출결 통계 / 생활지도 및 학생선도」 업무를 이 컴퓨터 안에서만 돌아가는 데스크톱 앱으로 옮긴 것입니다. 학생 개인정보는 `data/` 폴더 밖으로 나가지 않습니다(외부 서버·CDN 호출 없음, 처음 설치 때 패키지 내려받기만 예외).

## 학교 컴퓨터(윈도우)에 설치

### 설치 파일로 (권장)

1. [**GuidanceStats-install.zip 내려받기**](https://github.com/pcd0822/student-guidance-stats/releases/latest/download/GuidanceStats-install.zip)
2. 압축을 풀고 `install.bat` 을 두 번 누릅니다.
   「Windows의 PC 보호」 창이 뜨면 **추가 정보 → 실행**을 누릅니다.
3. 처음에는 Python 과 필요한 프로그램을 내려받느라 몇 분 걸립니다. 관리자 권한은 필요 없습니다.
4. 바탕 화면에 바로 가기 두 개가 생깁니다.
   - **생활지도·학생선도 통계** — 앱 실행
   - **생활지도 통계 업데이트** — 최신판으로 바꿉니다. 입력한 자료(`data` 폴더)는 그대로 남습니다.

설치 위치는 `C:\Users\<사용자>\GuidanceStats` 입니다. 앱을 쓰는 동안 검은 창을 닫지 마십시오(닫으면 앱도 꺼집니다).

### 직접 내려받아서

1. 이 페이지 위의 **Code → Download ZIP** 으로 내려받아 원하는 곳에 풉니다.
2. 푼 폴더의 `start.bat` 을 두 번 누릅니다(이후 과정은 위와 같습니다).
3. 업데이트할 때는 새 ZIP 을 풀어 덮어쓰되 **`data` 폴더는 지우지 마십시오.**

### 잘 안 될 때

- **내려받기가 막혀 있는 경우**: 학교 인터넷에서 `github.com`, `astral.sh`, `pypi.org` 가 막혀 있으면 자동 설치가 되지 않습니다. [python.org](https://www.python.org/downloads/) 에서 Python 을 설치(「Add python.exe to PATH」 체크)한 뒤 `start.bat` 을 다시 실행하십시오. 이때도 `pypi.org` 는 열려 있어야 합니다.
- **앱 창 대신 브라우저가 열리는 경우**: 앱 창 구성 요소(WebView2)가 없을 때입니다. 브라우저에서도 기능은 같습니다.
- **다른 컴퓨터로 옮길 때**: 설정 → 데이터 내보내기로 zip 을 만들어 새 컴퓨터에서 가져오기 하십시오.

## 설치·실행(맥·리눅스, 개발용)

실행 파일을 더블클릭합니다. Python 을 따로 설치하지 않아도 됩니다.

| 운영체제 | 실행 파일 | 처음 한 번 |
|---|---|---|
| macOS | `start.command` | 터미널에서 `chmod +x start.command start.sh` |
| 리눅스 | `start.sh` | `chmod +x start.sh` |
| 윈도우 | `start.bat` | 없음 (위의 「학교 컴퓨터」 참고) |

macOS에서 「확인되지 않은 개발자」라며 열리지 않으면 터미널에서 이 폴더로 가서 한 번 실행합니다.

```bash
xattr -d com.apple.quarantine start.command start.sh
```

처음 실행 때 하는 일(인터넷 필요, 몇 분):

1. 컴퓨터에 Python 3.10 이상이 있으면 그것을 씁니다.
2. 없으면 Python 설치 도구 [uv](https://docs.astral.sh/uv/)를 내려받아 **최신 Python 을 이 폴더의 `.tools/` 안에** 설치합니다. 관리자 권한이 필요 없고, 이 폴더 밖(시스템 Python, PATH, 셸 설정)은 건드리지 않습니다. 최신 Python 에 맞는 패키지가 아직 없으면 Python 3.13 으로 한 번 더 시도합니다.
3. `.venv` 가상 환경을 만들고 패키지를 설치합니다. `.venv` 의 Python 이 3.10 미만이면 새로 만듭니다.

그다음부터는 `requirements.txt` 가 바뀌었을 때만 다시 설치하므로 바로 열립니다. 폴더를 통째로 지우면 설치한 것도 모두 사라집니다.

- 앱 창(pywebview)이 열립니다. 창을 띄울 수 없으면 기본 브라우저로 `http://127.0.0.1:<빈 포트>` 를 엽니다.
- 서버는 127.0.0.1에만 바인딩합니다(같은 네트워크의 다른 컴퓨터에서 접속할 수 없습니다).
- 브라우저로 열고 싶으면 `./start.sh --browser`.
- 윈도우 준비 과정은 `scripts/bootstrap.ps1`, 설치·업데이트는 `installer/install.bat` → `scripts/install.ps1` 에 있습니다.

## 화면

1. **생활규정 설정 마법사**(첫 실행) — 학교·세는 대상·환산·기준·초기화·단계·학년별 지도 방안·회의록 기본값. 기본값은 Code.gs의 규정입니다.
2. **대시보드** — ① 월별 미인정 내역 조회(달 칩, 달별로 펼쳐 보기, 제외 반영해서 보기), ③ 대상자 명단(학년별 지도 방안, 「회의록 만들기」)
3. **자료 올리기** — 나이스 「결석자 조회」 원본을 정제 없이 그대로. 학년 체크 → 월 확인 → 분석. 같은 달은 덮어쓰기
4. **제외 처리** — 학생 × 달 단위 사유, 「그 달 전체 제외」/「서류 확인 횟수만큼 제외」, 「서류에 없는 내역」 알림과 반별 엑셀 내보내기
5. **생활지도 이력** — 수동 추가·수정, 기존 시트 2️⃣(J:L)·4️⃣(S:X) 붙여넣기 가져오기
6. **개인별 통계** — 월별 표 + 누적 흐름 + 이력, CSV·PNG·PDF·인쇄
7. **회의록** — 입력 폼 + A4 미리보기(바로 고치기) → hwpx 내려받기 → 확정(이력 자동 기록)
8. **설정** — 규정 요약·마법사 다시 열기, 학년도 전환(이전 학년도는 읽기 전용), 회의록 양식 바꿔 끼우기, 데이터 내보내기/가져오기(zip)

스크린샷은 실제 학생 이름이 보여 이 저장소에 넣지 않았습니다.

## 생활규정 (기본값)

1. 미인정 결석·지각·조퇴·결과만 셉니다
2. 결석 1회 = 1점, 지각·조퇴·결과는 합쳐 3회마다 1점. 남은 횟수는 다음 달로 이월 — 기간 전체를 먼저 더한 뒤 한 번에 나눕니다
3. 생활지도를 받으면 지도한 달까지의 기록(이월 포함)을 지우고 다음 달부터 다시 셉니다. 월 비교는 학년도 순서(3→…→12→1→2)
4. 초기화 뒤 3점 이상이면 대상자. 지도 횟수 0·1·2회 → 1·2·3차, 3회 이상 → 학생선도위원회
5. 명단 기준값과 화면 누적값은 같은 환산 방식을 씁니다

## 폴더

```
app/                 Python 백엔드(FastAPI) — 빌드한 화면은 app/static
  parse_neis.py      나이스 원본 파서
  rules.py           생활규정 엔진(순수 함수, settings.rules 만 읽음)
  alerts.py          서류에 없는 내역 알림
  service.py         DB 업무 로직
  minutes.py         hwpx 생성(양식 XML 복사·수정)
  templates/         기본 회의록 양식(빈 양식 — 형식만, 개인정보 없음)
scripts/             윈도우 실행 준비(bootstrap.ps1)·설치(install.ps1)
installer/           학교 컴퓨터용 설치 파일(install.bat) — 릴리스 zip 에 들어감
.github/workflows/   깨끗한 윈도우·맥에서 설치·테스트(check), 설치 파일 릴리스(release)
frontend/            React + Vite + TypeScript + Tailwind 원본
tests/               pytest
reference/           참고 파일(Code.gs, 샘플, 양식)
data/                app.db·백업·바꿔 끼운 양식 (git 에 넣지 않음)
.tools/              자동 설치한 uv·Python (git 에 넣지 않음)
```

## 개발

```bash
pip install -r requirements-dev.txt     # 테스트 도구
.venv/bin/python -m pytest              # 테스트 (샘플 xlsx 가 reference/ 에 있어야 전부 돕니다)
.venv/bin/python -m app --no-open --port 8765   # 백엔드만
cd frontend && npm install && npm run dev       # 화면 개발 (/api 는 8765 로 프록시)
cd frontend && npm run build                    # app/static 에 빌드 — 커밋해 둡니다
git tag v1.0.1 && git push --tags               # 새 릴리스 → 학교 컴퓨터 「업데이트」가 이 판을 받음
```

## 확인할 점

- **hwpx 는 한글에서 직접 열어 확인해야 합니다.** 이 Mac에는 한글이 없어 XML 구조 검사(표 칸 주소·병합·너비 합)와 텍스트 대조까지만 했습니다. 확인용 파일은 `data/hwpx_check/` 에 있습니다.
- 회의록을 확정하면 「생활지도 실시 월」(기본: 기준 월)까지 누적이 초기화됩니다. 회의 날짜의 달이 아닙니다. 다르게 쓰려면 회의록 입력에서 바꾸십시오.
- 「서류 미등록」 알림은 제외를 처음 등록한 달보다 **뒤의** 달에만 뜹니다(앞선 달의 미인정까지 알리면 너무 많아서).
- 기본 회의록 양식(`app/templates/minutes_template.hwpx`)은 첨부 양식에서 값·이름·작성자 정보·미리보기 그림을 모두 지운 빈 양식입니다. 표 모양·글자 모양·문단 모양은 그대로입니다. `tests/test_minutes.py` 가 양식에 형식 이름 말고 다른 글자가 없는지 검사합니다.
- 실제 학생·교사 이름이 든 파일은 이 컴퓨터에만 두고 git 에 넣지 않습니다: `reference/*.xlsx`(샘플), `reference/minutes_template.hwpx`(원본 양식), 작업 지시 문서, `data/`. 샘플이 없으면 해당 테스트는 건너뜁니다.
- 테스트와 화면 예시의 이름(홍길동, 김철수 등)은 지어낸 값입니다.
