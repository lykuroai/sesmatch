#!/usr/bin/env bash
# 本番アプリ（EC2 の app:3000）への SSH トンネルを開く。
# 開発機の 10.8.1.18:3001 で待ち受けるため、VPN 内の端末から
#   http://10.8.1.18:3001/admin  （運営コンソール。PLATFORM_ADMIN_TOKEN でログイン）
# で本番にアクセスできる。Ctrl+C で切断。
#   ./scripts/admin-tunnel.sh        # フォアグラウンドで開く
#   ./scripts/admin-tunnel.sh stop   # バックグラウンドで開いたトンネルを閉じる
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "$SCRIPT_DIR/release-ec2.env" ] && source "$SCRIPT_DIR/release-ec2.env"

EC2_HOST="${EC2_HOST:?EC2_HOST を指定してください}"
SSH_KEY="${SSH_KEY:-$HOME/.aws/lykuro-prod-key.pem}"
BIND_ADDR="${BIND_ADDR:-10.8.1.18}"
LOCAL_PORT="${LOCAL_PORT:-3001}"

if [ "${1:-}" = "stop" ]; then
  killed=""
  pkill -f "admin-tunnel\.sh$" 2>/dev/null && killed=1 || true # 再接続ループ本体
  pkill -f "ssh.*${LOCAL_PORT}:127.0.0.1:3000" && killed=1 || true
  [ -n "$killed" ] && echo "トンネルを閉じました" || echo "トンネルは開いていません"
  exit 0
fi

echo "本番アプリトンネル: http://$BIND_ADDR:$LOCAL_PORT/admin (Ctrl+C で切断)"
# keepalive で無通信切断を防ぎ、切れたら自動で張り直す
while true; do
  ssh -i "$SSH_KEY" -N -L "$BIND_ADDR:$LOCAL_PORT:127.0.0.1:3000" \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    "$EC2_HOST" && break
  echo "トンネル切断を検知。5秒後に再接続します..." >&2
  sleep 5
done
