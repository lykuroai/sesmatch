# SES DirectMatch PRO版（有料プラン）企画・仕様書 v1.9

作成日: 2026-11-04 ／ 最終更新: 2026-11-05 ／ 状態: **企画確定・段階A/B/C 実装済み（§14 A-1〜C-4。2026-11-04。Jitsi 基盤は 2026-11-05 に暫定ホストへ構築・DNS 開通待ち（`JITSI-EC2.md`）。Stripe は初期版で提供せず、IdP の実環境接続は未）**
本書は `ses_matching_platform_complete_spec_v2_0.md`（本体仕様書）の追加仕様（有料プラン編）であり、**PRO版の全機能**を対象とする。契約事務（注文書 PDF・月次一括確認・外部契約台帳）と電子署名連携は 2026-11-04 の郭判断で対象外とした。本体仕様書と矛盾する場合は本体仕様書を優先する。本体仕様書への反映（§23.0 改定、§39 新設等）は実装着手時に行う。

---

## 1. 目的と方針

### 1.1 目的

- 現行サービス（基本版）は 2026-08-22 に完全無料化した（本体 §23.0）。本書は、その上に有料プラン「PRO版」を新設し、月額固定の収益基盤を作ることを目的とする。
- 基本版の無料提供は継続し、利用企業の母数拡大（マーケティング）と PRO への段階的移行を両立する。

### 1.2 基本方針（2026-11-04 郭決定）

1. **基本版は現行機能をすべて無料で提供し続ける。** 掲載料・成約手数料の 0円は変更しない。
2. **PRO版は「量・速さ・自動化・分析・統制」の上乗せ機能**で差を付ける。人材本人の匿名性（氏名・実額単価は双方承認後のみ）、双方承認・同時開示、マッチングのスコア順位はプランで差を付けない。
   例外として、**PRO版では相手企業（掲載企業）の企業名を明示する**（§4.1）。
3. **課金は月額固定（1社単位）**とする。成約時課金・ハイブリッドは採用しない。
4. **決済は請求書払いで開始**する。カード決済（§4.15）は後続リリースで追加し、請求書払いと併用する。
5. **将来、基本版に取込件数等の上限を設ける余地を残す**（§7）。導入時は規約改定と1か月前告知を行う。
6. PRO機能であっても、性別・顔写真・民族をマッチングや出力に用いない、LLMだけで採否を決めない、二社下以降を扱わない等の本体の禁止事項は変えない。

---

## 2. プランと料金

| 項目 | 内容 |
|---|---|
| プラン | FREE（基本版）／ TRIAL（PRO お試し）／ PRO |
| PRO 月額 | **39,800円（税別）／社**。担当者（有効なメンバー）5名まで含む |
| 追加担当者 | **4,000円（税別）／名／月**。6名以降に適用。前月末時点の有効メンバー数で算定 |
| 年払い | **廃止（2026-11-05 郭決定）**。月払いのみ、割引なし |
| TRIAL | 30日。運営が付与し、期限到来で FREE へ自動降格。TRIAL 中は請求しない |
| 月途中の開始 | **日割りなし。開始当月は無料、翌月分から請求** |
| 決済 | 請求書払い（月末締め・翌月末振込、適格請求書）のみ。カード決済（Stripe、§4.15）は実装済みだが初期版では提供しない（2026-11-05 郭決定） |
| 解約 | 当月末までの申し出で翌月から FREE。データは保持し、PRO 機能のみ停止 |
| 未入金 | 2か月未入金で運営判断により FREE へ降格可。データは削除しない |

税率は請求日時点の消費税率を適用し、税額は切り捨て（本体 §36-5 の税計算ルール確定時に見直す）。PRO 機能はすべて月額に含まれ、機能別の追加料金は設けない（SSO の外部事業者費用は §15 で扱う）。

---

## 3. 機能比較一覧（完全版）

凡例: ○＝利用可（制限なし）、△＝制限付き、−＝提供なし。「順」はリリース順（A→B→C、§14）。基本機能はプランで差を付けない。

**企業・担当者**

| 機能 | FREE | PRO | 順 |
|---|---|---|---|
| 企業申込（メール認証→登録、自動審査で即時開通） | ○ | ○ | |
| 担当者数 | ○（無制限。将来上限候補 3名） | 5名込み。追加 4,000円/名 | A |
| ロール・権限（代表・管理者・営業・閲覧等） | ○ | ○ | |
| 企業プロフィール・派遣許可情報 | ○ | ○ | |
| 企業間関係（一社下 SUBTIER 管理、直接契約確認） | ○ | ○ | |
| 2要素認証（TOTP）の利用 | ○（§4.11 で基本版にも提供） | ○ | B |
| 2要素認証の全員必須化 | − | ○ | B |
| IP アドレス制限 | − | ○ | C |
| SSO（SAML 2.0／OIDC） | − | ○ | C |

**案件・人材の登録と取込**

| 機能 | FREE | PRO | 順 |
|---|---|---|---|
| 案件・人材の画面入力・編集 | ○ | ○ | |
| 貼り付け取込（メール本文・テキスト） | ○ | ○ | |
| ファイル取込（PDF・Word・Excel・画像） | ○ | ○ | |
| ローカル OCR（画像・画像 PDF）、スマホ撮影・複数ページ結合 | ○ | ○ | |
| LLM 正規化（要約・スキル抽出・用語辞書による名寄せ） | ○ | ○ | |
| 抽出結果の人手確認・修正・確定 | ○ | ○ | |
| 複数案件の自動分割（1書類に複数案件） | ○ | ○ | |
| 一括取込（複数ファイル同時アップロード） | −（1ファイル/回） | ○（最大20ファイル/回） | A |
| 人材書類の複数件自動分割 | − | ○ | A |
| 取込件数 | ○（無制限。将来上限候補 月30件） | ○（無制限） | |
| API トークン本数 | 2本/社 | 10本/社 | B |
| ローカルサーバ（lykuro-connector）設置支援 | −（参考実装・自己構築） | ○（オンライン設置支援） | B |

**公開・検索・マッチング**

| 機能 | FREE | PRO | 順 |
|---|---|---|---|
| 案件・人材の公開・取り下げ（本人同意・所属証憑の管理含む） | ○ | ○ | |
| 公開中件数 | ○（無制限。将来上限候補 案件20・人材20） | ○（無制限） | |
| 公開案件・公開人材の検索（匿名カード、同義語展開） | ○ | ○ | |
| AI マッチング（案件→人材、人材→案件、スコア表示） | ○ | ○ | |
| 一覧の新着印 | ○ | ○ | |
| 取引先登録済み企業の掲載企業名表示（本体 §10.1） | ○ | ○ | |
| 相手企業名の明示（他社の公開案件・人材すべてに掲載企業名を表示） | − | ○ | A |
| 保存検索（条件の保存） | − | ○（10件/社） | A |
| 新着アラート（メール通知。即時／1日1回まとめ） | − | ○ | A |
| Slack／Teams Webhook 通知 | − | ○（5件/社） | B |

**商談・開示・面談**

| 機能 | FREE | PRO | 順 |
|---|---|---|---|
| 商談申込み（エントリー）・スカウト | ○ | ○ | |
| 双方承認・Level 2 同時開示（氏名・実額・企業名） | ○ | ○ | |
| メッセージ（承認前の連絡先検出・拒否） | ○ | ○ | |
| 面談設定・条件調整 | ○ | ○ | |
| 一斉スカウト（最大20名/回、50件/日） | − | ○ | B |
| スカウト文の AI 下書き | − | ○ | B |
| 既読表示・反応率 | − | ○ | B |
| スキルシート再生成（自社書式 PDF／Excel、匿名版・実名版） | − | ○ | B |
| Web 会議（コンソール組込み・自前 Jitsi。人材本人はゲスト URL 参加） | − | ○ | B |

**契約・稼働・手数料**

| 機能 | FREE | PRO | 順 |
|---|---|---|---|
| 条件確認書の作成・相互署名（指揮命令チェックリスト） | ○ | ○ | |
| 稼働開始・終了、月次稼働確認 | ○ | ○ | |
| 成約手数料 | 0円 | 0円 | |

