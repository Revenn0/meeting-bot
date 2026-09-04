@echo off
setlocal
cd /d "%~dp0"
title Plateia Console

where node >nul 2>nul
if errorlevel 1 (
  echo Instala o Node.js 20 LTS: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Ainda nao correste INSTALAR.bat — a instalar agora...
  call npm install
  if errorlevel 1 exit /b 1
)

if not exist "user-data" mkdir "user-data"

set PLATEIA_PORT=8787
echo A abrir a consola em http://127.0.0.1:%PLATEIA_PORT%
start "" "http://127.0.0.1:%PLATEIA_PORT%"
node console\index.js
exit /b %ERRORLEVEL%
