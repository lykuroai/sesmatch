#!/usr/bin/env bash
# ローカルサーバ（lykuro-connector）ダウンロード＋インストール（Linux / macOS）
#   使い方: bash install.sh [インストール先]（省略時: ~/lykuro-connector）
# config.json と data/ はアーカイブに含まれないため、再実行（更新）でも保持される
set -euo pipefail

DEST="${1:-$HOME/lykuro-connector}"
TARURL="https://github.com/lykuroai/lykuro-connector/archive/refs/heads/main.tar.gz"

echo "============================================================"
echo " ローカルサーバ（lykuro-connector）のインストールを開始します"
echo " インストール先: $DEST"
echo "============================================================"

# ---- Node.js の確認（20以上が必要）----
if ! command -v node >/dev/null 2>&1; then
  echo "[エラー] Node.js が見つかりません。https://nodejs.org/ja から 20 以上をインストールしてください" >&2
  exit 1
fi
if ! node -e "process.exit(parseInt(process.versions.node)>=20?0:1)"; then
  echo "[エラー] Node.js 20 以上が必要です（現在: $(node -v)）" >&2
  exit 1
fi

# ---- ダウンロード・展開 ----
echo "ソースをダウンロードしています..."
TMPDIR_SRC="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SRC"' EXIT
curl -fsSL "$TARURL" | tar -xz -C "$TMPDIR_SRC"
mkdir -p "$DEST"
cp -R "$TMPDIR_SRC/lykuro-connector-main/." "$DEST/"

# ---- 依存パッケージ ----
cd "$DEST"
echo "依存パッケージをインストールしています（初回は1〜2分かかります）..."
npm install --no-fund --no-audit

# ---- 設定ファイル（初回のみ）----
if [ ! -f config.json ]; then
  cp config.example.json config.json
  chmod 600 config.json
  echo ""
  echo "設定ファイル $DEST/config.json を作成しました。次を編集してください:"
  echo "  parent.token : プラットフォームの「会社マイページ → APIトークン」で発行した ses_pat_..."
  echo "  llm.baseUrl / apiKey / model : 自社契約の OpenAI互換API"
fi

echo ""
echo "============================================================"
echo " インストール完了"
echo " 起動: cd $DEST && npm start"
echo " 画面: http://127.0.0.1:8787"
echo "============================================================"
