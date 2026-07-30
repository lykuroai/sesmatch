#!/usr/bin/env bash
# EC2 に nginx を導入し、ALB → nginx(:80) → app(127.0.0.1:3000) の転送を設定する（初回のみ・再実行可）。
# 使い方:
#   EC2_HOST=ubuntu@x.x.x.x ./scripts/setup-ec2-web.sh
# もしくは scripts/release-ec2.env に設定を書いておく（release-ec2.env.example 参照）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck disable=SC1091
[ -f "$SCRIPT_DIR/release-ec2.env" ] && source "$SCRIPT_DIR/release-ec2.env"

EC2_HOST="${EC2_HOST:?EC2_HOST を指定してください（例: ubuntu@x.x.x.x）}"
SSH_KEY="${SSH_KEY:-$HOME/.aws/lykuro-prod-key.pem}"

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$EC2_HOST")

echo "==> 1/3 nginx をインストール"
"${SSH[@]}" "command -v nginx >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq nginx; }"

echo "==> 2/3 設定を配置（デフォルトサイトは無効化）"
scp -i "$SSH_KEY" "$APP_DIR/deploy/nginx-sesmatch.conf" "$EC2_HOST:/tmp/nginx-sesmatch.conf"
"${SSH[@]}" "set -e
  sudo mv /tmp/nginx-sesmatch.conf /etc/nginx/sites-available/sesmatch
  sudo ln -sf /etc/nginx/sites-available/sesmatch /etc/nginx/sites-enabled/sesmatch
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl enable --now nginx
  sudo systemctl reload nginx"

echo "==> 3/3 疎通確認（nginx:80 → app:3000）"
"${SSH[@]}" "curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1/api/v1/health" \
  || echo "!! app が未起動の可能性があります（./scripts/release-ec2.sh 実行後に再確認してください）"

echo ""
echo "nginx 設定完了。ALB のターゲットグループは HTTP:80、ヘルスチェックパス /api/v1/health を指定してください（RELEASE-EC2.md 参照）"
