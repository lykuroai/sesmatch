// 案件・人材一覧のイメージ画像: 案件の内容（業種・案件名・概要・スキル）や
// 人材のスキル・経験から表示するイメージ種別を判定する純粋関数（テスト対象）。
// 業種系（金融・通信・製造…）を優先し、業種が読み取れないときは技術領域
// （Webフロント・クラウド・データ/AI…）で判定、どれにも当たらなければ汎用の業務システム。
// 判定は一覧の見た目のためだけに使い、検索・マッチング・採否には一切用いない。
// 人材は性別・顔写真・国籍などの属性を一切使わず、技術領域（スキル・役割・概要）と業種経験のみで判定する。

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

// 技術領域の判定語。先頭ほど専門性が高く、同点のときは先頭側を優先する（汎用の business は最後）
const TECH_RULES: [ProjectImageKind, RegExp][] = [
  ["security", /セキュリティ|security|\bsoc\b|脆弱性|siem|\bwaf\b|ゼロトラスト|認証基盤/i],
  [
    "data",
    /データ分析|データ基盤|データ連携|機械学習|\bai\b|生成ai|llm|\bbi\b|dwh|etl|snowflake|bigquery|databricks|深層学習|\brag\b|データサイエン|spark|hadoop|tableau|power ?bi/i,
  ],
  ["embedded", /組込|組み込み|iot|ファーム|firmware|制御|車載|マイコン|rtos|デバイス|センサ|\bc\b|c\+\+|verilog/i],
  ["mobile", /\bios\b|android|swift|kotlin|flutter|react native|スマホアプリ|モバイルアプリ|アプリ開発|xcode/i],
  [
    "cloud",
    /aws|azure|gcp|google cloud|amazon web|クラウド|インフラ|kubernetes|k8s|docker|terraform|ansible|\bsre\b|ネットワーク構築|サーバ構築|運用保守|監視|linux|vmware|cisco|ccna|ccnp/i,
  ],
  [
    "web",
    /フロントエンド|webフロント|web\s*フロント|react|vue|angular|next\.js|nuxt|typescript|javascript|ui\/ux|web開発|webアプリ|webサイト|webシステム|\blp\b|\bphp\b|laravel|wordpress|html|css|ruby|rails|django|node\.?js|express|jquery|svelte/i,
  ],
  [
    "business",
    /\bjava\b|spring|c#|\.net|\bvb\b|visual basic|cobol|pl\/sql|oracle|\bsap\b|salesforce|\berp\b|基幹|業務システム|勘定|会計|販売管理|在庫管理|人事給与|\bpmo?\b|\bpl\b|要件定義|sharepoint|access/i,
  ],
];

type Weighted = { text: string; weight: number };

// 重み付きの語ごとに各技術領域の一致を集計し、最多の領域を返す（一致なしは null）
function scoreTech(terms: Weighted[]): ProjectImageKind | null {
  const score = new Map<ProjectImageKind, number>();
  for (const t of terms) {
    if (!t.text.trim()) continue;
    for (const [kind, re] of TECH_RULES) if (re.test(t.text)) score.set(kind, (score.get(kind) ?? 0) + t.weight);
  }
  let best: ProjectImageKind | null = null;
  let bestScore = 0;
  for (const [kind] of TECH_RULES) {
    const v = score.get(kind) ?? 0;
    if (v > bestScore) {
      best = kind;
      bestScore = v;
    }
  }
  return best;
}

function matchIndustry(text: string): ProjectImageKind | null {
  if (!text.trim()) return null;
  for (const [kind, re] of INDUSTRY_RULES) if (re.test(text)) return kind;
  return null;
}

export type ProjectImageInput = {
  industry?: string | null;
  name: string;
  summary?: string | null;
  skills?: string[];
};

export function classifyProjectImage(p: ProjectImageInput): ProjectImageKind {
  const text = [p.name, p.summary ?? ""].join("\n");
  // 1) 業種欄 → 2) 案件名・概要 の順に業種系で判定
  const industry = matchIndustry(p.industry ?? "") ?? matchIndustry(text);
  if (industry) return industry;
  // 3) 案件名・概要とスキルから技術領域を集計して判定
  const tech = scoreTech([{ text, weight: 2 }, ...(p.skills ?? []).map((name) => ({ text: name, weight: 2 }))]);
  return tech ?? "business";
}

export type EngineerImageInput = {
  skills?: { category: string; name: string }[];
  roles?: string[];
  industries?: string[];
  summary?: string | null;
};

// 人材: スキル（言語・フレームワーク・DB は重み2、クラウド・ツール等は重み1）、概要（重み2）、役割（重み1）から
// 技術領域を集計して判定する。汎用の業務システム止まりなら業種経験で判定する
export function classifyEngineerImage(e: EngineerImageInput): ProjectImageKind {
  const skills = e.skills ?? [];
  const tech = scoreTech([
    ...skills
      .filter((s) => s.category !== "INDUSTRY")
      .map((s) => ({ text: s.name, weight: ["LANGUAGE", "FRAMEWORK", "DATABASE"].includes(s.category) ? 2 : 1 })),
    { text: e.summary ?? "", weight: 2 },
    ...(e.roles ?? []).map((r) => ({ text: r, weight: 1 })),
  ]);
  if (tech && tech !== "business") return tech;

  const industry = matchIndustry(
    [...skills.filter((s) => s.category === "INDUSTRY").map((s) => s.name), ...(e.industries ?? [])].join("\n")
  );
  return industry ?? tech ?? "business";
}
