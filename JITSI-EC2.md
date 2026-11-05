# Web 会議基盤（Jitsi Meet）の構築・運用手順

PRO 版の Web 会議（`ses_directmatch_pro_spec_v1_0.md` §4.8）が使う自前 Jitsi Meet の運用メモ。
2026-11-05 に **暫定として lykuro-prod-data-node に同居**で構築（郭承認）。専用インスタンスへの移設は負荷を見て判断する。

## 1. 配置

| 項目 | 値 |
| --- | --- |
| ホスト | `lykuro-prod-data-node`（`i-0e328bb3204ab8935`、t4g.large arm64、ap-northeast-1）。公開 IP `18.181.207.71`（`ec2-18-181-207-71.ap-northeast-1.compute.amazonaws.com`） |
| SSH | `ssh -i ~/.aws/lykuro-prod-key.pem ubuntu@ec2-18-181-207-71.ap-northeast-1.compute.amazonaws.com` |
| 配置先 | `/data/jitsi`（`.env`＝設定一式・秘密情報、`cfg/`＝各コンテナの設定と証明書、`docker-jitsi-meet-stable-11248-3/`＝公式リリースの展開物） |
| compose | `cd /data/jitsi/docker-jitsi-meet-stable-11248-3 && docker compose --env-file /data/jitsi/.env -p jitsi <cmd>`（プロジェクト名 `jitsi`。コンテナ `jitsi-web-1` / `jitsi-prosody-1` / `jitsi-jicofo-1` / `jitsi-jvb-1`） |
| イメージ | `ghcr.io/jitsi/{web,prosody,jicofo,jvb}:stable-11248-3`（arm64 対応。ルートレス実行のため `cfg/` は uid 1000 所有にしておく） |
| 公開ドメイン | `meet.lykuro.ai`（Cloudflare DNS。**プロキシなし（DNS only）で本ホストの IP を直指し**。ALB は通さない） |

### ポート

| ポート | 用途 | 備考 |
| --- | --- | --- |
| 443/tcp | Jitsi web（HTTPS・XMPP WebSocket）。コンテナ 8443 を直接公開 | ホスト上で 443 は他に使っていない |
| 80/tcp | lykuro の nginx コンテナ（`lykuro-nginx`）。`meet.lykuro.ai` の vhost だけを `127.0.0.1:8000`（Jitsi web の HTTP）へ転送 | Let's Encrypt の HTTP-01 検証と https への 301 のみ |
| 10000/udp | JVB（音声・映像）。`JVB_ADVERTISE_IPS=18.181.207.71` | TURN（coturn）は未設置。UDP が通らない社内網からは接続できない場合がある |
| 127.0.0.1:18888 / 18080 | jicofo REST / JVB colibri（ローカルのみ） | lykuro 側が 8888/8080 を使うため変更 |

ホスト側の既存サービス（lykuro 本番: ゲートウェイ・管理画面・Web・spotomo・PostgreSQL・ClickHouse・Redpanda・Dragonfly）と CPU（2 vCPU）・メモリ（7.6GB）を共有する。面談中に lykuro 側が重くなるようなら専用 EC2 へ移す。

## 2. 設定の要点（`/data/jitsi/.env`）

- `PUBLIC_URL=https://meet.lykuro.ai`、`XMPP_DOMAIN=meet.lykuro.ai`（auth./muc./internal-muc./guest./hidden. も同じ基底で指定）
- 認証は JWT のみ: `ENABLE_AUTH=1`、`ENABLE_GUESTS=0`、`AUTH_TYPE=jwt`、`JWT_APP_ID=sesmatch`、`JWT_APP_SECRET=<hex 64>`、`JWT_ACCEPTED_ISSUERS=sesmatch`、`JWT_ACCEPTED_AUDIENCES=jitsi`。
  アプリ側（`src/server/meeting/jitsi.ts`）が発行する JWT は `aud=jitsi`、`iss=JITSI_APP_ID`、`sub=JITSI_DOMAIN`、`room`、HS256。`JITSI_APP_ID`／`JITSI_APP_SECRET` は上記と一致させる
- `ENABLE_RECORDING=0`、`ENABLE_TRANSCRIPTIONS=0`、`ENABLE_LOBBY=0`、`ENABLE_PREJOIN_PAGE=1`、`DEFAULT_LANGUAGE=ja`、`ENABLE_WELCOME_PAGE=0`、`TZ=Asia/Tokyo`
- TLS: `ENABLE_LETSENCRYPT=1`、`LETSENCRYPT_DOMAIN=meet.lykuro.ai`、`LETSENCRYPT_EMAIL=support@lykuro.ai`。web コンテナ内の acme.sh が取得し、`acme-renewal` サービスが 1日2回更新を確認する（証明書は `cfg/storage/web/acme-certs/`）。
  取得は **コンテナ内 8000 番の standalone 方式**（nginx を一時停止）なので、`meet.lykuro.ai:80` → `lykuro-nginx` → `127.0.0.1:8000` の経路が通っている必要がある
