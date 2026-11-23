@echo off
setlocal
rem Student guidance stats - start (Windows). ASCII only on purpose.
rem Finds Python 3.10+ or installs the latest Python into .tools\ (no admin), then runs the app.
cd /d "%~dp0"
set "PYTHONUTF8=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1"
if errorlevel 1 (
  echo.
  echo  Setup failed. Read the message above.
  pause
  exit /b 1
)
rem Setup is done: with no arguments, run the app window without a console and close this window.
rem With arguments (e.g. --browser, --no-open) it keeps running here as before.
if "%~1"=="" if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" -m app --launcher
  exit /b 0
)
".venv\Scripts\python.exe" -m app %*
if errorlevel 1 pause