**分析・レポート**

| 機能 | FREE | PRO | 順 |
|---|---|---|---|
| ホーム KPI（公開中件数、承認待ち、面談予定、稼働中など） | ○ | ○ | |
| 商談ファネル・案件／人材ごとの反応状況 | − | ○ | A |
| 市場単価レンジ（匿名統計） | − | ○ | A |
| CSV エクスポート（案件・人材・商談） | − | ○ | A |

**ガバナンス・サポート**

| 機能 | FREE | PRO | 順 |
|---|---|---|---|
| 監査ログの閲覧 | ○ | ○ | |
| 監査ログのエクスポート（CSV／JSON、期間指定、月次自動送付） | − | ○ | C |
| 本人同意・訂正・削除請求の管理 | ○ | ○ | |
| 通報・異議申立て | ○ | ○ | |
| スマホ対応・PWA | ○ | ○ | |
| 操作マニュアル | ○ | ○ | |
| お問合せ | ○（通常対応） | ○（優先対応・目安1営業日） | A |
| 導入オンボーディング（オンライン60分） | − | ○ | A |

**料金**

| 項目 | FREE | PRO |
|---|---|---|
| 月額 | 0円 | 39,800円（税別）。月払いのみ（年払いは廃止） |
| 掲載料・成約手数料 | 0円 | 0円 |
| お試し | − | TRIAL 30日 |
| 決済 | − | 請求書払い（A）／カード決済（C） |

---

## 4. PRO 機能仕様

各項は「概要／動作仕様／制約／データ・API／テスト観点」の順に記す。機能キーは §5 のゲート関数に渡す識別子。

### 4.1 相手企業名の明示（機能キー `company_name_display`）

**概要**: PRO 利用企業には、他社の公開案件・公開人材の一覧／詳細／マッチング候補／商談画面で掲載企業名を明文表示する。本体 §10.1（企業間関係に登録した取引先に限る Level 1 の例外）を、PRO 利用企業については全他社へ拡張する。

**動作仕様**
- 表示するのは掲載企業名（案件保有企業・人材所属企業の名称）のみ。人材本人の氏名・実額単価・詳細スキルシート、担当者名などの Level 2 情報は従来どおり双方承認後にのみ開示する。
- 片方向で表示する。PRO 利用企業が見る側であり、掲載側（FREE／PRO を問わず）に追加の操作は不要。PRO 利用企業自身の企業名は相手（FREE 企業）に見せず、従来どおり双方承認まで非開示とする（2026-11-04 郭決定）。
- 掲載企業側のオプトアウト（自社名を PRO 企業にも見せない設定）は設けない（2026-11-04 郭決定）。匿名掲載を希望する企業が増えると PRO の価値が下がるため。
- エンド企業名（案件の最終顧客）は対象外。本体 §10 のとおり面談確定時まで非開示を既定とし、案件企業の早期公開設定に従う。
- 対象は開通済み（ACTIVE）テナントの公開中データのみ。論理削除済み・非公開のものは表示しない。
- 商談申込み前に相手企業名が分かるため、商談申込み時に既存取引の申告（本体 §24）を促す。

**データ・API**: 新規テーブルなし。本体 §10.1 の `partnerCompanyName`（`src/server/services/partners.ts`、serializer）を流用し、閲覧側が機能キーを満たす場合は取引先登録の有無にかかわらず掲載企業名を返す。判定はサーバ側で行い、画面側の出し分けに頼らない。

**テスト観点**: FREE（取引先未登録）には返らない。PRO には返るが Level 2 情報は双方承認前に返らない。非公開・論理削除済みは対象外。PRO 企業の名前は相手の FREE 企業に返らない。

### 4.2 一括取込（`bulk_ingest`）

**概要**: 複数ファイルを一度にアップロードして取込ジョブを並列に作成する。人材書類に複数人が含まれる場合は自動分割する。

**動作仕様**
- 1回に最大20ファイル、合計100MB。対応形式は既存のファイル取込と同じ（PDF・Word・Excel・画像）。ZIP は対象外。
- 各ファイルは既存のパイプライン（原本保存→OCR→種別分類→LLM 正規化→人手確認）を個別に通る。1件の失敗は他に影響しない。
- 取込履歴に「一括 #番号」のまとまりで進捗（待機／処理中／確認待ち／失敗）を表示する。
- 人材書類の複数件分割: 案件の自動分割（`src/server/pipeline/split.ts`）と同じ方式で、LLM に「書類に含まれる人材の人数と各人の範囲」を判定させ、1人ごとに抽出結果を作る。確認画面では1件ずつ確定・破棄できる。スキルシート1枚に1人が通常であるため、2人以上と判定された場合のみ分割する。
- FREE は従来どおり1ファイル/回。複数選択 UI は PRO 案内を表示する。

**データ・API**: `ingestion_jobs` に `batchId`（任意）を追加。`POST /ingestions/bulk`（multipart、最大20）。

**テスト観点**: 各ファイルが自テナントのジョブになる。21ファイル以上・合計100MB超は拒否。人材分割で各人の抽出結果が独立し、確認画面で個別に確定できる。FREE で `bulk` を呼ぶと 403 PLAN_REQUIRED。

### 4.3 保存検索と新着アラート（`saved_search_alert`）

**概要**: 案件検索・人材検索の条件を保存し、新しく公開された案件・人材が条件に合えばメールで知らせる。

**動作仕様**
- 保存検索は10件/社。条件は検索画面と同じ形式（スキル・勤務地・単価・在宅・稼働開始時期など）に加え、必須スキル充足率（本体 §19.1 のしきい値）を適用する。
- 通知方式: 即時（IMMEDIATE）／1日1回まとめ（DAILY、9:00 JST）／停止（OFF）。
- 評価は15分間隔。`lastEvaluatedAt` 以降に公開された対象のみ抽出し、同一対象を二重通知しない。1通あたり最大20件、超過分は件数のみ記載する。
- 通知内容は Level 1 の範囲（匿名カード相当）。PRO のため掲載企業名は含める。人材の氏名・実額単価は含めない。
- 宛先は保存検索を作成したメンバー本人のメール。メンバーが停止・退職したら通知も停止する。
- 評価は Next.js `instrumentation.ts` の `register()` でプロセス内タイマーを起動する。単一コンテナ運用が前提。複数インスタンス化する場合は外部スケジューラに移す。

**データ・API**: `saved_searches`（§8.2）。`GET/POST/PUT/DELETE /saved-searches`。

**テスト観点**: 二重通知しない。他テナントの非公開・論理削除データを含めない。Level 2 情報を含めない。11件目の保存は拒否。OFF では送らない。

### 4.4 分析・エクスポート（`analytics_export`）

**概要**: 自社の営業活動を数値で把握し、データを CSV で持ち出せるようにする。

**動作仕様**
- 商談ファネル: 期間指定（月／四半期）、送信側・受信側の別に、申込→承認→面談→契約の件数と転換率。
- 反応状況: 案件ごとの申込数・承認率・申込から承認までの平均日数。人材ごとの提案数・承認率。
- 市場単価レンジ（匿名統計）: 公開中案件の単価上限をスキル×勤務地（都道府県）で集計し、**異常値を除いた上で**下位25%・中央値・上位25%を表示（2026-11-05 郭指示で最小・最大から変更）。異常値は①妥当範囲 20万〜300万円/月の外、②母数5件以上のセルで四分位範囲の1.5倍を超える外れ値。除外後の母数5件未満のセルは表示しない。企業名・案件名・個別単価は出さない。人材側の希望単価は本人情報のため対象外。
- CSV エクスポート: 案件・人材・商談の一覧（UTF-8 BOM 付き）。自社データのみ。相手側の情報は開示レベルに従い、未開示のものは匿名のまま出力する。出力ファイルは保存せず都度生成し、監査ログに記録する。

**データ・API**: 新規テーブルなし。`GET /analytics/funnel`、`GET /analytics/market-rates`、`GET /analytics/export?kind=projects|engineers|entries`。

**テスト観点**: 母数5件未満のセルが出ない。CSV に他テナントのデータ・未開示の Level 2 情報が含まれない。エクスポートが監査ログに記録される。

