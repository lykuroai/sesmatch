@echo off
setlocal
title lykuro-connector install

set "DEST=%USERPROFILE%\lykuro-connector"
set "ZIPURL=https://github.com/lykuroai/lykuro-connector/archive/refs/heads/main.zip"

echo ============================================================
echo  Installing lykuro-connector (local server)
echo  Destination: %DEST%
echo ============================================================
echo.

rem ---- Check Node.js (20 or later required) ----
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo   Install the LTS version from https://nodejs.org/ja
  echo   and run this batch again.
  echo   ^(with winget: winget install OpenJS.NodeJS.LTS^)
  pause
  exit /b 1
)
node -e "process.exit(parseInt(process.versions.node)>=20?0:1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20 or later is required. Current version:
  node -v
  pause
  exit /b 1
)

rem ---- Download and extract (config.json and data are not in the ZIP, so they survive updates) ----
echo Downloading source...
curl -fsSL -o "%TEMP%\lykuro-connector.zip" "%ZIPURL%"
if errorlevel 1 (
  echo [ERROR] Download failed. Check your network connection.
  pause
  exit /b 1
)
if exist "%TEMP%\lykuro-connector-src" rd /s /q "%TEMP%\lykuro-connector-src"
mkdir "%TEMP%\lykuro-connector-src"
tar -xf "%TEMP%\lykuro-connector.zip" -C "%TEMP%\lykuro-connector-src"
if errorlevel 1 (
  echo [ERROR] Extraction failed.
  pause
  exit /b 1
)
if not exist "%DEST%" mkdir "%DEST%"
xcopy /e /y /q "%TEMP%\lykuro-connector-src\lykuro-connector-main\*" "%DEST%\" >nul
rd /s /q "%TEMP%\lykuro-connector-src"
del "%TEMP%\lykuro-connector.zip"

rem ---- Dependencies ----
cd /d "%DEST%"
echo Installing dependencies (first run takes 1-2 minutes)...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

rem ---- Config file (created on first install, then opened in Notepad) ----
if not exist config.json (
  copy config.example.json config.json >nul
  echo.
  echo Created config.json. Opening it in Notepad.
  echo   parent.token : ses_pat_... issued at "Company My Page - API Token" on the platform
  echo   llm.baseUrl / apiKey / model : your own OpenAI-compatible API
  notepad config.json
)

echo.
echo ============================================================
echo  Install complete
echo  Start:  double-click %DEST%\start.bat
echo  Web UI: http://127.0.0.1:8787 (opens automatically on start)
echo ============================================================
pause
