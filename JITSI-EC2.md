# Web 会議基盤（Jitsi Meet）の構築・運用手順

PRO 版の Web 会議（`ses_directmatch_pro_spec_v1_0.md` §4.8）が使う自前 Jitsi Meet の運用メモ。
2026-11-05 に **暫定として lykuro-prod-data-node に同居**で構築（郭承認）。専用インスタンスへの移設は負荷を見て判断する。

## 1. 配置

| 項目 | 値 |
| --- | --- |
| ホスト | `lykuro-prod-data-node`（`i-0e328bb3204ab8935`、t4g.large arm64、ap-northeast-1）。公開 IP `18.181.207.71`（**Elastic IP**、郭確認 2026-11-05。`ec2-18-181-207-71.ap-northeast-1.compute.amazonaws.com`） |
| SSH | `ssh -i ~/.aws/lykuro-prod-key.pem ubuntu@ec2-18-181-207-71.ap-northeast-1.compute.amazonaws.com` |
| 配置先 | `/data/jitsi`（`.env`＝設定一式・秘密情報、`cfg/`＝各コンテナの設定と証明書、`docker-jitsi-meet-stable-11248-3/`＝公式リリースの展開物） |
| compose | `cd /data/jitsi/docker-jitsi-meet-stable-11248-3 && docker compose --env-file /data/jitsi/.env -p jitsi <cmd>`（プロジェクト名 `jitsi`。コンテナ `jitsi-web-1` / `jitsi-prosody-1` / `jitsi-jicofo-1` / `jitsi-jvb-1`） |
| イメージ | `ghcr.io/jitsi/{web,prosody,jicofo,jvb}:stable-11248-3`（arm64 対応。ルートレス実行のため `cfg/` は uid 1000 所有にしておく） |
| 公開ドメイン | `meet.lykuro.ai`。経路は **Cloudflare（プロキシ）→ ALB（TLS 終端、ACM の `*.lykuro.ai`）→ 本ホストの `lykuro-nginx`:80 → Jitsi web（`172.17.0.1:8000`、http）**。lykuro の他ドメインと同じ構成（郭、2026-11-05）。映像・音声（10000/udp）だけは ALB を通らず本ホストの公開 IP へ直接届く |

### ポート

| ポート | 用途 | 備考 |
| --- | --- | --- |
| 80/tcp | lykuro の nginx コンテナ（`lykuro-nginx`、ALB からのみ到達）。`meet.lykuro.ai` の vhost を `host.docker.internal:8000`（Jitsi web、http）へ WebSocket 透過で転送 | TLS は ALB で終端。Jitsi 側は `DISABLE_HTTPS=1`、443 は公開しない（`127.0.0.1:8443` のみ） |
| 10000/udp | JVB（音声・映像）。`JVB_ADVERTISE_IPS=18.181.207.71` | TURN（coturn）は未設置。UDP が通らない社内網からは接続できない場合がある |
| 127.0.0.1:18888 / 18080 | jicofo REST / JVB colibri（ローカルのみ） | lykuro 側が 8888/8080 を使うため変更 |

ホスト側の既存サービス（lykuro 本番: ゲートウェイ・管理画面・Web・spotomo・PostgreSQL・ClickHouse・Redpanda・Dragonfly）と CPU（2 vCPU）・メモリ（7.6GB）を共有する。面談中に lykuro 側が重くなるようなら専用 EC2 へ移す。

## 2. 設定の要点（`/data/jitsi/.env`）

- `PUBLIC_URL=https://meet.lykuro.ai`、`XMPP_DOMAIN=meet.lykuro.ai`（auth./muc./internal-muc./guest./hidden. も同じ基底で指定）
- 認証は JWT のみ: `ENABLE_AUTH=1`、`ENABLE_GUESTS=0`、`AUTH_TYPE=jwt`、`JWT_APP_ID=sesmatch`、`JWT_APP_SECRET=<hex 64>`、`JWT_ACCEPTED_ISSUERS=sesmatch`、`JWT_ACCEPTED_AUDIENCES=jitsi`。
  アプリ側（`src/server/meeting/jitsi.ts`）が発行する JWT は `aud=jitsi`、`iss=JITSI_APP_ID`、`sub=JITSI_DOMAIN`、`room`、HS256。`JITSI_APP_ID`／`JITSI_APP_SECRET` は上記と一致させる