### 4.5 優先サポート・導入オンボーディング（`priority_support`）

**動作仕様**
- お問合せ（`inquiries`）に PRO 印を付け、運営コンソールで優先表示する。回答目安は1営業日。
- 導入オンボーディング: PRO 開始後1回、オンライン60分の初期設定支援（担当者登録、取込、公開、保存検索の設定）。運営が日程調整する。

**データ・API**: `inquiries` に `priority`（Boolean）。運営 API のソート順に反映。

### 4.6 一斉スカウト・AI 下書き・既読と反応率（`bulk_scout`）

**概要**: 人材検索の結果から複数人材を選び、まとめてスカウトを送る。

**動作仕様**
- 1回に最大20名、1社あたり1日50件まで（スパム抑止）。超過は 429 SCOUT_DAILY_LIMIT。
- 各人材に対して既存のスカウト（`Entry` の SCOUT 種別）を個別に作成する。重複応募ブロック（同一案件×同一人材は1ルート）に従い、既存エントリーがある人材はスキップして結果に表示する。
- 本文はテンプレート（変数: 案件名、単価帯、勤務地、開始時期）を使う。送信前に必ず人手で編集・確認する画面を通し、連絡先検出（本体 §21）を適用する。
- AI 下書き: 案件の要約と人材の Level 1 情報（スキル・経験・単価帯）から LLM が下書きを生成する。生成文は送信前に人手確認を必須とし、LLM だけで送信しない。氏名・実額など Level 2 情報は LLM に渡さない。
- 既読: 相手がメッセージ画面を開いた時刻を `EntryMessage.readAt` に記録し、送信側に「既読」を表示する。FREE 企業が相手の場合も記録はするが、既読表示は PRO 側にのみ出す。
- 反応率: 一斉スカウトごとに 送信数／承認／辞退／無反応 の割合を表示する。

**データ・API**: `scout_batches`（§8.5）、`entries.scoutBatchId`、`entry_messages.readAt`。`POST /scouts/bulk`、`POST /scouts/draft`（AI 下書き）、`GET /scouts/batches/:id`。

**テスト観点**: 21名以上・1日51件目は拒否。既存エントリーがある人材はスキップされ二重申込みにならない。連絡先を含む本文は拒否される。AI 下書きの入力に Level 2 情報が含まれない。

### 4.7 スキルシート再生成（`skill_sheet_render`）

**概要**: 確定済みの人材データから、自社書式のスキルシートを PDF／Excel で生成する。SES 営業で各社書式への転記作業をなくす。

**動作仕様**
- テンプレート: 既定2種（標準・簡易）に加え、自社ロゴ・社名・項目配置を設定した自社テンプレートを3件まで登録できる。
- 匿名版: Level 1 情報（イニシャル、年代、スキル、経験、単価帯、勤務可能エリア）のみ。自社人材・他社人材とも生成可。
- 実名版: 氏名・実額単価を含む。自社人材は常に可。他社人材は双方承認（Level 2 開示）済みの商談に限る。
- 生成物に性別・顔写真・国籍を含めない（本体の禁止事項）。
- 出力は保存せず都度生成し、監査ログに「誰が・どの人材・匿名／実名」を記録する。人材本人の氏名は監査ログに書かない。

**データ・API**: `skill_sheet_templates`（§8.6）。`GET/POST/PUT/DELETE /skill-sheet-templates`、`POST /engineers/:id/skill-sheet?template=&mode=anonymous|named&format=pdf|xlsx`。

**テスト観点**: 他社人材の実名版は未承認なら 403。匿名版に氏名・実額が含まれない。生成が監査ログに記録される。

### 4.8 Web 会議（`web_meeting`）

**概要**: 面談をコンソール内のブラウザで行える組込み Web 会議。自前運用の Jitsi Meet を基盤とし、人材本人はログイン不要のゲスト URL で参加する。基本版には会議リンク連携を含め提供しない（2026-11-04 郭決定）。

**動作仕様**
- 面談（`interviews`）の作成・編集で「Web 会議（組込み）」を選ぶと会議室を自動作成する。会議室名はランダムな識別子とし、案件名・氏名を含めない。
- 両社の担当者は商談詳細の面談欄の「参加」ボタンからコンソール内（iframe 埋め込み）で参加する。参加には本プラットフォームが発行する短命の JWT（Jitsi の JWT 認証）が必要で、JWT なしでは会議室に入れない。
- 人材本人の参加: 供給側企業が「本人用の参加 URL」を発行し、本人へ転送する。URL は `https://ses.lykuro.ai/m/<token>` の形式で、ログイン不要。面談予定時刻の前後1時間のみ有効。表示名は本人が入力する（既定はイニシャル）。再発行すると旧 URL は無効になる。
- 商談の両社いずれかが PRO であれば開催できる。会議室を作成できるのは PRO 側のみで、相手が FREE でも参加は可能。
- 機能: 音声・映像、画面共有、通話中テキストチャット、参加者一覧、ミュート。参加者は最大6名。待機室（ロビー）は使わず、JWT またはゲスト URL を持つ者だけが入室できる。
- 録画・文字起こし・LLM 要約は初版では行わない（2026-11-04 郭決定）。会話内容・チャットはサーバに保存しない（Jitsi の録画機能 Jibri は導入しない）。
- 監査ログには会議の作成・開始・終了・参加者数のみ記録する。会話内容・参加者の氏名は記録しない。
- 面談のキャンセル、および方法を Web 会議以外へ変えた場合は会議室とゲスト URL を無効化する。**日時のみの変更では会議室・ゲスト URL を維持し、有効時間（前後1時間）を新しい日時に合わせる**（2026-11-06 郭指示で面談の変更機能を追加。`PUT /interviews/:id`、商談詳細の面談行「編集」）。

**基盤（自前 Jitsi）**
- Jitsi Meet（docker-jitsi-meet: web／prosody／jicofo／jvb）と TURN（coturn）を**本番 EC2 とは別のインスタンス**で運用する（現本番は 4GB・単一ホストのため同居しない）。**2026-11-05: 暫定として lykuro-prod-data-node（t4g.large、arm64）に同居で構築（郭承認）。coturn は未設置。手順は `JITSI-EC2.md`**。目安: 同時2〜3面談で 2vCPU／4GB、帯域は面談1件あたり上り下り各 3〜5Mbps。
- ドメイン `meet.lykuro.ai`（確定）。TLS は Let's Encrypt。UDP 10000（JVB）と TURN 用ポートを開放する。
- 認証は JWT（`JWT_APP_ID`／`JWT_APP_SECRET`）のみ許可し、匿名入室を禁止する。プラットフォーム側で面談ごとに `room`・`exp`・表示名を含む JWT を発行する。
- 設定: `ENABLE_RECORDING=0`、`ENABLE_LOBBY=0`、`ENABLE_PREJOIN_PAGE=1`、デフォルト言語 ja。
- 監視: JVB の稼働と TURN の到達性を本体の運営監視（§33）に追加する。障害時は面談画面に「外部の会議ツールをご利用ください」と案内する。

**データ・API**: `interviews` に `meetingProvider`（NONE／JITSI）、`meetingRoomId`、`guestTokenHash`、`guestExpiresAt`、`meetingStartedAt`、`meetingEndedAt` を追加（§8.9）。`POST /interviews/:id/meeting`（作成・再発行）、`DELETE /interviews/:id/meeting`、`GET /interviews/:id/meeting/token`（参加 JWT）、公開 `GET /m/:guestToken`（ゲスト参加ページ。トークンは hash 照合）。

**テスト観点**: JWT なし・期限切れ JWT では入室できない。ゲスト URL は有効時間外・再発行後に無効。会議室名に案件名・氏名を含まない。FREE 同士の商談では作成できない。面談キャンセルで会議室が無効化される。監査ログに会話内容・氏名が含まれない。

### 4.9 Slack／Teams Webhook 通知（`webhook_notify`）

