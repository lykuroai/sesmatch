@echo off
chcp 65001 >nul
title ローカルサーバ（lykuro-connector）
cd /d "%~dp0"
if not exist config.json (
  echo config.json がありません。先に install.bat を実行してください
  pause
  exit /b 1
)
echo ローカルサーバを起動します（このウィンドウを閉じると停止します）
start "" http://127.0.0.1:8787
node local-server.mjs
echo.
echo ローカルサーバが停止しました
pause
