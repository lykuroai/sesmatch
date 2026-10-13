// 案件一覧のイメージ画像: 案件の内容（業種・案件名・概要・スキル）から
// 表示するイメージ種別を判定する純粋関数（テスト対象）。
// 業種系（金融・通信・製造…）を優先し、業種が読み取れないときは技術領域
// （Webフロント・クラウド・データ/AI…）で判定、どれにも当たらなければ汎用の業務システム。
// 判定は一覧の見た目のためだけに使い、検索・マッチング・採否には一切用いない。

export const PROJECT_IMAGE_KINDS = [
  "finance",
  "telecom",
  "manufacturing",
  "logistics",
  "retail",
  "public",
  "healthcare",
  "education",
  "energy",
  "construction",
  "media",
  "hr",
  "web",
  "mobile",
  "cloud",
  "data",
  "embedded",
  "security",
  "business",
] as const;
export type ProjectImageKind = (typeof PROJECT_IMAGE_KINDS)[number];

export const PROJECT_IMAGE_LABELS: Record<ProjectImageKind, string> = {
  finance: "金融",
  telecom: "通信",
  manufacturing: "製造",
  logistics: "物流",
  retail: "小売・EC",
  public: "公共",
  healthcare: "医療",
  education: "教育",
  energy: "エネルギー",
  construction: "建設・不動産",
  media: "メディア・ゲーム",
  hr: "人材・サービス",
  web: "Web",
  mobile: "モバイル",
  cloud: "クラウド・インフラ",
  data: "データ・AI",
  embedded: "組込・IoT",
  security: "セキュリティ",
  business: "業務システム",
};

// 業種系の判定語（上から順に評価。先に当たったものを採用）
const INDUSTRY_RULES: [ProjectImageKind, RegExp][] = [
  [
    "finance",
    /金融|銀行|証券|保険|損保|生保|信販|カード|決済|勘定系|fintech|フィンテック|リース|信用金庫|投資|資産運用|暗号資産/i,
  ],
  [
    "telecom",
    /通信|キャリア|携帯|モバイル事業者|ネットワーク事業者|isp|telecom|5g|回線/i,
  ],
  [
    "manufacturing",
    /製造|工場|生産管理|自動車|メーカー|電機|機械|部品|半導体|化学|素材|食品|plm|mes\b/i,
  ],
  [
    "logistics",
    /物流|配送|倉庫|運輸|運送|輸送|鉄道|航空|海運|wms|tms\b|サプライチェーン|scm/i,
  ],
  [
    "retail",
    /小売|ec\b|eコマース|通販|百貨店|スーパー|コンビニ|店舗|pos\b|ポイント|アパレル|飲食|外食/i,
  ],
  [
    "public",
    /官公庁|自治体|公共|行政|省庁|市役所|県庁|政府|公的|独立行政法人|マイナンバー|防衛|警察/i,
  ],
  [
    "healthcare",
    /医療|病院|医薬|製薬|ヘルスケア|介護|電子カルテ|レセプト|クリニック|診療|健康|創薬|医療機器/i,
  ],
  ["education", /教育|学校|大学|eラーニング|e-learning|学習|塾|教材|lms\b/i],
  [
    "energy",
    /電力|ガス|エネルギー|水道|発電|再生可能|スマートメーター|石油|インフラ事業/i,
  ],
  [
    "construction",
    /建設|建築|不動産|ゼネコン|住宅|マンション|bim\b|cad\b|土木|設備/i,
  ],
  [
    "media",
    /メディア|放送|テレビ|出版|広告|ゲーム|エンタメ|動画|音楽|配信|アニメ|スポーツ|出版社/i,
  ],
  [
    "hr",
    /人材|求人|採用|hr\b|勤怠|給与|労務|人事|サービス業|旅行|ホテル|観光/i,
  ],
];

// 技術領域の判定語（業種が読み取れない場合）
const TECH_RULES: [ProjectImageKind, RegExp][] = [
  [
    "security",
    /セキュリティ|security|soc\b|脆弱性|siem|waf\b|ゼロトラスト|認証基盤/i,
  ],
  [
    "data",
    /データ分析|データ基盤|機械学習|\bai\b|生成ai|llm|\bbi\b|dwh|etl|snowflake|bigquery|databricks|python.*(分析|学習)|深層学習|rag\b|データサイエン/i,
  ],
  [
    "embedded",
    /組込|組み込み|iot|ファーム|firmware|制御|車載|マイコン|rtos|デバイス|センサ/i,
  ],
  [
    "mobile",
    /ios|android|swift|kotlin|flutter|react native|スマホアプリ|モバイルアプリ|アプリ開発/i,
  ],
  [
    "cloud",
    /aws|azure|gcp|クラウド|インフラ|kubernetes|k8s|docker|terraform|sre\b|ネットワーク構築|サーバ構築|運用保守|監視/i,
  ],
  [
    "web",
    /フロントエンド|webフロント|web\s*フロント|react|vue|angular|next\.js|nuxt|typescript|javascript|ui\/ux|web開発|webアプリ|webサイト|lp\b/i,
  ],
];

export type ProjectImageInput = {
  industry?: string | null;
  name: string;
  summary?: string | null;
  skills?: string[];
};

export function classifyProjectImage(p: ProjectImageInput): ProjectImageKind {
  const industry = (p.industry ?? "").trim();
  const text = [p.name, p.summary ?? ""].join("\n");
  const skills = (p.skills ?? []).join("\n");

  // 1) 業種欄 → 2) 案件名・概要 の順に業種系で判定
  for (const source of [industry, text]) {
    if (!source) continue;
    for (const [kind, re] of INDUSTRY_RULES) if (re.test(source)) return kind;
  }
  // 3) スキル・案件名・概要から技術領域で判定
  const techText = [text, skills].join("\n");
  for (const [kind, re] of TECH_RULES) if (re.test(techText)) return kind;
  return "business";
}
