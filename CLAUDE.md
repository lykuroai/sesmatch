# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリの現状

仕様書 `ses_matching_platform_complete_spec_v2_0.md`（v2.0）がすべての設計・実装の正となるドキュメント。**Phase 1〜3 をすべて実装済み**（技術スタック: Next.js 15 App Router + Hono + Prisma + PostgreSQL + Tailwind v4、TypeScript フルスタック）。

なお、git リポジトリのルートは `/home/kaku`（ホームディレクトリ全体）であり、このディレクトリ専用のリポジトリではない点に注意。

## 開発コマンド

```bash
npm run db:up             # PostgreSQL 起動（Docker、ポート5433）
npm run db:migrate        # Prisma マイグレーション
npm run db:seed           # デモデータ投入（A社/B社、owner-a@example.com / password123 等）
npm run dev               # 開発サーバー（localhost:3000）
npm test                  # vitest 単体テスト（マッチング・PII・手数料・状態遷移の純粋ロジック）
npm run test:integration  # §34 必須テストの統合テスト（専用DB sesmatch_test を自動作成）
npm run build             # 本番ビルド
```

単一テスト実行: `npx vitest run tests/matching.test.ts`

- LLM の選択（`src/server/pipeline/llm.ts` の `getLlmGateway`、優先順）: ① `LLM_BASE_URL` — OpenAI 互換 API（`llm-openai.ts`。現在 `https://api.lykuro.ai/v1` + `deepseek/deepseek-v4-flash`。**`LLM_API_KEY` の設定が必要**）② `ANTHROPIC_API_KEY` — Claude API（`llm-claude.ts`、`claude-opus-5` 構造化出力）③ どちらもなければ正規表現モック
- 運営コンソール: `/admin`（`PLATFORM_ADMIN_TOKEN` でログイン）で企業審査・通報対応。API は `/api/v1/operations/*`（`X-Admin-Token` ヘッダ）
- 人材・案件の更新は `PUT /api/v1/engineers/:id` / `PUT /api/v1/projects/:id`（skills 全置換）。編集画面は詳細ページの「編集」から
- 取込の確定は確認フォーム（`ConfirmIngestionForm`）で抽出値を修正してから `POST /ingestions/:id/confirm` に `{name, confirmed}` を送る
- デプロイ: `DEPLOY.md` 参照（`Dockerfile` は migrate / runner の2ターゲット、`docker-compose.prod.yml` + `.env.production`。Next.js は standalone 出力）

## 実装構成

- `prisma/schema.prisma` — 全テーブル。業務データは必ず `tenantCompanyId` を持つ
- `src/server/api/app.ts` — Hono による REST API（`/api/v1`、§28/§29 準拠）。認証ミドルウェアで企業IDをセッションから確定
- `src/server/auth/` — セッション認証・RBAC（ロール→権限マッピング §7.2/§7.3）
- `src/server/matching/engine.ts` — ハードフィルター＋スコアリング（§19 の配点を実装、純粋関数でテスト対象）
- `src/server/pipeline/` — 取込パイプライン。`pii.ts`（匿名化＋匿名化検査）→ `llm.ts`（`LlmGateway` interface + モック）/ `llm-claude.ts`（Claude API 実装。JSON Schema による構造化出力 + zod 検証、トークン数を監査ログへ記録 §25.4）
- `src/server/services/` — 業務ロジック。RSC ページと API の両方から呼ばれる。開示レベル制御（Level 1 マスク）は serializer で実施
- `src/server/entries/logic.ts` — エントリー状態遷移の純粋ロジック（§20.2、テスト対象）。双方承認→Level 2 開示レコード作成は `services/entries.ts` の `approveEntry` が**同一トランザクション**で行う（§20.3、条件付き updateMany で並行承認を排他）
- `src/app/(console)/` — 企業コンソール UI（RSC + 一部クライアントコンポーネント）

Phase 2 の要点: エントリーは `@@unique([projectId, engineerId])` で重複応募をブロック。相互承認前のメッセージは `detectContactInfo`（全角・空白挿入の回避表現も正規化して検出）で連絡先を拒否し監査記録。一社下（SUBTIER1）人材の提案は「案件側 allowSubtier + 直接契約確認済み SUBTIER 関係 + 案件単位の承認フラグ」の3条件が必須。

Phase 3 の要点:
- `src/server/billing/fee.ts` — 手数料の純粋関数。`floor(額×3/100)`、12稼働月上限は **(projectId, engineerId, demandCompanyId) の組合せで CHARGED 件数を数え、契約を跨いで累計**（更新でリセットしない）。返金判定は稼働開始から14日以内（境界含む）
- 契約署名は承認と同じ「条件付き updateMany + 同一トランザクション」パターン。相互締結で EXECUTED＝成約、エントリーは CONTRACTED へ。契約作成には §22 の指揮命令チェックリスト5項目が必須
- 月次確認（WorkMonth）は需要側企業のみ実行可。`@@unique([contractId, month])` で重複防止。手数料は確認と同一トランザクションで計算
- 削除請求（§26）: 受付で即時非公開 → 承認で `Engineer.deletedAt` 論理削除（全クエリで `deletedAt: null` フィルタ必須）→ `scheduledPurgeAt`（+30日）以降のみ物理削除（PII不可逆除去・同意削除）。削除ログに個人情報を含めない

