@echo off
setlocal
chcp 65001 >nul
title ローカルサーバ（lykuro-connector）インストール

set "DEST=%USERPROFILE%\lykuro-connector"
set "ZIPURL=https://github.com/lykuroai/lykuro-connector/archive/refs/heads/main.zip"

echo ============================================================
echo  ローカルサーバ（lykuro-connector）のインストールを開始します
echo  インストール先: %DEST%
echo ============================================================
echo.

rem ---- Node.js の確認（20以上が必要）----
where node >nul 2>nul
if errorlevel 1 (
  echo [エラー] Node.js が見つかりません。
  echo   https://nodejs.org/ja から LTS 版をインストールして、
  echo   このバッチをもう一度実行してください。
  echo   ^(winget が使える場合: winget install OpenJS.NodeJS.LTS^)
  pause
  exit /b 1
)
node -e "process.exit(parseInt(process.versions.node)>=20?0:1)" >nul 2>nul
if errorlevel 1 (
  echo [エラー] Node.js 20 以上が必要です。現在のバージョン:
  node -v
  pause
  exit /b 1
)

rem ---- ダウンロード・展開（config.json と data はZIPに含まれないため、更新時も保持される）----
echo ソースをダウンロードしています...
curl -fsSL -o "%TEMP%\lykuro-connector.zip" "%ZIPURL%"
if errorlevel 1 (
  echo [エラー] ダウンロードに失敗しました。ネットワーク接続を確認してください
  pause
  exit /b 1
)
if exist "%TEMP%\lykuro-connector-src" rd /s /q "%TEMP%\lykuro-connector-src"
mkdir "%TEMP%\lykuro-connector-src"
tar -xf "%TEMP%\lykuro-connector.zip" -C "%TEMP%\lykuro-connector-src"
if errorlevel 1 (
  echo [エラー] 展開に失敗しました
  pause
  exit /b 1
)
if not exist "%DEST%" mkdir "%DEST%"
xcopy /e /y /q "%TEMP%\lykuro-connector-src\lykuro-connector-main\*" "%DEST%\" >nul
rd /s /q "%TEMP%\lykuro-connector-src"
del "%TEMP%\lykuro-connector.zip"

rem ---- 依存パッケージ ----
cd /d "%DEST%"
echo 依存パッケージをインストールしています（初回は1〜2分かかります）...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo [エラー] npm install に失敗しました
  pause
  exit /b 1
)

rem ---- 設定ファイル（初回のみ作成してメモ帳で開く）----
if not exist config.json (
  copy config.example.json config.json >nul
  echo.
  echo 設定ファイル config.json を作成しました。メモ帳で開きます。
  echo   parent.token : プラットフォームの「会社マイページ → APIトークン」で発行した ses_pat_...
  echo   llm.baseUrl / apiKey / model : 自社契約の OpenAI互換API
  notepad config.json
)

echo.
echo ============================================================
echo  インストール完了
echo  起動: %DEST%\start.bat をダブルクリック
echo  画面: http://127.0.0.1:8787 （起動時に自動で開きます）
echo ============================================================
pause
