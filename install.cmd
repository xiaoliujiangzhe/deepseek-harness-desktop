@echo off
rem ============================================================
rem  DeepSeek Harness 首次安装 / 修复脚本（仅在第一次使用或出问题时双击）
rem  作用：安装依赖并下载 Electron 运行时，之后即可双击 .vbs 或快捷方式启动。
rem ============================================================
setlocal
cd /d "%~dp0"

echo.
echo [1/2] 检查 Node.js ...
where node >nul 2>nul
if errorlevel 1 (
    echo   未检测到 Node.js。请先到 https://nodejs.org 安装 LTS 版本，然后重新双击本脚本。
    pause
    exit /b 1
)
echo   Node.js 已就绪。

echo.
echo [2/2] 安装依赖（首次运行约需数分钟，请耐心等待）...
call npm install
if errorlevel 1 (
    echo.
    echo   安装失败，请把上面的报错截图反馈。
    pause
    exit /b 1
)

echo.
echo   安装完成！现在可以双击 "启动 DeepSeek Harness.vbs" 或桌面快捷方式启动。
pause
endlocal
