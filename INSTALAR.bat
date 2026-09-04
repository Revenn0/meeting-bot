@echo off
setlocal
cd /d "%~dp0"
title Plateia Console — instalar

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Instala o Node.js 20 LTS primeiro:
  echo  https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo Node encontrado:
node -v
echo.

echo  A instalar dependencias da Plateia Console...
echo.
call npm install
if errorlevel 1 (
  echo Falhou o npm install.
  pause
  exit /b 1
)

if not exist "user-data" mkdir "user-data"

echo.
echo  Pronto. Agora corre ABRIR.bat
echo.
pause
exit /b 0
