@echo off
setlocal
rem ==================================================================
rem  Student guidance stats - installer / updater (Windows)
rem  Downloads the latest release from GitHub and installs it to
rem  %USERPROFILE%\GuidanceStats. Existing data\ is never touched.
rem  This file is ASCII on purpose (Korean user paths stay safe in cmd).
rem ==================================================================
set "GS_REPO=pcd0822/student-guidance-stats"

rem Run from a temp copy so updating the install folder cannot break this script.
if /i not "%~1"=="--from-temp" (
  if not defined GS_DEST if exist "%~dp0..\start.bat" for %%I in ("%~dp0..") do set "GS_DEST=%%~fI"
  copy /y "%~f0" "%TEMP%\gs_install.bat" >nul
  "%TEMP%\gs_install.bat" --from-temp
)

if not defined GS_DEST set "GS_DEST=%USERPROFILE%\GuidanceStats"
echo.
echo  Student guidance stats - install / update
echo  Folder: %GS_DEST%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $src=$env:GS_SOURCE; if (-not $src) { $t=Join-Path $env:TEMP ('gs_'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $t | Out-Null; $ref='heads/main'; try { $r=Invoke-RestMethod -UseBasicParsing -Uri ('https://api.github.com/repos/'+$env:GS_REPO+'/releases/latest'); $ref='tags/'+$r.tag_name } catch { }; Write-Host ('  Downloading '+$env:GS_REPO+' ('+$ref+') ...'); Invoke-WebRequest -UseBasicParsing -Uri ('https://github.com/'+$env:GS_REPO+'/archive/refs/'+$ref+'.zip') -OutFile (Join-Path $t 'src.zip'); Expand-Archive -Path (Join-Path $t 'src.zip') -DestinationPath $t -Force; $src=(Get-ChildItem -Path $t -Directory | Select-Object -First 1).FullName }; & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $src 'scripts\install.ps1') -Source $src -Dest $env:GS_DEST; exit $LASTEXITCODE"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo  Install failed. Read the message above.
  echo  If downloads are blocked at school, see README: "manual install".
  if not defined GS_NORUN pause
)
exit /b %RC%
