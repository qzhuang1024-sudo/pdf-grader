@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >/dev/null 2>/dev/null || (echo 需要先安裝 Node.js: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo 第一次執行，正在安裝套件...
  call npm install || (pause & exit /b 1)
)
call npm run dev -- --open
pause
