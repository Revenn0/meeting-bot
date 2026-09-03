@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install LTS from https://nodejs.org
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Created .env from .env.example
  echo Edit .env and set MEET_URL to your open Meet link, then run start.bat again.
  exit /b 1
)

echo Starting one CHAT_ONLY Meet guest...
node scripts\run-one-bot.js
exit /b %ERRORLEVEL%
