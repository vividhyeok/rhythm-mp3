@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title MP3 RHYTHM // LCD-4K

echo ==================================================
echo   MP3 RHYTHM // LCD-4K  -  local rhythm game
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo         Install Node.js LTS from https://nodejs.org/ and run again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not installed or not in PATH.
  echo         Reinstall Node.js LTS from https://nodejs.org/ and run again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies... (this may take a minute)
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check the messages above.
    echo.
    pause
    exit /b 1
  )
  echo.
)

echo Starting dev server... your browser will open automatically.
echo Close this window to stop the game server.
echo.
call npm run dev

echo.
if errorlevel 1 (
  echo [ERROR] Dev server exited with an error. Check the messages above.
) else (
  echo Dev server stopped.
)
echo.
pause
