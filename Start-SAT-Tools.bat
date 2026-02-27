@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Install Node.js and reopen this launcher.
  pause
  exit /b 1
)

echo Starting Structured Analytic Techniques servers...
start "" "http://localhost:3000/"
node start-all.js