**動作仕様**
- Incoming Webhook URL を5件/社まで登録し、通知するイベントを選ぶ: 新着アラート、商談申込み受信、承認、面談設定、メッセージ受信、契約署名依頼。
- 本文は Level 1 の範囲（件名・匿名カード相当・コンソールへのリンク）。氏名・実額単価・メッセージ本文は含めない。
- 失敗時は3回まで再試行（1分・5分・30分）。連続10回失敗で停止し、代表へメール通知する。
- URL は暗号化して保存し、画面では末尾のみ表示する。

**データ・API**: `webhooks`（§8.7）。`GET/POST/PUT/DELETE /webhooks`、`POST /webhooks/:id/test`。

**テスト観点**: 本文に Level 2 情報・メッセージ本文が含まれない。停止後は送信しない。他テナントのイベントが届かない。

### 4.10 ローカルサーバ設置支援・API トークン拡大（`api_extended`）

**動作仕様**
- API トークン（`api_tokens`）の本数上限: FREE 2本/社、PRO 10本/社。既存の FREE 企業で3本以上あるものは削除せず、新規作成のみ制限する。
- ローカルサーバ（lykuro-connector、`local_server_spec_v0_1.md`）の設置支援: オンライン1回。構築・運用責任は従来どおり各社にある。
- 取込 API の件数上限は FREE・PRO とも当面無制限（§7 の将来上限候補に含める）。

**テスト観点**: FREE で3本目の作成は 403 PLAN_LIMIT_EXCEEDED。既存トークンは引き続き使える。

### 4.11 2要素認証と必須化（`mfa_required`）

**動作仕様**
- 2要素認証（TOTP、認証アプリ）は本体にないため、**基本版にも任意利用として提供**する。バックアップコード10個を発行する。
- PRO は「全担当者に必須化」を設定できる。有効化後、未設定のメンバーはログイン時に設定画面へ誘導し、設定完了まで他画面を開けない。
- 代表（OWNER）は必須化の解除ができる。運営はサポート目的で個人の 2要素をリセットできる（監査記録）。

**データ・API**: `user_mfa`（§8.8）、`company_security_settings.mfaRequired`。`POST /auth/mfa/setup`、`POST /auth/mfa/verify`、`DELETE /auth/mfa`、`PUT /companies/me/security`。

**テスト観点**: 必須化後、未設定メンバーは API を呼べない（403 MFA_REQUIRED）。バックアップコードは1回のみ有効。

### 4.12 IP アドレス制限（`ip_restriction`）

**動作仕様**
- 許可する IP／CIDR を20件/社まで登録。登録時に設定者の現在 IP が含まれていなければ保存できない（ロックアウト防止）。
- 許可外からのログイン・API 呼び出しは 403 IP_NOT_ALLOWED。既存セッションも次回要求で拒否する。
- API トークンにも適用する（ローカルサーバの固定 IP を登録する運用）。
- 運営は緊急時に解除できる（監査記録・代表へメール）。

**データ・API**: `company_security_settings.ipAllowList`（Json）。`PUT /companies/me/security`。

**テスト観点**: 許可外 IP からの要求が 403。設定者自身を含まないリストは保存できない。解除が監査ログに残る。

### 4.13 SSO（`sso`）

**動作仕様**
- SAML 2.0 と OIDC（Google Workspace、Microsoft Entra ID を動作確認対象）に対応。
- 既存メンバーのメールアドレスと IdP のメールが一致した場合のみログインできる。JIT プロビジョニング（自動メンバー作成）は行わない。
- SSO 必須化（パスワードログイン禁止）を設定できる。代表は非常用にパスワードログインを維持できる。
- IdP 側で無効化されたユーザーは次回ログインで拒否する（セッションの即時失効は行わない）。

**データ・API**: `company_security_settings.ssoProvider`、`ssoConfig`（Json、暗号化）。`GET /auth/sso/:companySlug/start`、`POST /auth/sso/callback`、`PUT /companies/me/security`。

**テスト観点**: メール不一致は拒否。SSO 必須化後はパスワードログインが拒否される（代表除く）。他社の IdP アサーションでログインできない。

### 4.14 監査ログのエクスポート（`audit_export`）

**動作仕様**
- 期間指定で CSV／JSON を出力する（自社テナント分のみ）。出力自体も監査ログに記録する。
- 月次自動送付: 前月分を毎月1日に代表へメール（添付ではなくダウンロードリンク、7日間有効）。
- 閲覧（画面）は FREE と同じ。保存期間は本体 §26 に従い、プランで変えない。

**データ・API**: 新規テーブルなし。`GET /audit/export?from=&to=&format=csv|json`。

### 4.15 カード決済（`card_billing`）

**動作仕様**
- Stripe のサブスクリプション（月額・年額）を使う。追加担当者は月末の有効メンバー数を使用量として報告する従量課金。3D セキュア対応。
- 請求書払いと併用する。企業ごとに `paymentMethod`（INVOICE／CARD）を持ち、CARD の企業は `plan_invoices` を Stripe の請求書に同期して閲覧できる。
- 決済失敗時: メール通知→14日猶予→FREE へ自動降格。降格はデータを削除しない。
- カード情報はプラットフォームに保存しない（Stripe Checkout／Customer Portal を使う）。

**データ・API**: `companies.paymentMethod`、`stripeCustomerId`、`stripeSubscriptionId`。`POST /billing/checkout`、`GET /billing/portal`、`POST /webhooks/stripe`（受信）。

**テスト観点**: Webhook の署名検証。決済失敗→猶予→降格の状態遷移。CARD と INVOICE の二重請求が起きない。

---

## 5. 機能ゲート設計

- `Company.plan`（FREE／TRIAL／PRO）と `Company.planExpiresAt` で判定する。
- 判定は単一関数 `hasFeature(company, feature)`（`src/server/plan/features.ts`）に集約し、RSC ページ・API（Hono）の両方から使う。画面側の出し分けだけに頼らない。
- 期限切れ（`planExpiresAt < now`）は要求ごとに FREE 扱いとし、降格バッチは持たない。
- API はプラン外機能を `403 PLAN_REQUIRED` で拒否する（§10）。画面は PRO 印と案内カード（料金ページへのリンク）を表示する。
- 機能キー一覧: `company_name_display`, `bulk_ingest`, `saved_search_alert`, `analytics_export`, `priority_support`, `bulk_scout`, `skill_sheet_render`, `web_meeting`, `webhook_notify`, `api_extended`, `mfa_required`, `ip_restriction`, `sso`, `audit_export`, `card_billing`
- TRIAL は PRO と同じ機能キーをすべて満たす。
- FREE 側の数量上限（API トークン本数など）は `src/server/plan/limits.ts` の定数表で持ち、`assertLimit(company, limit, current)` で判定する（§7）。

---

## 6. 請求

### 6.1 請求書払い

- 月初に運営が当月分の PRO 請求書を一括生成する（運営コンソール `/admin` のボタン、または `POST /operations/plan-invoices/generate?month=YYYY-MM`）。
- 対象: 対象月の1日時点で plan=PRO かつ開始月が対象月より前の企業。TRIAL と CARD 決済の企業は対象外。
- 金額: 基本 39,800円 ＋ 追加担当者 4,000円 ×（前月末時点の有効メンバー数 − 5、下限0）。月払いのみ（年払いは 2026-11-05 廃止）。
- 請求書は企業コンソール `/billing` の「プラン・請求」タブで閲覧・印刷でき、代表（OWNER）宛にメール通知する。
- 入金消込は運営コンソールで手動（PAID）。VOID（取消）も運営のみ。
- 既存の成約手数料用 `invoices` とは**別テーブル** `plan_invoices` とし、手数料再開時と混在させない。
- 請求書記載事項: 発行者名・登録番号・発行日・支払期限・摘要（PRO 月額／追加担当者）・税抜額・消費税・税込額・振込先（三菱UFJ銀行 上野中央支店 普通 0720675、登録番号 T3-0111-0104-6589）。

### 6.1.1 PRO 版の申込・解約申請（2026-11-05 郭指示）

