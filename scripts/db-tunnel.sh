#!/usr/bin/env bash
# 本番DB（EC2 の PostgreSQL）に SSH トンネル経由で接続する。
#   ./scripts/db-tunnel.sh           # psql で接続（ローカルに無ければ Docker の psql を使用）
#   ./scripts/db-tunnel.sh studio    # Prisma Studio（ブラウザGUI）で接続
#   ./scripts/db-tunnel.sh tunnel    # トンネルだけ開く（pgAdmin 等の GUI 用。Ctrl+C で切断）
# 終了（psql を抜ける / Ctrl+C）と同時にトンネルも自動で閉じる。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck disable=SC1091
[ -f "$SCRIPT_DIR/release-ec2.env" ] && source "$SCRIPT_DIR/release-ec2.env"

EC2_HOST="${EC2_HOST:?EC2_HOST を指定してください}"
SSH_KEY="${SSH_KEY:-$HOME/.aws/lykuro-prod-key.pem}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
MODE="${1:-psql}"

# 本番の接続情報を .env.production から取得
ENV_FILE="$APP_DIR/.env.production"
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE がありません" >&2; exit 1; }
DB_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
DB_PASS="$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
DB_NAME="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2- || true)"
DB_NAME="${DB_NAME:-sesmatch}"
DB_URL="postgresql://$DB_USER:$DB_PASS@localhost:$LOCAL_PORT/$DB_NAME"

# トンネルを開き、スクリプト終了時に必ず閉じる
ssh -i "$SSH_KEY" -N -L "$LOCAL_PORT:127.0.0.1:5433" -o ExitOnForwardFailure=yes "$EC2_HOST" &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 20); do
  (exec 3<>"/dev/tcp/127.0.0.1/$LOCAL_PORT") 2>/dev/null && { exec 3>&-; break; }
  kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "SSH トンネルの確立に失敗しました" >&2; exit 1; }
  sleep 0.5
done
echo "トンネル開通: localhost:$LOCAL_PORT -> 本番DB ($DB_NAME)"

case "$MODE" in
  psql)
    if command -v psql >/dev/null; then
      PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$LOCAL_PORT" -U "$DB_USER" -d "$DB_NAME"
    else
      TTY_FLAG="-i"; [ -t 0 ] && TTY_FLAG="-it"
      docker run --rm $TTY_FLAG --network host -e PGPASSWORD="$DB_PASS" \
        postgres:16-alpine psql -h 127.0.0.1 -p "$LOCAL_PORT" -U "$DB_USER" -d "$DB_NAME"
    fi
    ;;
  studio)
    cd "$APP_DIR" && DATABASE_URL="$DB_URL" npx prisma studio
    ;;
  tunnel)
    echo "接続URL: postgresql://$DB_USER:*****@localhost:$LOCAL_PORT/$DB_NAME (Ctrl+C で切断)"
    wait "$TUNNEL_PID"
    ;;
  *)
    echo "usage: $0 [psql|studio|tunnel]" >&2; exit 1 ;;
esac
