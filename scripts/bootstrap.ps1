# 생활지도·학생선도 통계 — 윈도우 실행 준비 (start.bat 이 부른다)
# Python 3.10 이상을 찾고, 없으면 uv 로 최신 Python 을 이 폴더의 .tools\ 안에 설치한다.
# 관리자 권한이 필요 없고 이 폴더 밖은 건드리지 않는다.
#
# 주의: Windows PowerShell 5.1 에서는 프로그램이 stderr 로 쓴 글(uv·pip 의 진행 표시)이
# 오류로 취급되므로 $ErrorActionPreference 를 Stop 으로 두지 않고 종료 코드로 판단한다.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Tools = Join-Path $Root '.tools'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Tools 'python'
$env:UV_CACHE_DIR = Join-Path $Tools 'cache'
$env:UV_PYTHON_INSTALL_BIN = '0'
$Fallback = '3.13'
$VenvPy = Join-Path $Root '.venv\Scripts\python.exe'

function Fail([string]$msg) {
  Write-Host ''
  Write-Host $msg -ForegroundColor Red
  exit 1
}

# 인터넷에서 받은 zip 을 풀면 붙는 「차단」 표시를 이 폴더의 실행 파일에서 떼어 낸다
Get-ChildItem -Path $Root -Recurse -File -Include *.bat, *.ps1 -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike '*\.venv\*' -and $_.FullName -notlike '*\.tools\*' } |
  Unblock-File -ErrorAction SilentlyContinue

function Test-Py310([string]$exe, [string[]]$pre = @()) {
  try {
    & $exe @pre -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

function Find-SystemPython {
  if ($env:GS_FORCE_MANAGED) { return $null }
  if (Get-Command py -ErrorAction SilentlyContinue) {
    if (Test-Py310 'py' @('-3')) { return @('py', '-3') }
  }
  foreach ($c in 'python', 'python3') {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    # 윈도우 스토어 바로 가기(WindowsApps)는 실제 Python 이 아니므로 건너뛴다
    if ($cmd -and $cmd.Source -notlike '*WindowsApps*' -and (Test-Py310 $c)) { return @($c) }
  }
  return $null
}

$script:Uv = $null
function Get-Uv {
  if ($script:Uv) { return }
  $local = Join-Path $Tools 'uv\uv.exe'
  if (Test-Path $local) { $script:Uv = $local; return }
  $sys = Get-Command uv -ErrorAction SilentlyContinue
  if ($sys) { $script:Uv = $sys.Source; return }
  Write-Host 'Python 설치 도구(uv)를 내려받습니다...'
  New-Item -ItemType Directory -Force -Path $Tools | Out-Null
  $installer = Join-Path $Tools 'uv-install.ps1'
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://astral.sh/uv/install.ps1' -OutFile $installer -ErrorAction Stop
  } catch {
    Fail ('uv 를 내려받지 못했습니다(' + $_.Exception.Message + '). 학교 인터넷에서 astral.sh·github.com 이 막혀 있을 수 있습니다. https://www.python.org/downloads/ 에서 Python 을 직접 설치한 뒤 다시 실행하십시오.')
  }
  $env:UV_UNMANAGED_INSTALL = Join-Path $Tools 'uv'
  $env:INSTALLER_NO_MODIFY_PATH = '1'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $installer 2>&1 | Out-Null
  Remove-Item Env:UV_UNMANAGED_INSTALL -ErrorAction SilentlyContinue
  Remove-Item $installer -ErrorAction SilentlyContinue
  if (-not (Test-Path $local)) { Fail 'uv 를 설치하지 못했습니다. https://www.python.org/downloads/ 에서 Python 을 직접 설치한 뒤 다시 실행하십시오.' }
  $script:Uv = $local
}

function New-ManagedVenv([string]$ver) {
  Get-Uv
  $want = if ($ver) { $ver } else { '3' }
  if ($ver) { Write-Host "Python $ver 을 이 폴더 안에 설치합니다(처음 한 번)..." }
  else { Write-Host 'Python 최신판을 이 폴더 안에 설치합니다(처음 한 번)...' }
  if ($ver) { & $script:Uv python install --no-bin $ver 2>&1 | Out-Host } else { & $script:Uv python install --no-bin 2>&1 | Out-Host }
  if ($LASTEXITCODE -ne 0) { Fail 'Python 을 내려받지 못했습니다. 인터넷 연결을 확인하십시오.' }
  & $script:Uv venv --clear --seed --managed-python --python $want .venv 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail '가상 환경을 만들지 못했습니다.' }
}

