# デプロイ手順

Docker Compose による単一ホスト構成。HTTPS 終端はリバースプロキシ（Caddy / nginx 等）で行う。

> **EC2 へのリリース**（開発機でビルド → イメージ転送 → 実行）は `RELEASE-EC2.md` を参照。
> 本書はサーバー上でビルドする構成（`docker-compose.prod.yml`）の手順。

## 1. 前提

- Docker / Docker Compose v2
- ドメインと DNS（HTTPS 用）
- LLM API キー（lykuro.ai または Anthropic。**ゼロデータ保持・学習オプトアウトの契約条件を確認すること** §25.4）

## 2. 初回セットアップ

```bash
cp .env.production.example .env.production
# .env.production を編集（POSTGRES_PASSWORD / SESSION_SECRET / PLATFORM_ADMIN_TOKEN / LLM_API_KEY）
openssl rand -hex 32   # SESSION_SECRET 用
openssl rand -hex 24   # PLATFORM_ADMIN_TOKEN 用

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

`migrate` サービスが `prisma migrate deploy` を実行してから `app` が起動する。
アプリは `127.0.0.1:3000` にのみバインドされる（直接公開しない）。

デモデータが必要な場合のみ（本番では通常不要）:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm migrate npx prisma db seed
```

## 3. HTTPS（Caddy の例）

セッション Cookie は本番ビルドで `Secure` 属性が付くため、**HTTPS 必須**。

```
# /etc/caddy/Caddyfile
sesmatch.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx の場合は `proxy_pass http://127.0.0.1:3000;` + certbot 等で証明書を設定。

## 4. 運用

### バックアップ（§32: 日次バックアップ）

```bash
# /etc/cron.d/sesmatch-backup（例: 毎日 3:00、14世代保持）
0 3 * * * root docker compose -f /path/to/docker-compose.prod.yml exec -T db \
  pg_dump -U sesmatch sesmatch | gzip > /backup/sesmatch-$(date +\%Y\%m\%d).sql.gz \
  && find /backup -name 'sesmatch-*.sql.gz' -mtime +14 -delete
```

原本ファイル（storage ボリューム）も同様にバックアップ対象とする。
復旧試験（§32）: 定期的にバックアップからテスト環境へリストアして検証すること。

### 更新デプロイ

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### 運営操作

- 企業審査・通報対応: `https://<ドメイン>/admin`（PLATFORM_ADMIN_TOKEN でログイン）
- 監査ログは追記型（audit_events）。UPDATE/DELETE する運用スクリプトを作らないこと（§31）

## 5. 本番前チェックリスト（仕様書 §36 の未決定事項を含む）

- [ ] LLM 事業者とのゼロデータ保持・学習オプトアウト契約（§25.4）
- [ ] 利用規約・プライバシーポリシー・同意文面の法務確認
- [ ] PII 検出器の NER 化（現状は正規表現ベース。`src/server/pipeline/pii.ts` を差し替え）
- [ ] PII 置換表の別ストア・別鍵化（現状は同一DB内の別テーブル §25.3）
- [ ] メール取込・OCR（現状はファイル/貼り付けのみ）
- [ ] 取込の非同期ジョブ化（現状は同期実行）
- [ ] 税率・端数・締日・支払期限の確定（現状は消費税10%切り捨ての暫定実装）
- [ ] MFA（§7.5: 管理者・契約・経理・個人情報管理者は必須）— 未実装
- [ ] 監視・アラート（§33）
