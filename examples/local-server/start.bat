@echo off
title lykuro-connector
cd /d "%~dp0"
if not exist config.json (
  echo config.json not found. Run install.bat first.
  pause
  exit /b 1
)
echo Starting local server (closing this window stops it)
start "" http://127.0.0.1:8787
node local-server.mjs
echo.
echo Local server stopped.
pause
