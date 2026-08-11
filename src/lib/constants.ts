// 仕様書に基づく共通定数・表示ラベル

export const ROLE_LABELS: Record<string, string> = {
  OWNER: "企業オーナー",
  ADMIN: "企業管理者",
  SALES: "営業担当",
  HR_MANAGER: "人材管理担当",
  PROJECT_MANAGER: "案件管理担当",
  CONTRACT: "契約担当",
  ACCOUNTING: "経理担当",
  PRIVACY_OFFICER: "個人情報管理者",
  AUDITOR: "監査担当",
  VIEWER: "閲覧者",
};

// 契約形態（基本契約第4条）。案件登録・条件確認書で必須選択
export const PROJECT_CONTRACT_TYPES = ["準委任", "請負", "労働者派遣"] as const;
export type ProjectContractType = (typeof PROJECT_CONTRACT_TYPES)[number];
// 労働者派遣: 供給側の派遣事業許可＋直接雇用人材のみ・一社下不可（基本契約第4条）
export const DISPATCH_CONTRACT_TYPE = "労働者派遣";

export const AFFILIATION_LABELS: Record<string, string> = {
  EMPLOYEE: "自社社員",
  AFFILIATED: "自社所属",
  FREELANCER: "個人事業主",
  SUBTIER1: "一社下",
};

// 所属信頼加点の上限（§19.2）。最大5点、能力評価を逆転させない。
export const AFFILIATION_TRUST_POINTS: Record<string, number> = {
  EMPLOYEE: 5,
  AFFILIATED: 4,
  FREELANCER: 4,
  SUBTIER1: 2,
};

export const REMOTE_LEVEL_LABELS: Record<string, string> = {
  R0: "常駐・週5出社",
  R1: "週4出社",
  R2: "週2〜3出社",
  R3: "週1以下",
  R4: "フルリモート（緊急出社あり）",
  R5: "完全遠隔",
};

// RemoteLevel を出社頻度の序列に変換（R0が最も出社が多い）
export const REMOTE_LEVEL_ORDER: Record<string, number> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
  R5: 5,
};

// 一覧共通のページサイズ（§8 一覧表示。ページャは components/Pager.tsx）
export const LIST_PAGE_SIZE = 50;

export const PUBLISH_STATUS_LABELS: Record<string, string> = {
  DRAFT: "下書き",
  PUBLISHED: "公開中",
  SUSPENDED: "停止中",
  CLOSED: "終了",
};

// 案件の進行状態（商談開始・成約で自動更新、手動で上書き可能）
export const PROJECT_WORKFLOW_LABELS: Record<string, string> = {
  RECRUITING: "応募中",
  NEGOTIATING: "商談中",
  CONTRACTED: "成約",
  ENDED: "終了",
};

// 人材の稼働状態（商談開始・稼働開始で自動更新、手動で上書き可能）
export const ENGINEER_WORK_STATUS_LABELS: Record<string, string> = {
  PROPOSING: "紹介中",
  NEGOTIATING: "商談中",
  WORKING: "稼働中",
};

export const INGESTION_STATUS_LABELS: Record<string, string> = {
  RECEIVED: "受領",
  MASKING: "匿名化中",
  EXTRACTING: "抽出中",
  REVIEW_REQUIRED: "人手確認待ち",
  CONFIRMED: "確定済み",
  FAILED: "失敗",
};

export const SKILL_CATEGORY_LABELS: Record<string, string> = {
  LANGUAGE: "言語",
  FRAMEWORK: "FW",
  DATABASE: "DB",
  CLOUD: "クラウド",
  OS: "OS",
  TOOL: "ツール",
  CERTIFICATION: "資格",
  PROCESS: "工程",
  INDUSTRY: "業種",
};

// 商談ステータスの表示名（2026-08-11 の用語統一。内部状態はそのまま、表示のみ「商談」呼称）
// 片側承認（SUPPLY/DEMAND_APPROVED）はどちらも「承認待ち」、条件調整と契約手続は「契約調整中」に統合
export const ENTRY_STATUS_LABELS: Record<string, string> = {
  DRAFT: "申込み前",
  SUBMITTED: "承認待ち",
  SUPPLY_APPROVED: "承認待ち",
  DEMAND_APPROVED: "承認待ち",
  MUTUALLY_APPROVED: "商談中",
  INTERVIEW: "面談調整中",
  CONDITIONS: "契約調整中",
  CONTRACTING: "契約調整中",
  CONTRACTED: "成約",
  DECLINED: "見送り",
  WITHDRAWN: "辞退",
  ON_HOLD: "保留",
};

