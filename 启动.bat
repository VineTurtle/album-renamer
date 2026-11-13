@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found.
  echo   Please install Node.js 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)
node server.mjs %*
if errorlevel 1 pause