function Get-ReqHash {
  $a = [IO.File]::ReadAllBytes((Join-Path $Root 'requirements.txt'))
  $b = [IO.File]::ReadAllBytes((Join-Path $Root 'requirements-window.txt'))
  $sha = [Security.Cryptography.SHA256]::Create()
  $h = $sha.ComputeHash([byte[]]($a + $b))
  return (($h | ForEach-Object { $_.ToString('x2') }) -join '')
}

# 컴파일이 필요한 패키지는 절대 소스에서 빌드하지 않는다(학교 컴퓨터에는 컴파일러가 없다).
# 맞는 설치 파일(wheel)이 없으면 바로 실패하고 Python 3.13 으로 다시 시도한다.
$PipArgs = @('--prefer-binary', '--only-binary=lxml,pydantic-core,cffi,pyobjc-core', '--disable-pip-version-check')

# 주의: PowerShell 함수는 화면에 내보낸 것까지 돌려주므로 pip 출력은 Out-Host 로 보낸다
function Install-Requirements {
  $hashFile = Join-Path $Root '.venv\.requirements.sha256'
  $new = Get-ReqHash
  $old = if (Test-Path $hashFile) { (Get-Content $hashFile -Raw).Trim() } else { '' }
  if ($new -eq $old) { return $true }
  Write-Host '필요한 패키지를 설치합니다(처음 한 번, 몇 분 걸릴 수 있습니다)...'
  # 검사(CI)용: 이 Python 버전에 맞는 설치 파일이 없는 상황을 흉내 낸다
  $extra = @()
  if ($env:GS_SIMULATE_NO_WHEEL) {
    $cur = (& $VenvPy -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null | Out-String).Trim()
    if ($cur -eq $env:GS_SIMULATE_NO_WHEEL) { $extra = @('gs-simulated-missing-wheel==0.0.0') }
  }
  & $VenvPy -m pip install --upgrade pip @PipArgs 2>&1 | Out-Null
  & $VenvPy -m pip install -r requirements.txt @extra @PipArgs 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { return $false }
  # 앱 창 패키지는 실패해도 브라우저로 열 수 있으니 멈추지 않는다
  & $VenvPy -m pip install -r requirements-window.txt @PipArgs 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Host '앱 창 패키지를 설치하지 못해 기본 브라우저로 엽니다.' -ForegroundColor Yellow }
  Set-Content -Path $hashFile -Value $new -NoNewline -Encoding ascii
  return $true
}

# .venv 가 이 폴더의 .tools 에 받은 Python 으로 만든 것인지(그렇다면 다른 버전으로 다시 만들 수 있다)
function Test-ManagedVenv {
  if (-not (Test-Path $VenvPy)) { return $false }
  $base = (& $VenvPy -c "import sys; print(sys.base_prefix)" 2>$null | Out-String).Trim()
  return ($base -and $base.StartsWith($Tools, [StringComparison]::OrdinalIgnoreCase))
}

$created = $false
if (-not (Test-Path $VenvPy) -or -not (Test-Py310 $VenvPy)) {
  $sys = Find-SystemPython
  if ($sys) {
    Write-Host '가상 환경을 만듭니다...'
    $exe = $sys[0]
    $pre = @($sys | Select-Object -Skip 1)
    & $exe @pre -m venv --clear .venv 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail '가상 환경을 만들지 못했습니다.' }
  } else {
    New-ManagedVenv ''
  }
  $created = $true
}
Write-Host ((& $VenvPy --version 2>&1 | Out-String).Trim() + ' 로 실행합니다.')

$ok = Install-Requirements
if ($ok -ne $true) {
  # 이 폴더에 받은 Python 이면(이번에 만들었든 예전에 만들었든) 3.13 으로 다시 만든다
  $ver = (& $VenvPy -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null | Out-String).Trim()
  if ((Test-ManagedVenv) -and $ver -ne $Fallback) {
    Write-Host "Python $ver 에 맞는 패키지가 아직 없어 Python $Fallback 로 다시 시도합니다..." -ForegroundColor Yellow
    New-ManagedVenv $Fallback
    $ok = Install-Requirements
  }
  if ($ok -ne $true) { Fail '패키지를 설치하지 못했습니다. 인터넷 연결을 확인하고 다시 실행하십시오. 계속 안 되면 이 창의 내용을 사진으로 보내 주십시오.' }
}
exit 0