- `ENABLE_RECORDING=0`、`ENABLE_TRANSCRIPTIONS=0`、`ENABLE_LOBBY=0`、`ENABLE_PREJOIN_PAGE=1`、`DEFAULT_LANGUAGE=ja`、`ENABLE_WELCOME_PAGE=0`、`TZ=Asia/Tokyo`
- TLS: ALB の ACM 証明書（`*.lykuro.ai`）で終端するため Jitsi 側は **http のみ**（`DISABLE_HTTPS=1`、`ENABLE_HTTP_REDIRECT=0`、`ENABLE_LETSENCRYPT=0`）。ブラウザは `https://meet.lykuro.ai` で接続し、WebSocket（`/xmpp-websocket`・`/colibri-ws/`）も ALB → nginx 経由で届く。nginx の vhost には Upgrade ヘッダの透過と長いタイムアウトが必要（`/data/jitsi/nginx-meet.lykuro.ai.conf`）
- `HTTP_PORT=172.17.0.1:8000`（docker0 のゲートウェイ。`lykuro-nginx` は `host.docker.internal`＝172.17.0.1 で到達するため、127.0.0.1 では 502 になる。外部からは SG で遮断）、`HTTPS_PORT=127.0.0.1:8443`（未使用）、`JICOFO_REST_PORT=18888`、`JVB_COLIBRI_PORT=18080`、`RESTART_POLICY=unless-stopped`
- 各コンポーネントの XMPP パスワードは `gen-passwords.sh` で生成済み
- **表示（Jitsi のロゴ・表記を消す。2026-11-05 郭指示）**: `cfg/web/custom-interface_config.js`（`APP_NAME`／`PROVIDER_NAME`＝SES DirectMatch、左上のロゴは `SHOW_JITSI_WATERMARK=true` のまま `DEFAULT_LOGO_URL`／`DEFAULT_WELCOME_PAGE_LOGO_URL` を横長ロゴ `https://meet.lykuro.ai/custom/logo-wordmark-dark.svg`（Jitsi web が `cfg/web/custom-static/` から配信。枠は既定 71×32px のため `custom.css` で 236×40px に拡大し、既定 CSS と連結した `all.css` を `cfg/web/nginx/custom-meet.conf` で `/css/all.css` として差し替え）に、`JITSI_WATERMARK_LINK=""`（クリックで遷移しない）、`SHOW_POWERED_BY=false`、`MOBILE_APP_PROMO=false`）と `cfg/web/custom-config.js`（`disableThirdPartyRequests=true`）。web コンテナ起動時に既定の `interface_config.js`／`config.js` の末尾へ連結される。変更後は `up -d --force-recreate web`。各ファイルの写しと `all.css` の再生成手順はリポジトリの `jitsi/README.md`（Jitsi 更新時は `all.css` を作り直す）。`DISABLE_DEEP_LINKING=1`（スマホでアプリ誘導ページを出さない）
  - **注意: Cloudflare が `config.js`・`interface_config.js`・`external_api.js` を 4 時間キャッシュする**（`cache-control: max-age=14400`、`cf-cache-status: HIT`）。設定変更を即時に反映したいときは Cloudflare でキャッシュをパージするか、最大 4 時間待つ（`curl -sI https://meet.lykuro.ai/config.js` の `age` で確認）

## 3. 初回開通に必要な手動作業（AWS・ホスト。郭）

**2026-11-05 にすべて完了**（1〜3 は郭が実施、4 で開通確認済み）。再構築時の記録として残す。
DNS（Cloudflare → ALB）と ALB の証明書（`*.lykuro.ai`）は元から `meet.lykuro.ai` に効いていた（nginx に vhost が無いうちは既定の lykuro アプリが応答する）。

1. **セキュリティグループ**（データノード）に受信追加: `10000/udp` を `0.0.0.0/0`（映像・音声は ALB を通らない）。80/443 の追加は不要
2. **ホストの ufw**: `sudo ufw allow 10000/udp comment "Jitsi JVB"`
3. **lykuro の nginx に vhost 追加**: `/data/jitsi/nginx-meet.lykuro.ai.conf` の内容を `/data/lykuro/src/docker/nginx/default.conf` の末尾に追記して `docker exec lykuro-nginx nginx -t && docker exec lykuro-nginx nginx -s reload`
   （この conf は lykuro リポジトリの作業コピーで、既に spotomo の追記があり未コミット。lykuro を再デプロイするときは消えないよう注意）
   **注意: 単一ファイルの bind mount なので、エディタで保存して inode が変わるとコンテナは古い内容を見続け、`nginx -s reload` でも反映されない。** その場合は `cd /data/lykuro/src && docker compose -f docker-compose.yaml up -d --force-recreate nginx`（数秒の断）。`tee -a` での追記や `cat > file` の上書きなら inode が変わらず reload だけでよい
