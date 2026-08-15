@echo off
rem ============================================================
rem  DeepSeek Harness - first-time setup / repair script
rem  Run this once (or when something is broken). It installs
rem  dependencies and downloads the Electron runtime.
rem ============================================================
setlocal
cd /d "%~dp0"

echo.
echo [1/2] Checking Node.js ...
where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js not found. Install the LTS version from https://nodejs.org
    echo   and then run this script again.
    pause
    exit /b 1
)
echo   Node.js OK.

echo.
echo [2/2] Installing dependencies (first run takes a few minutes) ...
call npm install
if errorlevel 1 (
    echo.
    echo   Install failed. Please screenshot the error above and report it.
    pause
    exit /b 1
)

echo.
echo   Done. You can now launch the app from the VBS launcher or the desktop shortcut.
pause
endlocal
