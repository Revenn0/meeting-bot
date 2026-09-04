@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Cria o .env e define MEET_URL, ou usa a Plateia Console ^(ABRIR.bat^).
  exit /b 1
)
node scripts\run-one-bot.js
exit /b %ERRORLEVEL%