- `HTTP_PORT=127.0.0.1:8000`、`HTTPS_PORT=443`、`JICOFO_REST_PORT=18888`、`JVB_COLIBRI_PORT=18080`、`RESTART_POLICY=unless-stopped`
- 各コンポーネントの XMPP パスワードは `gen-passwords.sh` で生成済み

## 3. 初回開通に必要な手動作業（AWS・DNS・ホスト。郭）

1. **セキュリティグループ**（データノード）に受信を追加: `80/tcp`・`443/tcp`・`10000/udp` を `0.0.0.0/0`（IPv6 を使うなら `::/0` も）
   - 80 を開けると lykuro の各 vhost へも http で直接届くようになる（ALB 経由と同じ nginx）。問題があれば nginx 側で `meet.lykuro.ai` 以外の直接 http アクセスを拒否する
2. **ホストの ufw**: `sudo ufw allow 443/tcp comment "HTTPS (Jitsi)"` と `sudo ufw allow 10000/udp comment "Jitsi JVB"`
3. **lykuro の nginx に vhost 追加**: `/data/jitsi/nginx-meet.lykuro.ai.conf` の内容を `/data/lykuro/src/docker/nginx/default.conf` の末尾に追記して `docker exec lykuro-nginx nginx -t && docker exec lykuro-nginx nginx -s reload`
   （この conf は lykuro リポジトリの作業コピーで、既に spotomo の追記があり未コミット。lykuro を再デプロイするときは消えないよう注意）
4. **DNS**（Cloudflare）: `A meet.lykuro.ai → 18.181.207.71`、プロキシ無効（DNS only）。公開 IP が Elastic IP でなければ付与する（停止→起動で IP が変わると `JVB_ADVERTISE_IPS` も変える）
5. 上記が済んだら開発機から:
   ```bash
   ssh -i ~/.aws/lykuro-prod-key.pem ubuntu@ec2-18-181-207-71.ap-northeast-1.compute.amazonaws.com \
     'sed -i "s/^ENABLE_LETSENCRYPT=0/ENABLE_LETSENCRYPT=1/" /data/jitsi/.env && cd /data/jitsi/docker-jitsi-meet-stable-11248-3 && docker compose --env-file /data/jitsi/.env -p jitsi up -d web && sleep 60 && docker logs --tail 30 jitsi-web-1'
   curl -sI https://meet.lykuro.ai/ | head -1          # 200、証明書は Let's Encrypt
   curl -s https://meet.lykuro.ai/external_api.js | head -c 100
   ```
6. アプリ側 `.env.production` の `JITSI_DOMAIN=meet.lykuro.ai`／`JITSI_APP_ID=sesmatch`／`JITSI_APP_SECRET=<.env の JWT_APP_SECRET>` のコメントを外し、`./scripts/release-ec2.sh` で反映（`docker-compose.ec2.yml` は 3 変数を渡す設定済み）。反映後、商談詳細の面談欄に「参加」が出ること、ゲスト URL `/m/<token>` が面談前後1時間だけ入室できることを確認する

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

- 更新: 新しい `stable-XXXX` の zip を `/data/jitsi` に展開し、`.env` の `JITSI_IMAGE_VERSION` を変えて `pull` → `up -d`。`env.example` に新しい必須変数が増えていないか CHANGELOG を確認。旧ディレクトリは残して戻せるようにする
- 秘密情報: `/data/jitsi/.env`（600）。`JWT_APP_SECRET` を変えるときはアプリ側 `.env.production` も同時に変える（発行済みの参加 JWT は無効になる）
- ディスク: ルート 29GB のうち Jitsi イメージで約 1.7GB を使用（2026-11-05 時点で空き 5.5GB）。`docker system df` で監視
- 録画・文字起こしは無効。会議内容はサーバに保存されない（プライバシーポリシー記載と整合）

## 5. 未対応・課題

- TURN（coturn）未設置。UDP 10000 が塞がれた環境のためには coturn（443/tcp）を追加する
- 監視（JVB の稼働・証明書期限）は未設定。`https://meet.lykuro.ai/` の外形監視を追加予定
- 専用インスタンスへの移設時は `/data/jitsi` を丸ごと移し、`JVB_ADVERTISE_IPS` と DNS を変えるだけでよい
