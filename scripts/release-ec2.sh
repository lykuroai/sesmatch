#!/usr/bin/env bash
# ローカルでイメージをビルドし、SSH 経由で EC2 に転送して起動するリリーススクリプト。
# 使い方:
#   EC2_HOST=ubuntu@x.x.x.x ./scripts/release-ec2.sh
# もしくは scripts/release-ec2.env に設定を書いておく（release-ec2.env.example 参照）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck disable=SC1091
[ -f "$SCRIPT_DIR/release-ec2.env" ] && source "$SCRIPT_DIR/release-ec2.env"

EC2_HOST="${EC2_HOST:?EC2_HOST を指定してください（例: ubuntu@x.x.x.x）}"
SSH_KEY="${SSH_KEY:-$HOME/.aws/lykuro-prod-key.pem}"
REMOTE_DIR="${REMOTE_DIR:-/opt/sesmatch}"
PLATFORM="${PLATFORM:-linux/amd64}"   # Graviton (arm) インスタンスなら linux/arm64
KEEP_RELEASES="${KEEP_RELEASES:-5}"   # EC2 に残す過去イメージの世代数

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$EC2_HOST")
TAG="$(date +%Y%m%d-%H%M%S)-$(git -C "$APP_DIR" rev-parse --short HEAD)"

echo "==> リリースタグ: $TAG（platform: $PLATFORM）"

# 未コミット変更の警告（ビルドはワークツリーの内容で行われる）
if ! git -C "$APP_DIR" diff --quiet HEAD -- "$APP_DIR" 2>/dev/null; then
  echo "!! 警告: 未コミットの変更が含まれたままビルドします" >&2
fi

echo "==> 1/5 イメージをビルド"
docker build --platform "$PLATFORM" --target migrate -t "sesmatch-migrate:$TAG" "$APP_DIR"
docker build --platform "$PLATFORM" --target runner  -t "sesmatch-app:$TAG"     "$APP_DIR"

echo "==> 2/5 EC2 側の前提を確認（$REMOTE_DIR / .env.production / docker compose）"
"${SSH[@]}" "set -e
  command -v docker >/dev/null || { echo 'EC2 に Docker がありません。RELEASE-EC2.md の初回セットアップを実施してください' >&2; exit 1; }
  docker compose version >/dev/null || { echo 'docker compose v2 がありません' >&2; exit 1; }
  test -f '$REMOTE_DIR/.env.production' || { echo '$REMOTE_DIR/.env.production がありません。RELEASE-EC2.md の初回セットアップを実施してください' >&2; exit 1; }"

echo "==> 3/5 設定を同期し、イメージを転送（数分かかります）"
scp -i "$SSH_KEY" "$APP_DIR/docker-compose.ec2.yml" "$EC2_HOST:$REMOTE_DIR/docker-compose.ec2.yml"
# .env.production はリリースごとに EC2 へ同期（EC2 側はバックアップを残し、直近10世代保持）
if [ -f "$APP_DIR/.env.production" ]; then
  BAK_TS="$(date +%Y%m%d-%H%M%S)"
  "${SSH[@]}" "cp -p '$REMOTE_DIR/.env.production' '$REMOTE_DIR/.env.production.bak.$BAK_TS'
    ls -1t '$REMOTE_DIR'/.env.production.bak.* 2>/dev/null | tail -n +11 | xargs -r rm -f"
  scp -i "$SSH_KEY" "$APP_DIR/.env.production" "$EC2_HOST:$REMOTE_DIR/.env.production"
  "${SSH[@]}" "chmod 600 '$REMOTE_DIR/.env.production'"
  echo "    .env.production を同期しました（バックアップ済み）"
fi
docker save "sesmatch-migrate:$TAG" "sesmatch-app:$TAG" | gzip | "${SSH[@]}" "gunzip | docker load"

echo "==> 4/5 EC2 で起動（migrate → app）"
"${SSH[@]}" "set -e
  cd '$REMOTE_DIR'
  docker tag 'sesmatch-migrate:$TAG' sesmatch-migrate:latest
  docker tag 'sesmatch-app:$TAG' sesmatch-app:latest
  IMAGE_TAG='$TAG' docker compose -f docker-compose.ec2.yml --env-file .env.production up -d --remove-orphans"

echo "==> 5/5 ヘルスチェック"
"${SSH[@]}" "for i in \$(seq 1 30); do
    curl -fsS -o /dev/null http://127.0.0.1:3000/api/v1/health && { echo 'OK: アプリ応答あり（DB疎通含む）'; exit 0; }
    sleep 2
  done
  echo 'NG: 60秒以内に応答なし。docker compose logs を確認してください' >&2; exit 1"

echo "==> 古いイメージを整理（直近 $KEEP_RELEASES 世代を保持）"
"${SSH[@]}" "docker images sesmatch-app --format '{{.Tag}}' | grep -v '^latest$' | sort -r | tail -n +$((KEEP_RELEASES + 1)) \
  | while read -r t; do docker rmi \"sesmatch-app:\$t\" \"sesmatch-migrate:\$t\" 2>/dev/null || true; done; true"

echo ""
echo "リリース完了: $TAG"
echo "ロールバック例: ${SSH[*]} \"cd $REMOTE_DIR && IMAGE_TAG=<旧タグ> docker compose -f docker-compose.ec2.yml --env-file .env.production up -d\""