export const ENTRY_TYPE_LABELS: Record<string, string> = {
  PROPOSAL: "提案",
  SCOUT: "スカウト",
};

export const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  PARTNER: "取引先",
  SUBTIER: "一社下",
  SALES_DELEGATION: "営業委任",
};

export const REPORT_CATEGORIES = [
  "再転載",
  "無承認再仲介",
  "直接取引誘引",
  "所属偽装",
  "その他",
];

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "下書き",
  SIGNED_SUPPLY: "供給側署名済み",
  SIGNED_DEMAND: "需要側署名済み",
  EXECUTED: "相互締結完了（成約）",
  ACTIVE: "稼働中",
  CANCELLED: "稼働前キャンセル",
  TERMINATED: "終了",
  COMPLETED: "完了",
};

export const FEE_STATUS_LABELS: Record<string, string> = {
  CHARGED: "課金",
  FREE: "無料", // 13稼働月目以降 または 新規企業30日間
  REFUNDED: "返金済み", // 旧仕様（未使用）
  CANCELLED: "キャンセル", // 稼働開始後14日以内の契約終了（手数料0円）
};

export const PRIVACY_STATUS_LABELS: Record<string, string> = {
  RECEIVED: "受付済み（判断待ち）",
  APPROVED: "承認済み（論理削除）",
  REJECTED: "却下",
  COMPLETED: "物理削除実行済み",
};

// 単価の公開帯: 10万円幅（§10 Level 1）
// スキル・工程・業種名の比較用正規化（§19 マッチングの名寄せ・案A）:
// 前後空白の除去・小文字化に加え、「保険業務」→「保険」のような接尾辞を除去する。
// 完全一致の前処理としてのみ使い、部分一致はしない（Java と JavaScript の誤マッチを防ぐ）
const TERM_SUFFIXES = ["業務経験", "開発経験", "業務", "経験", "関連", "案件", "開発", "系"];
export function normalizeSkillTerm(name: string): string {
  let s = name.trim().toLowerCase();
  for (let changed = true; changed; ) {
    changed = false;
    for (const suf of TERM_SUFFIXES) {
      // 接尾辞そのものの語（「開発」「業務」等の工程名）は除去しない
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return s;
}

// 都道府県（居住エリア・勤務地の選択肢。保存値は「東京都千代田区」形式の先頭に付く）
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

// 地名文字列から都道府県を取り出す（先頭一致。都道府県が含まれない旧データは null）
export function prefectureOf(location: string | null | undefined): string | null {
  if (!location) return null;
  return PREFECTURES.find((p) => location.startsWith(p)) ?? null;
}

// 週出社日数から在宅区分を導出（取込確定時の初期値。週出社日数と在宅区分は重複情報のため
// 取込では出社日数を正とする。R5=完全遠隔は明示がある場合のみ確認画面で手動選択）
export function remoteLevelFromOnsiteDays(days: number): "R0" | "R1" | "R2" | "R3" | "R4" {
  if (days >= 5) return "R0";
  if (days === 4) return "R1";
  if (days >= 2) return "R2";
  if (days === 1) return "R3";
  return "R4";
}

// 在宅区分から週出社日数を導出。画面入力は在宅区分に一本化し、日数は連動して保存する
// （マッチングのハードフィルターは日数比較のため、幅のある区分は上限日数を採用）
export function remoteLevelToOnsiteDays(level: string): number {
  switch (level) {
    case "R0":
      return 5;
    case "R1":
      return 4;
    case "R2":
      return 3; // 週2〜3出社 → 上限3日
    case "R3":
      return 1; // 週1以下 → 1日
    default:
      return 0; // R4/R5（フルリモート・完全遠隔）
  }
}

export function rateBand(rateYen: number): string {
  const lower = Math.floor(rateYen / 100_000) * 10;
  return `${lower}〜${lower + 10}万円`;
}

// 5歳刻み年代表示（§10 Level 1）
export function ageBandLabel(ageBand: number): string {
  return `${ageBand}〜${ageBand + 4}歳`;
}
