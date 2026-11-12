# 생활지도·학생선도 통계 — 설치·업데이트 (installer\install.bat 이 부른다)
# Source 폴더(내려받아 푼 프로젝트)를 Dest 로 복사한다. data\(학생 자료)·.venv·.tools 는 건드리지 않는다.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Dest
)
$ErrorActionPreference = 'Continue'
$NoRun = [bool]$env:GS_NORUN
$NoShortcut = [bool]$env:GS_NOSHORTCUT

function Fail([string]$msg) {
  Write-Host ''
  Write-Host $msg -ForegroundColor Red
  exit 1
}

$update = Test-Path (Join-Path $Dest 'start.bat')
Write-Host ''
Write-Host '생활지도·학생선도 통계' -ForegroundColor Green
Write-Host ($(if ($update) { '업데이트합니다: ' } else { '설치합니다: ' }) + $Dest)
if ($update -and (Test-Path (Join-Path $Dest 'data\app.db'))) {
  Write-Host '기존 자료(data 폴더)는 그대로 둡니다.'
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
# /MIR: 원본과 같게 맞추되 /XD 로 고른 폴더(학생 자료·설치된 Python)는 지우지도 덮어쓰지도 않는다
& robocopy $Source $Dest /MIR /XD data .venv .tools .git /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { Fail ('파일을 복사하지 못했습니다(robocopy ' + $LASTEXITCODE + '). 앱이 켜져 있으면 끄고 다시 실행하십시오.') }

Get-ChildItem -Path $Dest -Recurse -File -Include *.bat, *.ps1 -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike '*\.venv\*' -and $_.FullName -notlike '*\.tools\*' } |
  Unblock-File -ErrorAction SilentlyContinue

if (-not $NoShortcut) {
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut((Join-Path $desktop '생활지도·학생선도 통계.lnk'))
    $lnk.TargetPath = Join-Path $Dest 'start.bat'
    $lnk.WorkingDirectory = $Dest
    $lnk.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
    $lnk.Description = '생활지도·학생선도 통계 실행'
    $lnk.Save()
    $up = $sh.CreateShortcut((Join-Path $desktop '생활지도 통계 업데이트.lnk'))
    $up.TargetPath = Join-Path $Dest 'installer\install.bat'
    $up.WorkingDirectory = $Dest
    $up.IconLocation = "$env:SystemRoot\System32\imageres.dll,229"
    $up.Description = '생활지도·학생선도 통계를 최신판으로 업데이트'
    $up.Save()
    Write-Host '바탕 화면에 「생활지도·학생선도 통계」와 「생활지도 통계 업데이트」 바로 가기를 만들었습니다.'
  } catch {
    Write-Host ('바로 가기를 만들지 못했습니다: ' + $_.Exception.Message) -ForegroundColor Yellow
    Write-Host ('직접 실행하려면: ' + (Join-Path $Dest 'start.bat'))
  }
}

Write-Host ''
Write-Host '설치 파일 복사를 마쳤습니다.' -ForegroundColor Green
if ($NoRun) { exit 0 }
Write-Host '앱을 실행합니다. 처음에는 Python·패키지 설치로 몇 분 걸립니다.'
Write-Host '앱을 쓰는 동안 이 검은 창을 닫지 마십시오(닫으면 앱도 꺼집니다).'
Write-Host ''
& cmd /c (Join-Path $Dest 'start.bat')
exit $LASTEXITCODE