- 入口は3つ: ①お問合せ（従来どおり。運営が「企業一覧 > プラン」で変更）②企業登録画面（`/apply/register`）のプラン選択「基本プラン（無料）／PRO 版」③会社マイページ「プラン」（`/company/plan`）の「PRO 版を申し込む」「解約を申請する」
- ②③は `plan_requests`（kind=UPGRADE／CANCEL、status=PENDING／APPROVED／REJECTED／WITHDRAWN、source=REGISTER／CONSOLE）を作るだけで、プランは変わらない。企業は基本版のまま即時開通する
- 運営コンソール「PRO申込」で承認すると PRO 開始（請求書払い・月払い・無期限・開始当月無料、翌月分から月初請求＝§6.1）。解約申請の承認は、承認した月の末日 23:59:59 JST を `planExpiresAt` に設定し、翌月から基本版（返金なし・データ保持）。却下は理由必須
- 受付は規約の適用開始日 2026-12-04（JST）から。それまでは画面に「12月4日から受付」と表示し、API も拒否する
- 申請中の重複は不可。企業は申請中のものを取り下げられる。申込・承認・却下は代表（OWNER）へメール、申込は運営（`OPERATIONS_MAIL`）へも通知
- API: `GET/POST /company/plan-requests`、`POST /company/plan-requests/:id/withdraw`（billing.read／billing.manage）、`GET /operations/plan-requests?status=`、`PUT /operations/plan-requests/:id/approve|reject`（X-Admin-Token）

### 6.2 カード決済

§4.15 のとおり。請求額の算定ルール（基本＋追加席、日割りなし）は請求書払いと同じにする。

---

## 7. 基本版の上限（予約・現時点は無制限）

- 上限は定数表 `src/server/plan/limits.ts` で定義し、FREE の既定値は API トークン本数（2本）を除きすべて「無制限」とする。
- 候補値（有効化時に確定）: 取込 月30件、担当者 3名、公開中案件 20件、営業中人材 20件。
- 有効化の手順: 規約改定 → 適用開始日の1か月前までに告知 → 定数変更。
- 超過時は `403 PLAN_LIMIT_EXCEEDED` で新規登録・公開のみ拒否し、**既存データの削除・非公開化は行わない**。

---

## 8. データモデル追加

### 8.1 `companies` 追加列

| 列 | 型 | 内容 |
|---|---|---|
| plan | enum CompanyPlan（FREE／TRIAL／PRO） | 既定 FREE |
| planStartedAt | DateTime? | PRO／TRIAL 開始日時 |
| planExpiresAt | DateTime? | 期限。null は無期限（PRO 継続中） |
| planSeats | Int | 含まれる担当者数。既定 5 |
| planBillingCycle | enum（MONTHLY／YEARLY） | 既定 MONTHLY。YEARLY は 2026-11-05 廃止（互換のため列挙値のみ残す） |
| paymentMethod | enum（INVOICE／CARD） | 既定 INVOICE |
| stripeCustomerId, stripeSubscriptionId | String? | カード決済（§4.15） |

### 8.2 `saved_searches`

| 列 | 内容 |
|---|---|
| id, tenantCompanyId, memberId | テナント分離必須 |
| kind | PROJECT／ENGINEER |
| name | 表示名 |
| criteria | JSON（検索画面の条件と同形式） |
| notify | IMMEDIATE／DAILY／OFF |
| lastEvaluatedAt | 評価カーソル |
| createdAt, updatedAt | |

### 8.3 `plan_invoices`

| 列 | 内容 |
|---|---|
| id, companyId, month | `@@unique([companyId, month])` |
| invoiceNumber | 連番（例: P-202611-0001） |
| plan, seats, extraSeats | 請求時点のスナップショット |
| amountExTaxYen, taxYen, totalYen | 円整数 |
| status | ISSUED／PAID／VOID |
| issuedAt, dueAt, paidAt | |
| stripeInvoiceId | String?（CARD の場合） |

### 8.4 `ingestion_jobs` 追加列

| 列 | 内容 |
|---|---|
| batchId | String?（一括取込のまとまり） |

### 8.5 `scout_batches`・`entries` 追加列・`entry_messages` 追加列

| テーブル | 列 | 内容 |
|---|---|---|
| scout_batches | id, tenantCompanyId, projectId, memberId, templateBody, requestedCount, createdCount, skippedCount, createdAt | 一斉スカウトの単位 |
| entries | scoutBatchId | String? |
| entry_messages | readAt | DateTime?（相手がメッセージ画面を開いた時刻） |

### 8.6 `skill_sheet_templates`

| 列 | 内容 |
|---|---|
| id, tenantCompanyId, name | 3件/社まで |
| layout | JSON（項目配置・表示項目） |
| logoPath | String?（`storage/` 配下） |
| createdAt, updatedAt | |

### 8.7 `webhooks`

| 列 | 内容 |
|---|---|
| id, tenantCompanyId, name | 5件/社まで |
| urlEncrypted | 暗号化した URL |
| provider | SLACK／TEAMS／GENERIC |
| events | JSON（購読イベントの配列） |
| status | ACTIVE／SUSPENDED |
| failCount, lastDeliveredAt, lastErrorAt | 再試行・停止判定 |

### 8.8 `user_mfa`・`company_security_settings`

| テーブル | 列 | 内容 |
|---|---|---|
| user_mfa | userAccountId（一意）, secretEncrypted, enabledAt, backupCodesHash（JSON）, lastUsedAt | TOTP |
| company_security_settings | companyId（一意）, mfaRequired, ipAllowList（JSON）, ssoProvider（NONE／SAML／OIDC）, ssoConfigEncrypted, ssoRequired, updatedBy, updatedAt | 企業ごとのセキュリティ設定 |

### 8.9 `interviews` 追加列

| 列 | 内容 |
|---|---|
| meetingProvider | NONE／JITSI |
| meetingRoomId | ランダム識別子（案件名・氏名を含めない） |
| guestTokenHash, guestExpiresAt | 人材本人のゲスト URL（SHA-256 で照合、面談前後1時間） |
| meetingStartedAt, meetingEndedAt | 監査用（会話内容は保存しない） |

### 8.10 監査

プラン変更・請求書発行・入金消込・セキュリティ設定変更・2要素リセット・エクスポート・スキルシート生成・一斉スカウト・Web 会議の作成／開始／終了は `audit_events` に記録する。人材本人の氏名などの個人情報は監査ログに書かない。

---

## 9. API 追加（`/api/v1`）

| メソッド・パス | 内容 | 機能キー／権限 |
|---|---|---|
| GET /companies/me/plan | 自社プラン・期限・席数 | 全ロール |
| PUT /companies/me/security | 2要素必須化・IP 制限・SSO 設定 | mfa_required／ip_restriction／sso、OWNER |
| GET /plan-invoices, GET /plan-invoices/:id/document | 自社の PRO 請求書 | OWNER／ADMIN |
| POST /billing/checkout, GET /billing/portal | カード決済 | card_billing、OWNER |
| GET/POST/PUT/DELETE /saved-searches | 保存検索 | saved_search_alert |
| POST /ingestions/bulk | 複数ファイル取込（multipart、最大20） | bulk_ingest、ingestion.create |
| GET /analytics/funnel, /analytics/market-rates, /analytics/export | 分析・CSV | analytics_export |
| POST /scouts/bulk, POST /scouts/draft, GET /scouts/batches/:id | 一斉スカウト・AI 下書き | bulk_scout |
| GET/POST/PUT/DELETE /skill-sheet-templates, POST /engineers/:id/skill-sheet | スキルシート再生成 | skill_sheet_render |
| PUT /interviews/:id | 面談の変更（日時・方法・メモ。予定中のみ、両社の当事者。Web 会議への変更時は会議室も作成） | interview.manage |
| POST/DELETE /interviews/:id/meeting, GET /interviews/:id/meeting/token | Web 会議の作成・無効化・参加 JWT | web_meeting |
| GET /m/:guestToken | 人材本人のゲスト参加ページ（公開、hash 照合） | 認証なし |
| GET/POST/PUT/DELETE /webhooks, POST /webhooks/:id/test | Webhook | webhook_notify |
| POST /auth/mfa/setup, /auth/mfa/verify, DELETE /auth/mfa | 2要素認証（基本版にも提供） | 全ロール |
| GET /auth/sso/:slug/start, GET|POST /auth/sso/callback, GET /auth/sso/metadata | SSO（開始・OIDC/SAML コールバック・SP メタデータ） | 認証なし |
| PUT /company/security/ip, PUT /company/security/sso | IP 制限・SSO 設定（`/company/security` の GET に状態を含める） | ip_restriction／sso、company.manage |
| GET /audit/export?from=&to=&format= ／ ?month=&token= | 監査ログ出力（期間指定・月次リンク） | audit_export、audit.read |
| POST /webhooks/stripe | Stripe からの受信（署名検証必須） | 認証なし・署名検証 |
| GET /billing/card, POST /billing/checkout, GET /billing/portal | カード決済の状態・Checkout 開始・Customer Portal | billing.read／billing.manage |
| PUT /operations/companies/:id/plan | プラン変更（運営） | X-Admin-Token |
| POST /operations/plan-invoices/generate?month=, PUT /operations/plan-invoices/:id/paid, /void | 請求書生成・消込・取消（運営） | X-Admin-Token |
| POST /operations/members/:id/mfa-reset, PUT /operations/companies/:id/security/unlock | 2要素リセット・IP 制限の緊急解除（運営） | X-Admin-Token |

