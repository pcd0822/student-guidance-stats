# 집 컴퓨터에서 이어 하기

이 저장소를 학교 Mac이 아닌 다른 컴퓨터(집 PC)의 Claude Code 에서 이어서 작업하는 방법입니다.

## 1. 미리 알아 둘 것

| 따라오는 것 (GitHub에 있음) | 따라오지 않는 것 (이 컴퓨터에만 있음) |
|---|---|
| 앱 코드 전부, 빌드한 화면(`app/static`), 테스트 | 실명이 든 나이스 샘플 `reference/*.xlsx` |
| 빈 회의록 양식 `app/templates/minutes_template.hwpx` | 원본 회의록 양식 `reference/minutes_template.hwpx` |
| `CLAUDE.md`: Claude 가 자동으로 읽는 작업 규칙 | 원래 작업 지시서 `생활지도_학생선도_데스크톱앱_프롬프트.md` |
| `docs/SPEC.md`: 작업 지시서를 실명 없이 줄인 업무 규칙 | 앱 데이터 `data/`, 이전 대화 기록, Claude 메모리 |

- **실명 자료는 집에 가져가지 않아도 됩니다.** 샘플이 없으면 해당 테스트 몇 개만 건너뛰고 나머지는 모두 돕니다.
- 학교 개인정보 지침상 학생 자료를 집으로 옮기지 않는 편이 안전합니다.
- 이전 대화의 맥락과 결정 사항은 `CLAUDE.md` 와 `docs/SPEC.md` 에 옮겨 두었습니다. 집의 Claude Code 는 저장소를 열면 `CLAUDE.md` 를 자동으로 읽습니다.

## 2. 집 컴퓨터 준비 (처음 한 번)

1. **GitHub Desktop** 을 설치하고 `pcd0822` 계정으로 로그인합니다.
2. **File → Clone repository** 에서 `pcd0822/student-guidance-stats` 를 고르고 원하는 폴더에 받습니다.
3. **Node.js LTS** 를 설치합니다(https://nodejs.org). 화면(frontend)을 고칠 때만 필요합니다.
4. Python 은 따로 설치하지 않아도 됩니다. 실행 스크립트가 없으면 알아서 폴더 안에 설치합니다.
5. **Claude Code** 를 설치하고, 터미널에서 받은 폴더로 이동해 `claude` 를 실행합니다.

## 3. Claude Code 에 처음 보낼 말

아래를 그대로 붙여 넣습니다.

```
이 저장소는 학교 컴퓨터에서 Claude Code로 만들어 온 「생활지도·학생선도 통계」 앱이야.
CLAUDE.md 와 docs/SPEC.md, docs/HANDOFF.md 를 먼저 읽고 작업 규칙을 익혀 줘.
그다음 이 컴퓨터에서 개발 환경을 준비해 줘:
1) 저장소 git 작성자를 pcd0822 / 224205797+pcd0822@users.noreply.github.com 으로 설정
2) 실행 스크립트로 .venv 만들고 requirements-dev.txt 설치, pytest 통과 확인
3) frontend 에서 npm install 후 npm run build 가 되는지 확인 (빌드 결과가 커밋된 것과 달라지면 알려 줘)
준비가 끝나면 무엇을 확인했는지 알려 줘. 커밋은 내가 하자고 할 때만 해.
```

준비 과정에서 확인할 것:

- **윈도우 집 PC**
  - Claude 가 `start.bat` 을 실행하거나 `scripts\bootstrap.ps1` 을 씁니다.
  - 테스트는 `.venv\Scripts\python.exe -m pytest -q` 로 돌립니다.
- **Mac 집 PC**
  - 터미널에서 `chmod +x start.command start.sh` 를 한 번 실행합니다.
  - 그다음 `./start.sh` 를 실행합니다.
- 테스트 결과에 `passed` 가 나오고 `failed` 가 없으면 준비가 끝난 것입니다. `skipped` 는 샘플 파일이 없어서 그런 것이니 괜찮습니다.

## 4. 평소 작업 순서

1. **작업 전 최신으로 받기:** GitHub Desktop 에서 **Fetch origin → Pull** 을 누릅니다. 학교와 집에서 번갈아 작업하므로 이 단계를 빼먹지 않습니다.
2. **Claude 에게 고칠 것 말하기:** Claude 가 코드를 고치고 테스트와 빌드로 확인합니다.
3. **새 판으로 내기:** 「버전 올리고 커밋해 줘」라고 말합니다. Claude 가 `__version__` 을 올리고, 화면을 빌드하고, 테스트한 뒤 커밋합니다.
4. **Push:** GitHub Desktop 에서 **Push origin** 을 누릅니다.
5. **자동 검사와 릴리스:** 15~20분 뒤 GitHub 의 설치 검사가 통과하면 새 릴리스가 자동으로 생깁니다. 저장소의 **Actions** 탭에서 초록 체크로 확인합니다.
6. **학교 컴퓨터 반영:** 바탕 화면의 「생활지도 통계 업데이트」를 누릅니다.

**주의할 점**

- 한 컴퓨터에서 Push 하지 않은 채 다른 컴퓨터에서 작업을 시작하면 충돌이 납니다. 작업을 마치면 꼭 Push 하고, 시작할 때는 꼭 Pull 합니다.
- 학교 Mac 의 원래 폴더(`reference`)도 계속 쓴다면, 그쪽에서 작업하기 전에도 GitHub Desktop 에서 Pull 합니다.

## 5. 실제 자료로 확인하고 싶을 때

집에서는 지어낸 자료로 확인하고, 실제 나이스 파일로 하는 확인은 학교 컴퓨터에서 업데이트한 뒤 합니다.

## 6. 디자인 참고

화면 디자인을 크게 바꿀 때는 `pcd0822/homeroom_manager` 저장소도 함께 받아 두고 Claude 에게 그 저장소의 `DESIGN.md` 를 읽게 합니다. 색은 이 앱만의 값(`docs/SPEC.md` 8절)을 씁니다.
