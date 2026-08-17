# 子サーバ参考実装（フォルダ監視取込）

SESマッチングプラットフォーム（ses.lykuro.ai）へ、自社サーバ・PCのフォルダに置いた書類を
自動送信する**参考実装**です。貴社環境での改変・組み込みを前提としたサンプルコードであり、
そのまま本番運用することも、自社システム連携の雛形にすることもできます。

- 依存パッケージなし。`child-server.mjs` 1ファイルのみ（Node.js 20 以上）
- 通信はプラットフォームへの**アウトバウンドHTTPSのみ**。受信ポートは開けません
- 送信後の人手確認・確定は従来どおりWebコンソール（取込履歴）で行います

## 動作の流れ

```
案件/  に置いたファイル → 「案件」として取込API送信 → 解析完了で 取込済/ へ移動
人材/  に置いたファイル → 「人材」として取込API送信（1ファイル=1名）
                          解析失敗（種別不一致など）は エラー/ へ移動し .エラー.txt に理由を出力
```

サーバー側で種別チェックが行われるため、「案件」フォルダに入れたスキルシートは
登録されず、エラーとして返されます（人材フォルダへ入れ直してください）。

## セットアップ

1. Node.js 20 以上をインストール
2. `config.example.json` を `config.json` にコピーして編集
   - `email` / `password`: プラットフォームのログイン情報。**取込専用の担当者アカウントの
     作成を推奨**します（コンソールのメンバー管理から追加）
   - パスワードをファイルに書きたくない場合は環境変数 `SES_EMAIL` / `SES_PASSWORD` を使用
   - `config.json` を使う場合はファイル権限を制限してください（Linux: `chmod 600 config.json`）
3. 起動

```bash
node child-server.mjs            # 同じフォルダの config.json を使用
node child-server.mjs /path/to/config.json
```

常時稼働させる場合は systemd（Linux）やタスクスケジューラ（Windows）に登録してください。

### systemd 設定例

```ini
[Unit]
Description=SES child-server ingest watcher
After=network-online.target

[Service]
ExecStart=/usr/bin/node /opt/ses-child-server/child-server.mjs
Restart=always
User=sesingest
Environment=SES_EMAIL=ingest@example.co.jp
Environment=SES_PASSWORD=********

[Install]
WantedBy=multi-user.target
```

## 対応ファイル形式

PDF / Word (.doc, .docx) / Excel (.xls, .xlsx) / 画像 (.jpg, .jpeg, .png, .webp ※サーバー側でOCR) /
テキスト (.txt, .csv, .md)。1ファイル 20MB まで。

## 制限事項・注意

- **人材は1ファイル=1名**です。複数名を1ファイルにまとめないでください（先頭の1名分として
  抽出されることがあります）。案件は1ファイルに複数件含まれていればサーバー側で自動分割されます。
- 認証はセッション方式（約8時間で失効）です。失効時は自動で再ログインします。
- 送信成功の直後にプロセスが停止した場合など、ごく稀に同じ書類が二重送信される可能性が
  あります。取込履歴で重複に気づいた場合は不要な側を削除してください。
- 一時的な通信障害時はファイルをフォルダに残したまま、次回スキャンで自動再送します。
- このサンプルはローカルに書類の複製を作りません（取込済/エラーへの移動のみ）。
  ログにも書類の中身は出力しません。

## API について

このサンプルが使用しているAPIは次の3つです。自社システムから直接呼び出す場合の参考にしてください。

| API | 用途 |
|---|---|
| `POST /api/v1/auth/login` | ログイン（セッションCookie取得） |
| `POST /api/v1/ingestions` | 取込送信。multipart の `file` と `expectedKind`（`PROJECT_DESCRIPTION`＝案件 / `ENGINEER_SHEET`＝人材）。テキスト送信は JSON `{text, title, expectedKind}` |
| `GET /api/v1/ingestions/:id` | 取込状況の取得（`REVIEW_REQUIRED`＝人手確認待ち / `FAILED`＝失敗） |

## 免責

本サンプルは現状有姿で提供されます。貴社環境での動作・運用の責任は利用者にあります。
プラットフォーム利用規約の範囲でご利用ください。