内部処理: 新着アラート評価（15分、`POST /internal/jobs/alerts`）と月次処理（1時間ごとに `POST /internal/jobs/periodic`。毎月1日の監査ログ送付、月末のカード決済の追加担当者報告）は `instrumentation.ts` の `register()` → `scheduler.ts` のプロセス内タイマーから内部 API を呼ぶ。Webhook 再試行は配信時のプロセス内タイマー。

---

## 10. エラーコード追加（本体 §29）

| コード | HTTP | 内容 |
|---|---|---|
| PLAN_REQUIRED | 403 | PRO 限定機能を FREE／期限切れプランで呼び出した |
| PLAN_LIMIT_EXCEEDED | 403 | プランの数量上限超過（API トークン本数、§7 の将来上限） |
| MFA_REQUIRED | 403 | 2要素必須化後に未設定のメンバーが要求した |
| IP_NOT_ALLOWED | 403 | IP 制限の許可外からの要求 |
| SCOUT_DAILY_LIMIT | 429 | 一斉スカウトの1日上限超過 |
| MEETING_NOT_AVAILABLE | 403 | Web 会議の有効時間外、無効化済み、または Jitsi 基盤の停止中 |
| WEBHOOK_SIGNATURE_INVALID | 400 | Stripe からの受信 Webhook の署名検証失敗 |
| SSO_REQUIRED | 403 | SSO 必須化企業の代表以外がパスワードでログインした（応答に `ssoSlug` を含め、画面は IdP へ誘導） |
| CARD_NOT_AVAILABLE | 403 | Stripe 未設定でカード決済を呼び出した |

---

## 11. 画面

| 画面 | 内容 |
|---|---|
| 公開 `/pricing` | 料金表（§3 の比較）、申込方法。LP の料金セクションからリンク |
| コンソール `/billing`「プラン・請求」タブ | 現在のプラン・期限・席数、PRO 請求書の一覧・印刷、カード決済の管理（Stripe ポータルへ） |
| コンソール 取込 | 複数ファイル選択（PRO）、一括の進捗表示。FREE は1ファイルのみで PRO 案内を表示 |
| コンソール 案件・人材検索 | 「この条件を保存」ボタン、保存検索一覧と通知設定（PRO） |
| コンソール 他社案件・人材の一覧／詳細／マッチ候補／商談 | PRO は「他社」バッジを掲載企業名に置き換えて表示（§4.1） |
| コンソール 人材検索結果 | 複数選択→一斉スカウト（テンプレ編集・AI 下書き・送信前確認） |
| コンソール 商談詳細 | 既読表示（PRO）、一斉スカウトの反応率（バッチ画面）、面談欄の Web 会議「参加」「本人用 URL 発行」（PRO） |
| 公開 `/m/:token` | 人材本人のゲスト参加ページ（ログイン不要。表示名入力→iframe で会議に参加） |
| コンソール 人材詳細 | 「スキルシート出力」（テンプレ・匿名／実名・PDF／Excel） |
| コンソール `/analytics` | 商談ファネル、反応状況、市場単価レンジ、CSV 出力（PRO）。通報画面 `/reports` とは別ルート |
| 会社マイページ「セキュリティ」 | 2要素認証（本人設定）、必須化、IP 制限、SSO 設定（PRO） |
| 会社マイページ「連携」 | Webhook、スキルシートテンプレート、API トークン |
| 会社マイページ「監査」 | 期間指定エクスポート、月次自動送付の設定（PRO） |
| 運営 `/admin` | 企業ごとのプラン変更（TRIAL 付与・PRO 開始・期限・席数・決済方法）、月次請求生成、入金消込、PRO 問合せの優先表示、2要素リセット、IP 制限の緊急解除 |

スマホ対応は本体のモバイルルールに従う（分析・請求・セキュリティ設定は PC 優先。モバイル導線には出さない）。

---

## 12. 法務・表示

- 利用規約第7条・基本契約第4条「利用料金（無料）」を「基本版は無料。PRO版は本書の月額利用料」に改定し、適用開始日の1か月前までに告知する。
- 規約・プライバシーポリシー・企業登録のルール（`/apply/rules`）に「PRO 利用企業には掲載企業名（案件保有企業・人材所属企業）が表示される」旨を明記し、既存の全企業へ適用開始日の1か月前までに告知する（§4.1）。
- 特定商取引法に基づく表記（事業者名・価格・支払方法・支払時期・解約条件）を公開ページに追加する。カード決済の追加時に支払方法の記載を更新する。
- 適格請求書発行事業者の登録番号を環境変数（例 `INVOICE_REGISTRATION_NUMBER`）で設定し請求書に記載する。
- Web 会議は自前運用の Jitsi で行い、会話内容・映像・チャットを保存しない旨をプライバシーポリシーに明記する。人材本人向けのゲスト参加ページに同趣旨の案内を表示する。
- SSO・Webhook・カード決済など外部事業者へのデータ送信は、送信範囲（Level 1 のみ、または請求に必要な企業情報）を規約に明記する。
- LP・申込画面の「すべて0円」系の文言は「基本版は0円」に統一する（主要箇所は統一済み）。

---

## 13. 必須テスト追加（本体 §34）

- プラン判定: 期限切れの TRIAL／PRO は FREE として扱う。TRIAL は PRO と同じ機能キーを満たす
- API ゲート: FREE で各 PRO 機能を呼ぶと 403 PLAN_REQUIRED（機能キーごとに1件）
- 企業名の明示: FREE には掲載企業名が返らない。PRO には返るが Level 2 情報は双方承認前に返らない。PRO 企業の名前は相手の FREE 企業に返らない
- 一括取込: 各ファイルが自テナントのジョブになる。21ファイル以上は拒否。人材分割の各件が独立して確定できる
- アラート: 同一新着を二重通知しない。他テナントの非公開データ・Level 2 情報を含めない
- 分析: 母数5件未満のセルを出さない。CSV に他テナント・未開示情報が含まれない
- 一斉スカウト: 重複応募ブロックに従いスキップされる。1日上限。連絡先を含む本文は拒否。AI 下書きに Level 2 情報を渡さない
- スキルシート: 他社人材の実名版は未承認なら 403。匿名版に氏名・実額が含まれない
- Web 会議: JWT なし・期限切れでは入室不可。ゲスト URL は時間外・再発行後に無効。会議室名に案件名・氏名を含まない。FREE 同士では作成不可。監査ログに会話内容・氏名を含まない
- Webhook: 本文に Level 2 情報が含まれない。連続失敗で停止する。他テナントのイベントが届かない
- 2要素・IP・SSO: 必須化後の未設定は 403 MFA_REQUIRED。許可外 IP は 403。設定者を含まない IP リストは保存不可。メール不一致の SSO は拒否
- カード決済: 受信 Webhook の署名検証失敗を無視する。決済失敗→猶予→降格の遷移。二重請求が起きない
- 請求: 企業×月の一意性、日割りなし（開始当月は対象外）、追加席の算定、税計算
- 上限（§7）: 定数を有効化したとき超過で拒否し、既存データは影響を受けない
- 監査: プラン変更・請求・セキュリティ設定・エクスポート・スキルシート生成が記録され、個人情報を含まない

