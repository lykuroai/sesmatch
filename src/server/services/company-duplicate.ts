// 企業申込の重複判定（決定的・純粋ロジック。テスト対象）
//
// ルール:
// - 正規化した企業名が一致 かつ 管轄法務局が一致 → NG（商業登記上、同一管轄での同名登記は同一企業とみなす）
// - 企業名・管轄法務局の片方のみ一致 → 警告（申込者が確認すれば続行可＝登録できる、運営審査で最終確認）
//
// 管轄法務局: 商業・法人登記の管轄は都道府県の本局に集約されているため都道府県単位で判定する
// （例外の北海道は札幌/函館/旭川/釧路の4管轄だが、道内の同名企業は稀なため都道府県単位の近似で扱う）

export type DuplicateJudgement = {
  level: "ng" | "warning" | "ok";
  matchedName?: string;
  matchedField?: "name" | "jurisdiction" | "address";
};

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

// 法人格の表記（NFKC 正規化後の形。㈱→(株)、全角括弧→半角括弧に揃った状態で除去する）
const LEGAL_ENTITY_TOKENS = [
  "株式会社", "合同会社", "合資会社", "合名会社", "有限会社",
  "一般社団法人", "一般財団法人", "公益社団法人", "公益財団法人",
  "特定非営利活動法人", "npo法人",
  "(株)", "(有)", "(合)", "(同)",
];

// 全角→半角・大小文字・空白・法人格表記のゆれを吸収した比較用の企業名
export function normalizeCompanyName(name: string): string {
  let s = name.normalize("NFKC").toLowerCase().replace(/[\s　]+/g, "");
  for (const token of LEGAL_ENTITY_TOKENS) s = s.split(token).join("");
  return s;
}

// ハイフン類・丁目/番地/番/号・漢数字（丁目の前）のゆれを吸収した比較用の所在地
export function normalizeAddress(address: string): string {
  let s = address.normalize("NFKC").toLowerCase().replace(/[\s　]+/g, "");
  // 「一丁目」等の漢数字を算用数字へ（一〜十のみ。丁目表記で使われる範囲）
  const kanji: Record<string, string> = {
    一: "1", 二: "2", 三: "3", 四: "4", 五: "5",
    六: "6", 七: "7", 八: "8", 九: "9", 十: "10",
  };
  s = s.replace(/([一二三四五六七八九十])(?=丁目)/g, (m) => kanji[m] ?? m);
  // 丁目・番地・番・号 とハイフン類を "-" に統一
  s = s.replace(/丁目|番地|番|号/g, "-");
  s = s.replace(/[‐‑–—―ーｰ−]/g, "-");
  return s.replace(/-{2,}/g, "-").replace(/-+$/, "");
}

// 所在地から管轄法務局（都道府県単位の近似）を求める。都道府県名がなければ null
export function registryJurisdiction(address: string | null | undefined): string | null {
  if (!address) return null;
  const s = address.normalize("NFKC").replace(/[\s　]+/g, "");
  for (const pref of PREFECTURES) if (s.includes(pref)) return pref;
  return null;
}

// 申込企業と既存企業リストを突き合わせて NG / 警告 / OK を判定する
export function judgeCompanyDuplicate(
  candidate: { name: string; address?: string | null },
  existing: { name: string; address?: string | null }[]
): DuplicateJudgement {
  const candName = normalizeCompanyName(candidate.name);
  const candAddr = candidate.address ? normalizeAddress(candidate.address) : "";
  const candJur = registryJurisdiction(candidate.address);
  let warning: DuplicateJudgement | null = null;
  for (const c of existing) {
    const sameName = candName !== "" && normalizeCompanyName(c.name) === candName;
    const sameAddr = candAddr !== "" && !!c.address && normalizeAddress(c.address) === candAddr;
    const sameJurisdiction =
      candJur !== null && registryJurisdiction(c.address) === candJur;
    if (sameName && (sameJurisdiction || sameAddr))
      return { level: "ng", matchedName: c.name };
    if (sameName) warning ??= { level: "warning", matchedName: c.name, matchedField: "name" };
    else if (sameJurisdiction)
      warning ??= { level: "warning", matchedName: c.name, matchedField: "jurisdiction" };
    else if (sameAddr) warning ??= { level: "warning", matchedName: c.name, matchedField: "address" };
  }
  return warning ?? { level: "ok" };
}
