# EC2 リリース手順（ローカルビルド → イメージ転送 → 実行）

この Linux 開発機でイメージをビルドし、SSH 経由で EC2 に転送して起動するリリース方式。
レジストリ（ECR 等）は使わない。EC2 側ではビルドせず、受け取ったイメージを実行するだけ。

```
[開発機]                                      [AWS]
 docker build (migrate / runner)               ALB (https://ses.lykuro.ai, HTTPS終端)
   └─ docker save | gzip ── ssh ──▶             │ HTTP:80
 docker-compose.ec2.yml ──── scp ──▶ [EC2]      ▼
                                      nginx(:80) ──▶ app(127.0.0.1:3000)
                                      docker compose up -d
                                        db → migrate → app
```

通常のリリースは **`./scripts/release-ec2.sh` の1コマンド**で完了する。

## 1. 初回セットアップ（EC2 側・一度だけ）

### 1-1. インスタンス

- Ubuntu 22.04/24.04、x86_64（Graviton の場合はリリース時に `PLATFORM=linux/arm64` を指定）
- 推奨 t3.small 以上（メモリ2GB〜）、ディスク 20GB〜
- セキュリティグループ（EC2）: 22（自分の IP のみ）/ 80（**ALB のセキュリティグループからのみ**）を開放。
  アプリは `127.0.0.1:3000` にしかバインドしないため 3000 番は開けない。443 は ALB が受けるため EC2 では不要。

### 1-2. Docker と配置ディレクトリ

```bash
# EC2 にログインして実行
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 再ログインで反映

sudo mkdir -p /opt/sesmatch
sudo chown $USER /opt/sesmatch
```

### 1-3. .env.production の配置

開発機で作成して転送する（EC2 上で直接編集してもよい）:

```bash
# 開発機で
cp .env.production.example /tmp/env.production
# 編集: POSTGRES_PASSWORD / SESSION_SECRET / PLATFORM_ADMIN_TOKEN / LLM_API_KEY
openssl rand -hex 32   # SESSION_SECRET 用
openssl rand -hex 24   # PLATFORM_ADMIN_TOKEN 用

scp -i ~/.aws/lykuro-prod-key.pem /tmp/env.production ubuntu@<EC2_IP>:/opt/sesmatch/.env.production
shred -u /tmp/env.production
ssh -i ~/.aws/lykuro-prod-key.pem ubuntu@<EC2_IP> chmod 600 /opt/sesmatch/.env.production
```

### 1-4. Web サーバ（nginx）— 開発機から1コマンド

nginx を導入し、ALB からの HTTP:80 を `127.0.0.1:3000` の app へ転送する設定を配置する:

```bash
# 開発機で（EC2_HOST は scripts/release-ec2.env に設定済みであること）
./scripts/setup-ec2-web.sh
```

設定内容は `deploy/nginx-sesmatch.conf`（`X-Forwarded-Proto` は ALB の値を引き継ぐ）。

### 1-5. ALB（手動設定用の値）

セッション Cookie は本番ビルドで `Secure` 属性が付くため、**ALB での HTTPS 終端が必須**（HTTP のままではログイン不可）。

| 項目 | 設定値 |
|---|---|
| ACM 証明書 | `ses.lykuro.ai`（ALB と同リージョンで発行） |
| リスナー | HTTPS:443 → ターゲットグループへ転送。HTTP:80 → 443 へリダイレクト（推奨） |
| ターゲットグループ | HTTP:80、ターゲット = この EC2 インスタンス |
| ヘルスチェック | パス `/api/v1/health`、成功コード `200`（DB 疎通まで確認して返す） |
| アイドルタイムアウト | 120秒以上（取込確定は LLM 正規化を同期実行するため） |
| セキュリティグループ（ALB） | インバウンド 443・80 を 0.0.0.0/0 から許可 |
| セキュリティグループ（EC2） | インバウンド 80 を **ALB の SG からのみ**許可 |
| DNS | `ses.lykuro.ai` → ALB（Route 53 なら A レコードのエイリアス、他社 DNS なら CNAME） |