4. 開通確認（開発機から）:
   ```bash
   curl -sI https://meet.lykuro.ai/ | head -1                 # 200
   curl -s https://meet.lykuro.ai/external_api.js | head -c 100  # Jitsi の JS
   ```
   任意: ALB のアイドルタイムアウト（既定 60 秒）を 300 秒以上にすると WebSocket の再接続が減る
5. アプリ側 `.env.production` の `JITSI_DOMAIN=meet.lykuro.ai`／`JITSI_APP_ID=sesmatch`／`JITSI_APP_SECRET=<.env の JWT_APP_SECRET>` のコメントを外し、`./scripts/release-ec2.sh` で反映（`docker-compose.ec2.yml` は 3 変数を渡す設定済み）。反映後、商談詳細の面談欄に「参加」が出ること、ゲスト URL `/m/<token>` が面談前後1時間だけ入室できることを確認する

## 4. 日常運用

```bash
# 状態・ログ
docker compose --env-file /data/jitsi/.env -p jitsi ps
docker logs --tail 100 jitsi-prosody-1   # 認証（JWT）失敗は "token" / "not allowed" を見る
docker logs --tail 100 jitsi-jvb-1       # 映像が出ないときは JVB_ADVERTISE_IPS と 10000/udp を確認
# 再起動
docker compose --env-file /data/jitsi/.env -p jitsi restart
# 停止（アプリ側は JITSI_* が設定済みでも「会議サーバーに接続できません」と表示されるだけ。止める前に .env.production の JITSI_* を外して反映するのが望ましい）
docker compose --env-file /data/jitsi/.env -p jitsi down
```

- 開通確認（開発機、ブラウザ不要）: アプリと同じ形式の JWT で 2 参加者を JVB 経由で入室させ、接続状態を確認する
  ```bash
  SECRET=<.env の JWT_APP_SECRET>; ROOM=ses-test$(date +%H%M%S)
  TA=$(node scripts/jitsi-sign-jwt.cjs $SECRET $ROOM 確認A); TB=$(node scripts/jitsi-sign-jwt.cjs $SECRET $ROOM 確認B)
  ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell --headless --no-sandbox --disable-gpu \
    --remote-debugging-port=9333 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream about:blank &
  H='#config.prejoinConfig.enabled=false&config.p2p.enabled=false'
  node scripts/jitsi-join-test.cjs "https://meet.lykuro.ai/$ROOM?jwt=$TA$H" "https://meet.lykuro.ai/$ROOM?jwt=$TB$H"   # 両者 joined:true, connState:"connected", p2p:false
  pkill -f remote-debugging-port=9333
  ```
  2026-11-05 の初回確認: 両参加者とも JVB 経由で connected、JVB ログに ICE 完了、画面に相手の参加通知（日本語 UI）を確認
- 更新: 新しい `stable-XXXX` の zip を `/data/jitsi` に展開し、`.env` の `JITSI_IMAGE_VERSION` を変えて `pull` → `up -d`。`env.example` に新しい必須変数が増えていないか CHANGELOG を確認。旧ディレクトリは残して戻せるようにする
- 秘密情報: `/data/jitsi/.env`（600）。`JWT_APP_SECRET` を変えるときはアプリ側 `.env.production` も同時に変える（発行済みの参加 JWT は無効になる）
- ディスク: ルート 29GB のうち Jitsi イメージで約 1.7GB を使用（2026-11-05 時点で空き 5.5GB）。`docker system df` で監視
- 録画・文字起こしは無効。会議内容はサーバに保存されない（プライバシーポリシー記載と整合）

## 5. 未対応・課題

- TURN（coturn）未設置。UDP 10000 が塞がれた環境のためには coturn（443/tcp）を追加する
- 監視（JVB の稼働）は未設定。`https://meet.lykuro.ai/` の外形監視を追加予定
- 専用インスタンスへの移設時は `/data/jitsi` を丸ごと移し、`JVB_ADVERTISE_IPS`・ALB のターゲット（または DNS）・SG の 10000/udp を変える
