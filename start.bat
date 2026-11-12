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
".venv\Scripts\python.exe" -m app %*
if errorlevel 1 pause