---

## 14. リリース計画

| 順 | 機能 | 主な変更箇所 | 目安 |
|---|---|---|---|
| A-1 | プラン土台（スキーマ、ゲート関数、運営のプラン変更、料金ページ）＋ 相手企業名の明示 | `prisma/schema.prisma`、新規 `src/server/plan/`、`partners.ts`・serializer、`/admin`、`/pricing`、LP | 3日 |
| A-2 | 一括取込・人材の複数件分割 | `IngestUpload.tsx`、`pipeline/split.ts`、`ingest.ts` | 3日 |
| A-3 | 保存検索＋新着アラート | 新規 `services/saved-searches.ts`、`instrumentation.ts`、`mail.ts` | 3日 |
| A-4 | 分析・エクスポート | 新規 `services/analytics.ts`、`/analytics` | 3日 |
| A-5 | PRO 請求（請求書払い）・優先サポート | `plan_invoices`、`billing.ts`、`/billing`、`/admin`、`inquiries` | 3日 |
| A-6 | 規約・特商法・LP・§34 テスト | `(legal)`、`login`、`tests/` | 2日 |
| | **段階A 小計** | | **約3.5週間** |
| B-1 | 一斉スカウト・AI 下書き・既読と反応率 | `scout_batches`、`entries.ts`、`EntryCreate.tsx`、LLM プロンプト | 4日 |
| B-2 | スキルシート再生成（PDF／Excel、テンプレート） | 新規 `services/skill-sheet.ts`、テンプレート画面 | 4日 |
| B-3 | Slack／Teams Webhook | `webhooks`、配信・再試行 | 2日 |
| B-4 | 2要素認証（基本版）＋ PRO 必須化 | `user_mfa`、`src/server/auth/`、ログイン画面 | 3日 |
| B-5 | API トークン上限・ローカルサーバ支援 | `limits.ts`、`ApiTokenAdmin.tsx` | 1日 |
| B-6 | Web 会議（Jitsi 基盤の構築・JWT 認証・面談画面の組込み・ゲスト参加ページ・監視） | 別インスタンス（docker-jitsi-meet、coturn）、`interviews`、`InterviewForm.tsx`、`/m/[token]` | 10日 |
| | **段階B 小計** | | **約5週間** |
| C-1 | IP 制限 | `company_security_settings`、認証ミドルウェア | 1日 |
| C-2 | SSO（SAML／OIDC） | `src/server/auth/sso/`、設定画面 | 4日 |
| C-3 | 監査ログのエクスポート・月次送付 | `audit.ts`、会社マイページ | 2日 |
| C-4 | カード決済（Stripe） | `billing.ts`、Checkout／Portal、受信 Webhook | 5日 |
| | **段階C 小計** | | **約2.5週間** |
| | **合計** | | **約11週間（単独作業・検証込み）** |

着手順は A → B → C。各段階の本番反映は `scripts/release-ec2.sh`。規約改定を伴う段階A の反映は告知の1か月後。

---

## 14.1 段階A の実装メモ（2026-11-04）

仕様からの差異・補足は次のとおり。

- 新着アラートの評価は `instrumentation.ts` から業務コードを直接 import せず、プロセス内タイマー（`src/server/plan/scheduler.ts`）が内部 API `POST /api/v1/internal/jobs/alerts` を自プロセスへ呼ぶ方式にした（Next.js が instrumentation を Edge 向けにもコンパイルするため、Prisma・OCR 等を含む import 連鎖は失敗する）。内部 API はプロセス内生成トークンまたは運営トークンで保護し、外部 cron からも呼べる
- 新着判定は `updatedAt` を基準にし、通知済み対象を `saved_search_hits` に記録して二重通知を防ぐ（公開日時の列は持たないため）。初回評価の基準は保存検索の作成時刻
- 人材書類の複数件分割は LLM が「人数と各人の開始行」を返し、分割自体はローカルで行う（原文の欠落・改変を防ぐ）。一括取込以外の通常の人材取込でも PRO なら適用する
- 自社プランの参照 API は `GET /company/plan`（既存の `/company/*` 系に合わせた）
- PRO 請求の追加担当者数は、前月末時点の人数の履歴を持たないため、請求書発行時点の有効担当者数で算定する（請求書・規約にその旨を記載）
- 年払いは更新月（開始翌月から12か月ごと）に基本料金を請求し、それ以外の月は追加担当者分のみ請求する
- 分析の「反応状況」の平均日数は、申込から双方承認完了（両者の承認日時の遅い方）までの日数
- CSV の人材氏名・実額は engineer.read.pii 権限保持者にのみ出力（serializer の開示制御をそのまま利用）
- 規約第7条・基本契約第4条・プライバシーポリシー・企業登録のルール・特商法表記（`/tokushoho`）を改定済み。**適用開始日は 2026-12-04 で確定（2026-11-04 郭決定）**。ホーム画面の「お知らせ」欄（`RevisionNotice`、`src/lib/revision-notice.ts` で 2026-11-04〜12-03 の JST 日付判定）で全企業に周知する（2026-11-05 郭指示で全画面上部のバナーからホームのみへ変更）

## 14.2 段階B の実装メモ（2026-11-04）

- 一斉スカウトの本文は各商談の最初のメッセージとして保存する（受信通知は商談申込みの通知で兼ね、メッセージ通知は重ねない）。AI 下書きは変数（{案件名} 等）を残した本文を返し、送信前の人手確認を画面で必須にしている
- 既読はプランを問わず記録し、表示（既読／未読）は PRO 側にのみ出す
- スキルシートの PDF は請求書と同じ「印刷用 HTML ページからブラウザで PDF 保存」方式（サーバー側 PDF 生成に必要な日本語フォントの同梱を避けた）。Excel は xlsx ライブラリで生成。自社ロゴの埋め込みは未対応（見出し・自社名表示・注記・表示項目のみ）
- Webhook の URL は AES-256-GCM で暗号化保存（`DATA_ENCRYPTION_KEY`、未設定時は `SESSION_SECRET` から派生）。内部ネットワーク宛 URL と http は登録不可
- 2要素認証（TOTP）は外部ライブラリを使わず RFC 6238 を実装（テストベクタで検証）。QR は `qrcode` で生成。企業の必須化は PRO かつ設定者本人が有効化済みのときのみ ON にできる。API トークン認証は2要素の対象外
- Web 会議は Jitsi の JWT 認証（HS256）を前提に、参加 JWT・ゲスト URL（SHA-256 保存、面談前後1時間）・会議室名の生成を実装した。**Jitsi 本体（別インスタンス、coturn、`meet.lykuro.ai`）は未構築**で、環境変数未設定の間は画面に出ない。面談のキャンセル機能が本体に無いため、無効化は手動（商談詳細の「無効化」）
- API トークン上限は有効（未失効・未期限切れ）トークン数で判定し、既存の超過分は削除しない

## 14.3 段階C の実装メモ（2026-11-04）