## システム概要

SES企業間で流通する案件情報と人材情報を、メール・ファイル・画面入力から収集し、**PII匿名化 → LLM正規化** を経て一元管理するB2Bプラットフォーム。全契約ユーザーは企業・事業者（テナント）で、案件⇄人材の双方向マッチングからエントリー、双方承認、面談、契約、稼働、月次手数料請求までを一貫して扱う。

## アーキテクチャの要点（仕様書より）

- **テナント分離**: 1企業=1テナント。全データに `tenant_company_id` を付与し行レベル分離。企業IDは認証情報から確定し入力値を信用しない。他テナントのデータ指定は 404 を返す（存在推測防止）。
- **案件企業/人材企業の固定区分なし**: 需要側・供給側は取引ごとに決定。案件マスターと各企業の「案件ルート」(`project_routes`) を分離し、フィンガープリントで名寄せ（類似度90以上=自動集約、70〜89.9=運営審査）。
- **取込パイプライン**: `受領 → 原本保存 → ウイルス検査 → OCR → 種別分類 → PII検出 → 匿名化 → LLM正規化 → JSON検証 → 人手確認 → 確定DB`。原文・LLM抽出値・人が確認した確定値は分離保存する。
- **3段階開示**: Level 1（検索・マッチング＝匿名情報のみ）→ Level 2（双方承認＝氏名・実額単価・企業名を相互同時開示）→ Level 3（契約締結）。双方承認と Level 2 開示レコード作成は同一トランザクションで原子的に行う。片側承認のみでの開示は禁止。
- **LLM への送信制約**: 匿名化済みテキストのみ送信可。氏名・連絡先・企業実名・実額金額・顔写真・健康/家族情報・在留証憑は送信禁止（国籍・性別・年齢は2026-08-05に送信禁止を撤廃。国籍は取込時のLLM抽出対象で、確認画面で人手確定して Engineer.nationality に保存）。PII置換表は別ストア・別鍵で保持し LLM に送らない。採否・契約判断を LLM だけで自動決定しない。
- **エントリー状態遷移**: `DRAFT → SUBMITTED → SUPPLY_APPROVED/DEMAND_APPROVED → MUTUALLY_APPROVED → INTERVIEW → CONDITIONS → CONTRACTING → CONTRACTED`
- **商流制約**: 最大一社下（SUBTIER1）まで。二社下以降・無承認再仲介・再転載は禁止。
- **手数料**: 需要側企業負担、確定契約金額の3%、実稼働開始から最大12稼働月（`fee_ex_tax = floor(amount × 3 / 100)`）。12か月上限は案件マスター×人材×需要側企業の組合せで集計し、更新契約でリセットしない。稼働前キャンセル0円、開始後14日以内離脱は全額返金。
- **非同期処理**: トランザクショナルアウトボックスでイベント発行（`DocumentReceived`, `MutualApprovalCompleted`, `FeeCalculated` 等）。コンシューマは冪等実装。変更APIは `Idempotency-Key` 対応。
- **API**: ベースパス `/api/v1`、JSON/UTF-8、日時は ISO 8601 UTC、金額は円整数。

## 実装時に必ず守る制約

- 性別・顔写真・民族を検索/マッチング条件やスクリーニングに使用しない。国籍は案件の「外国籍不可」受入条件（`noForeignNational`、2026-08-04追加）の判定にのみ使用する（人材は国名明記方式・未指定は日本国籍とみなす）。
- 有効な本人同意がない人材は公開できない。所属証憑期限切れで公開停止。
- 経路計算（通勤圏）は最寄駅・市区町村代表地点から行い、住所番地を使用しない。
- 同一人物×同一案件の重複応募をブロック（応募は1ルートのみ）。
- 契約署名・高額返金・PII物理削除・オーナー変更は申請者/承認者を分離（自己承認禁止）。
- 保存期限: 氏名・連絡先・スキルシート・原本は最終更新から2年。本人削除請求は即時非公開・論理削除 → 30日後物理削除 → バックアップ90日以内失効。
- 仕様書 §34「必須テスト」がテスト設計の基準（テナント分離、片側承認時の非開示、双方承認の原子性、冪等性など）。

## 段階導入計画

- **Phase 1**: 企業コンソール、企業/担当者/ロール、案件・人材管理、取込、PII匿名化・LLM正規化、双方向マッチング、同意管理
- **Phase 2**: 企業間公開、エントリー/スカウト、双方承認・段階開示、面談・メッセージ、一社下管理
- **Phase 3**: 電子契約、稼働確認、月次3%手数料、請求・返金、保存期限・本人請求

## 未決定事項（仕様書 §36）

技術スタック、クラウド、認証基盤、電子署名、税計算ルール、LLM API事業者（ゼロデータ保持契約）などは未決定。実装着手前にユーザーへ確認すること。