## 2. リリース（毎回・開発機で1コマンド）

```bash
cp scripts/release-ec2.env.example scripts/release-ec2.env   # 初回のみ。EC2_HOST を編集
./scripts/release-ec2.sh
```

スクリプトが行うこと:

1. `sesmatch-migrate` / `sesmatch-app` を `日時-gitSHA` タグでビルド
2. EC2 側の前提（Docker / `.env.production`）を確認
3. `docker-compose.ec2.yml` を scp、イメージを `docker save | gzip | ssh docker load` で転送
4. `docker compose up -d` — `migrate`（`prisma migrate deploy`）成功後に `app` を起動
5. `http://127.0.0.1:3000/` へのヘルスチェック（最大60秒）
6. 古いイメージを直近5世代残して削除

DB（`pgdata`）と原本ファイル（`storage`）は名前付きボリュームなので、リリースを繰り返しても消えない。

## 3. ロールバック

EC2 には過去5世代のイメージが残っている。旧タグを指定して起動し直すだけ:

```bash
ssh -i ~/.aws/lykuro-prod-key.pem ubuntu@<EC2_IP> \
  "docker images sesmatch-app --format '{{.Tag}}'"   # 残っているタグ一覧

ssh -i ~/.aws/lykuro-prod-key.pem ubuntu@<EC2_IP> \
  "cd /opt/sesmatch && IMAGE_TAG=<旧タグ> docker compose -f docker-compose.ec2.yml --env-file .env.production up -d"
```

**注意**: `prisma migrate deploy` で適用済みの DB マイグレーションは自動では戻らない。
カラム削除などの破壊的マイグレーションを含むリリースは、ロールバック可否を事前に確認すること。

## 4. 運用

### ログ・状態確認

```bash
ssh -i ~/.aws/lykuro-prod-key.pem ubuntu@<EC2_IP>
cd /opt/sesmatch
docker compose -f docker-compose.ec2.yml --env-file .env.production ps
docker compose -f docker-compose.ec2.yml --env-file .env.production logs -f app
```

### バックアップ（§32: 日次）

```bash
# EC2 の /etc/cron.d/sesmatch-backup（毎日 3:00、14世代保持）
0 3 * * * root docker compose -f /opt/sesmatch/docker-compose.ec2.yml --env-file /opt/sesmatch/.env.production exec -T db \
  pg_dump -U sesmatch sesmatch | gzip > /backup/sesmatch-$(date +\%Y\%m\%d).sql.gz \
  && find /backup -name 'sesmatch-*.sql.gz' -mtime +14 -delete
```

原本ファイル（`storage` ボリューム）もバックアップ対象。定期的にテスト環境へリストアして復旧試験を行うこと（§32）。

### デモデータ投入（通常は不要）

```bash
cd /opt/sesmatch
docker compose -f docker-compose.ec2.yml --env-file .env.production run --rm migrate npx prisma db seed
```

## 5. トラブルシューティング

| 症状 | 対処 |
|---|---|
| ヘルスチェック NG | `docker compose ... logs app migrate` を確認。多くは `.env.production` の値不備か migrate 失敗 |
| `exec format error` | ビルドと EC2 の CPU アーキ不一致。`PLATFORM=linux/arm64`（Graviton）を指定して再リリース |
| 転送が遅い | イメージは gzip 済み数百MB。初回以降も全量転送のため、回線が細い場合は ECR 方式への移行を検討 |
| ログインできない/Cookie が効かない | `https://ses.lykuro.ai`（ALB）経由でアクセスしているか確認（Secure Cookie のため HTTP 直アクセスでは不可） |
| ALB ヘルスチェックが unhealthy | EC2 で `curl -i http://127.0.0.1/api/v1/health` を確認。503 なら DB、接続不可なら nginx/app 未起動。EC2 SG が ALB の SG からの 80 を許可しているかも確認 |

本番前チェックリスト（LLM ゼロデータ保持契約、MFA、監視等）は `DEPLOY.md` §5 を参照。
