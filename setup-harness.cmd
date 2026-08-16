@echo off
rem ============================================================
rem  DeepSeek Harness - vendored source build (run ONCE on this PC)
rem  Builds vendor\deepseek-harness (with our wallpaper + vision
rem  fallback changes) so the desktop app can launch it.
rem ============================================================
setlocal
cd /d "%~dp0"

set VENDOR=vendor\deepseek-harness

echo.
echo [1/3] Checking pnpm ...
where pnpm >nul 2>nul
if errorlevel 1 (
    echo   pnpm not found. Installing it via npm ...
    call npm install -g pnpm
    if errorlevel 1 (
        echo   Failed to install pnpm. Please run: npm install -g pnpm
        pause
        exit /b 1
    )
)
echo   pnpm OK.

echo.
echo [2/3] Installing dependencies (first run takes several minutes) ...
cd /d "%VENDOR%"
call pnpm install
if errorlevel 1 (
    echo.
    echo   pnpm install failed. See errors above.
    pause
    exit /b 1
)

echo.
echo [3/4] Regenerating persistence catalog ...
rem    Must run BEFORE build: it bakes the vision/describe event type into
rem    KNOWN_SESSION_EVENT_TYPES. Skipping it makes the harness refuse to
rem    reopen any session that used the vision-fallback feature
rem    (SessionFormatUnsupportedError).
call pnpm run gen-persistence-catalog
if errorlevel 1 (
    echo.
    echo   gen-persistence-catalog failed. See errors above.
    pause
    exit /b 1
)

echo.
echo [4/4] Building harness (slow) ...
call pnpm run build
if errorlevel 1 (
    echo.
    echo   Build failed. See errors above.
    pause
    exit /b 1
)

echo.
echo   Build OK. You can now start the desktop app as usual.
pause
endlocal