- **IP 制限**: 接続元 IP は `X-Forwarded-For` の右端から環境変数 `TRUSTED_PROXY_HOPS`（既定 1。本番の ALB + nginx は 2）だけ遡った位置で決める（左側の偽装を無視）。ヘッダが無ければ直接接続（開発）とみなす。判定は API 認証ミドルウェア（セッション・API トークン）、ログイン（パスワード・2要素第2段階・SSO）、RSC の `getAuth()`（許可外は `/login?error=ip` へ）で行い、ログアウトだけは許可外からも可。PRO でなくなれば制限は効かない（`AuthContext.ipAllowList` は実効プランで空にする）。運営の緊急解除は `PUT /operations/companies/:id/security/unlock`（監査・代表へメール）
- **SSO**: OIDC は Authorization Code + PKCE を自前実装（Discovery → 認可 → トークン交換 → JWKS で ID トークン署名・iss・aud・exp・nonce を検証）。SAML は `@node-saml/node-saml` でアサーション署名を検証（`wantAssertionsSigned`、InResponseTo は照合せず RelayState を署名付き Cookie の state と突き合わせる）。往復状態（企業・state・nonce・PKCE）は HMAC 署名付き Cookie `sesmatch_sso`（10分）に保持し、サーバ側テーブルは持たない。企業識別子 `ssoSlug` は `company_security_settings` に追加（§8.8）。SP 側の値は固定: Entity ID `…/api/v1/auth/sso/metadata`、ACS／リダイレクト URI `…/api/v1/auth/sso/callback`。SSO ログインでは認証アプリのコード入力を求めない（IdP に委ねる）が、企業の2要素必須化ゲートは従来どおり効く。**Google Workspace・Entra ID との実接続は未検証**（模擬 IdP での自動テストのみ）
- **監査ログ出力**: 期間は1年以内・最大 50,000 件。月次送付のリンクは署名付きトークン（7日間有効）付きの `/audit?month=&token=` で、ダウンロードにはログイン（audit.read）も必要。送付済みは監査ログ（`AuditMonthlyExportSent`）で判定
- **カード決済**: Stripe Checkout（サブスクリプション）で、請求周期は `billing_cycle_anchor` を翌月1日 0:00 JST に固定し `proration_behavior: none`（開始当月無料・日割りなし）。追加担当者は月末（JST 最終日 12 時以降）に有効担当者数を数え、超過分 × 4,000円を保留中の請求項目として送る。月払いは翌月1日の更新請求書に合算され、年払いの非更新月は単独の請求書を起こす（Billing Meter は使わない）。消費税は `STRIPE_TAX_RATE_ID`（任意）で付与。`invoice.paid` で `plan_invoices` に同期（`stripeInvoiceId`・`stripeHostedUrl` 列を追加）。決済失敗は `planExpiresAt` を失敗日 +14 日に設定する方式（既存の期限切れ判定で自動的に基本版扱いになり、降格バッチを持たない）。解約は `customer.subscription.deleted` で FREE。カード決済の Checkout は基本版の企業が自分で開始でき（`card_billing` の機能ゲートは PRO 判定に使わない）、請求書払いで契約中の企業は二重請求防止のため Checkout 不可。運営のプラン変更は Stripe 契約中の企業では席数・期限のみ可。**Stripe の実環境（Price・Tax Rate・Webhook エンドポイントの登録）は未設定**で、環境変数が揃うまで画面に出ない
- 今後の案: SSO の実 IdP 検証、Stripe のテストモードでの通し確認（Checkout → Webhook → 請求書同期）、年払いカードの途中解約時の扱い（§15-3）

## 14.4 本番反映の準備メモ（2026-11-04）

- 方針（郭決定）: 段階A〜C の機能は先に本番へ反映し、規約の適用開始日 2026-12-04 までは企業に PRO プランを付与しない。告知はホーム画面の「お知らせ」欄（§12）で行う
- 手順と確認項目は `RELEASE-EC2.md` §2-1。本番 DB への追加マイグレーションは 10 件（追加のみ）で、本番スキーマの複製に対する `prisma migrate deploy` と Docker ビルドを手元で確認済み
- 本番の環境変数に `DATA_ENCRYPTION_KEY`・`TRUSTED_PROXY_HOPS=2` を追加（`docker-compose.ec2.yml` にも PRO 版の変数の受け渡しを追加）。`JITSI_*`・`STRIPE_*` は基盤準備後

---

## 15. 未決定事項

1. 消費税の端数処理・支払期限の最終確認（本体 §36-5 と合わせて確定）
2. ~~振込先口座・発行者情報の記載内容~~ → 2026-11-05 郭確定: 成約手数料の請求書と同じ（三菱UFJ銀行 上野中央支店 普通 0720675、登録番号 T3-0111-0104-6589）。カード決済（Stripe）は初期版では提供せず請求書払いのみ（郭決定）
3. ~~年払いの途中解約時の返金有無~~ → 年払い自体を廃止（2026-11-05 郭決定）
4. ~~PRO 申込の受付方法~~ → 2026-11-05 郭決定: お問合せ・企業登録画面のプラン選択・会社マイページ「プラン」の3経路（§6.1.1）。有効化は申込時ではなく運営の承認時。後払い（開始当月無料＋月初請求）
5. SSO の動作確認対象 IdP（Google Workspace、Microsoft Entra ID 以外を含めるか）
6. スキルシートの既定テンプレート2種のレイアウト
7. 一斉スカウトの上限値（20名/回、50件/日）の妥当性
8. 段階B・C 内の優先順位
9. Web 会議の録画・文字起こし・LLM 要約を将来提供するか（初版は録画なし・文字起こしなしで確定。提供する場合は人材本人の同意と保存期限の設計が必要）
10. Jitsi 用インスタンスの構成（インスタンス種別、リージョン、月額費用）とドメイン名（案: meet.lykuro.ai）
11. Stripe アカウント（事業者情報・Price・Tax Rate・Webhook）の準備時期と、カード決済の年払いの途中解約時の返金有無
12. SSO の動作確認に使う IdP テナント（Google Workspace／Entra ID）の用意

---

## 16. 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-11-04 | v1.0 初版。課金モデル（月額固定）、価格（39,800円・5名込み・追加4,000円）、請求書払い、日割りなし、基本版上限の予約を郭決定として確定。機能比較一覧（完全版）を追加。相手企業名の明示（PRO）を追加（郭指示。掲載側オプトアウトなし・片方向で確定） |
| 2026-11-04 | v1.1 段階A 中心の構成を改め、PRO 全機能（16機能）を §4 で同じ深さで仕様化。§8 データモデル・§9 API・§10 エラー・§11 画面・§13 テスト・§14 リリース計画を全機能分に拡張。2要素認証（TOTP）は基本版にも任意提供とし、必須化のみ PRO とした |
| 2026-11-04 | v1.2 契約事務（注文書・注文請書 PDF、月次確認の一括処理、外部契約台帳）と電子署名連携を対象外とした（郭指示）。機能数は14。関連するデータモデル・API・画面・テスト・リリース計画を削除し、合計目安を約9週間に更新 |
| 2026-11-05 | v1.9 年払い（398,000円）と割引を廃止し月払いのみに（郭決定）。カード決済は初期版では提供しない。PRO 版の申込・解約申請（§6.1.1: 企業登録画面のプラン選択・会社マイページ「プラン」・運営コンソール「PRO申込」、受付開始 2026-12-04）を実装。振込先・登録番号を確定（§15-2） |
| 2026-11-05 | v1.8 規約改定の告知を全画面上部のバナーからホーム画面の「お知らせ」欄のみに変更（郭指示。表示期間の日付判定は変更なし） |
| 2026-11-04 | v1.7 本番反映の準備: 規約の適用開始日 2026-12-04 を確定（§12・§14.1）、機能先行反映・PRO 付与は 12-04 以降の方針と手順（§14.4、`RELEASE-EC2.md` §2-1）、告知バナーを追加 |
| 2026-11-04 | v1.6 段階C（C-1〜C-4）を実装。§14.3 に実装メモ（IP 判定の信頼段数、SSO の自前 OIDC と node-saml、監査ログの月次リンク、Stripe の請求周期固定・追加担当者の請求項目方式・決済失敗の猶予方式）を追記。§9・§10 に実装した API・エラーコード（SSO_REQUIRED、CARD_NOT_AVAILABLE）を反映 |
| 2026-11-04 | v1.5 段階B（B-1〜B-6）を実装。§14.2 に実装メモ（スカウト本文の扱い、スキルシート PDF の方式、Webhook 暗号化、TOTP 自前実装、Jitsi 本体は未構築）を追記 |
| 2026-11-04 | v1.4 段階A（A-1〜A-6）を実装。§14.1 に実装メモ（アラート評価の内部 API 方式、人材分割の方式、請求の担当者数算定など）を追記 |
| 2026-11-04 | v1.3 Web 会議を PRO 機能として追加（§4.8、郭指示）: 基本版には提供せず、PRO 版はコンソール組込みの自前 Jitsi（別インスタンス、JWT 認証）。人材本人はログイン不要のゲスト URL で参加。初版は録画・文字起こしなし。機能数は15、合計目安を約11週間に更新 |
