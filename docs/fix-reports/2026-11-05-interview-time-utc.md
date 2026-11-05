# 修正報告書: 商談詳細の面談時刻が 9 時間ずれて表示される（2026-11-05）

報告者: 郭 ／ 対応: Claude Code ／ 対象: 本番 ses.lykuro.ai

## 1. 事象

- 【事象】商談詳細の面談欄で、2026-11-05 20:30 JST に予定した Web会議（組込み）の面談が「2026/11/5 11:30:00」と表示される（直前の報告「2026/11/6 6:05:00」も同じ原因）
- 【期待】日本時間（JST）で「2026/11/5 20:30:00」と表示される
- 【根拠】利用者は日本の企業のみ。面談登録フォーム（ブラウザ側）は JST で入力・保存しており、左メニュー「Web会議」`/meetings` や面談通知メールは `timeZone: "Asia/Tokyo"` 指定で JST を表示している。同じ面談が画面ごとに別の時刻で見えるのは誤り
- 【発生環境】本番のみ（開発機はホストが JST のため再現しない）

## 2. 再現

本番 app コンテナ（`node:22-alpine`、`TZ` 未設定 → UTC）と同じ条件で確認:

```
$ docker run --rm node:22-alpine node -e 'console.log(new Date("2026-11-05T11:30:00Z").toLocaleString("ja-JP"))'
2026/11/5 11:30:00            # ← 本番の表示（UTC）
$ docker run --rm -e TZ=Asia/Tokyo node:22-alpine node -e '...同じ...'
2026/11/5 20:30:00            # ← 期待（JST）
```

修正後のイメージ（`docker build --target runner`）で同じコードが JST を返すことを確認した（§6）。

## 3. 原因

`src/app/(console)/entries/[id]/page.tsx:230` の `new Date(iv.scheduledAt).toLocaleString("ja-JP")` はサーバー（RSC）で実行され、タイムゾーン未指定のため **Node プロセスのタイムゾーン** で整形される。本番の app コンテナは `Dockerfile` / `docker-compose.ec2.yml` のどこにも `TZ` が無く、`node:22-alpine` の既定である UTC で動いていた。

この書き方（`toLocaleString("ja-JP")` をタイムゾーン指定なしでサーバー側に書く）は 2026-07-30 の初版（7ea35ea）から存在し、サーバー側で描画する画面 20 ファイル・61 箇所に同型のコードがある（契約・請求書・監査ログ・取込一覧など）。本番ではこれらすべてが UTC で表示されていた。保存値（DB の `scheduledAt`、UTC の ISO 8601）は正しく、表示だけの問題。

## 4. 影響範囲

- 修正する箇所: `Dockerfile` の runner ステージに `ENV TZ=Asia/Tokyo` を追加（1 行）。コードは変更しない
- 意図どおり変わる箇所: サーバー側で描画する日時表示 61 箇所がすべて JST になる。`services/analytics.ts:307` の `setHours(0,0,0,0)`（集計期間の起点）が UTC 0 時から JST 0 時になる（日本向けサービスとして正しい側へ寄る）。月数の加減算（`setMonth`）は結果に影響なし
- 影響を受けてはいけない箇所: DB 保存値（Prisma は常に UTC で読み書き）、API の日時（ISO 8601 UTC）、JST を明示している処理（`src/lib/plan-signup.ts`、`revision-notice.ts`、`/meetings`、面談メール、`+09:00` 付きのパース）、ブラウザ側のクライアントコンポーネント（元から利用者の端末のタイムゾーン）。確認方法: 単体テスト・統合テストの全件実行（§6）
- 開発環境: ホストが JST のため挙動変化なし

## 5. 修正内容

`Dockerfile`（runner ステージ）:

```
ENV TZ=Asia/Tokyo
```

Node は ICU のタイムゾーンデータを内蔵しているため、alpine に `tzdata` を追加しなくても `TZ` 環境変数が効く（§2 で確認）。61 箇所に `timeZone: "Asia/Tokyo"` を書き足す方法は差分が大きく漏れが出やすいため採らなかった。`RELEASE-EC2.md` §5 に症状と確認方法を追記。

## 6. 検証

- 修正後イメージでの確認（§2 と同じコード）: JST で出力（結果は下記）
- `npm test`／`npm run test:integration`／`npx tsc --noEmit`: 結果は下記

## 7. 別途提案（今回は未実施）

- 新規画面の日時表示は `/meetings` のように `timeZone: "Asia/Tokyo"` を明示する（コンテナ設定に依存しない）。共通の整形関数を `src/lib` に置くことを検討
- `docker-compose.prod.yml`（EC2 以外のデプロイ手順）も同じイメージを使うため追加対応は不要
