// 双方向マッチングエンジン（§19）
// ハードフィルター（§19.1）→ スコアリング（§19.2）→ 結果表示要素（§19.3）

import { AFFILIATION_TRUST_POINTS, REMOTE_LEVEL_ORDER } from "@/lib/constants";

export type EngineerForMatch = {
  id: string;
  tenantCompanyId: string;
  status: string;
  affiliationType: string;
  availableFrom: Date | null;
  desiredRateYen: number;
  maxOnsiteDaysPerWeek: number | null;
  remotePreference: string; // 許容できる最低出社条件
  workAuthStatus: string;
  foreignNational?: boolean; // 外国籍か（国名指定から算出。未指定は日本国籍=false）
  hasValidConsent: boolean;
  skills: { name: string; months: number; lastUsedAt: Date | null }[];
  processes: string[];
  roles: string[];
  industries: string[];
};

export type ProjectForMatch = {
  id: string;
  tenantCompanyId: string;
  status: string;
  startDate: Date;
  rateMaxYen: number;
  onsiteDaysPerWeek: number;
  remoteLevel: string;
  allowSubtier: boolean;
  noForeignNational?: boolean; // 外国籍不可（SES案件の受入条件）
  acceptedTypes: string[];
  industry: string | null;
  processes: string[];
  requiredSkills: { name: string; minMonths: number | null }[];
  preferredSkills: { name: string }[];
};

export type MatchResult = {
  passed: boolean;
  score: number;
  breakdown: Record<string, number>;
  matchedConditions: string[];
  missingConditions: string[];
  warnings: string[];
};

const norm = (s: string) => s.trim().toLowerCase();

function findSkill(engineer: EngineerForMatch, name: string) {
  return engineer.skills.find((s) => norm(s.name) === norm(name));
}

// ---- ハードフィルター（§19.1）----
export function hardFilter(project: ProjectForMatch, engineer: EngineerForMatch): string[] {
  const failures: string[] = [];

  // 公開状態・本人同意
  if (engineer.status !== "PUBLISHED") failures.push("人材が公開状態でない");
  if (!engineer.hasValidConsent) failures.push("有効な本人同意がない");
  if (project.status !== "PUBLISHED") failures.push("案件が公開状態でない");

  // 必須スキル
  for (const rs of project.requiredSkills) {
    const skill = findSkill(engineer, rs.name);
    if (!skill) failures.push(`必須スキル不足: ${rs.name}`);
    else if (rs.minMonths && skill.months < rs.minMonths)
      failures.push(`必須スキル経験不足: ${rs.name}（${skill.months}ヶ月 < ${rs.minMonths}ヶ月）`);
  }

  // 稼働開始日
  if (engineer.availableFrom && engineer.availableFrom > project.startDate)
    failures.push("稼働開始日が案件開始日に間に合わない");

  // 単価上限
  if (engineer.desiredRateYen > project.rateMaxYen) failures.push("希望単価が案件上限を超過");

  // 勤務地・出社条件: 人材の許容出社日数が案件の週出社日数を下回る場合は不可
  if (
    engineer.maxOnsiteDaysPerWeek != null &&
    project.onsiteDaysPerWeek > engineer.maxOnsiteDaysPerWeek
  )
    failures.push(
      `出社条件不一致（案件: 週${project.onsiteDaysPerWeek}日 / 人材上限: 週${engineer.maxOnsiteDaysPerWeek}日）`
    );

  // 就労資格（§15）: 期限切れは候補外
  if (engineer.workAuthStatus === "EXPIRED") failures.push("就労資格の有効期限切れ");

  // 外国籍不可の案件: 外国籍（国名指定あり）の人材は対象外
  if (project.noForeignNational && engineer.foreignNational)
    failures.push("外国籍不可の案件");

  // 受入所属区分（§12）
  if (
    project.acceptedTypes.length > 0 &&
    !project.acceptedTypes.includes(engineer.affiliationType)
  )
    failures.push("受入所属区分の対象外");

  // 再委託・商流: 一社下人材は案件が一社下可の場合のみ（§12.4）
  if (engineer.affiliationType === "SUBTIER1" && !project.allowSubtier)
    failures.push("一社下不可の案件");

  return failures;
}

// ---- スコアリング（§19.2）----
// 必須30 / 尚可10 / 経験・直近15 / 工程・役割10 / 開始日10 / 単価10 / 通勤・在宅10 / 業種5 = 100
// 所属信頼加点は最大5点（能力評価を逆転させない加点）
export function score(project: ProjectForMatch, engineer: EngineerForMatch): MatchResult {
  const failures = hardFilter(project, engineer);
  const breakdown: Record<string, number> = {};
  const matched: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  // 必須スキル (30): 全て満たしていることが前提（ハードフィルター）。充足率で配点。
  const reqTotal = project.requiredSkills.length;
  const reqHit = project.requiredSkills.filter((rs) => {
    const s = findSkill(engineer, rs.name);
    return s && (!rs.minMonths || s.months >= rs.minMonths);
  }).length;
  breakdown["必須スキル"] = reqTotal === 0 ? 30 : Math.round((reqHit / reqTotal) * 30);
  if (reqTotal > 0 && reqHit === reqTotal) matched.push("必須スキルを全て充足");

  // 尚可スキル (10)
  const prefTotal = project.preferredSkills.length;
  const prefHits = project.preferredSkills.filter((ps) => findSkill(engineer, ps.name));
  breakdown["尚可スキル"] =
    prefTotal === 0 ? 10 : Math.round((prefHits.length / prefTotal) * 10);
  if (prefHits.length > 0)
    matched.push(`尚可スキル: ${prefHits.map((p) => p.name).join(", ")}`);
  const prefMissing = project.preferredSkills.filter((ps) => !findSkill(engineer, ps.name));
  if (prefMissing.length > 0)
    missing.push(`尚可スキル未保有: ${prefMissing.map((p) => p.name).join(", ")}`);

  // 経験・直近利用 (15): 必須スキルの経験月数と最終利用日
  let expScore = 0;
  if (reqTotal > 0) {
    const perSkill = 15 / reqTotal;
    for (const rs of project.requiredSkills) {
      const s = findSkill(engineer, rs.name);
      if (!s) continue;
      // 経験月数: 36ヶ月以上で満点の6割、直近2年以内の利用で残り4割
      const expPart = Math.min(s.months / 36, 1) * perSkill * 0.6;
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const recencyPart = s.lastUsedAt && s.lastUsedAt >= twoYearsAgo ? perSkill * 0.4 : 0;
      expScore += expPart + recencyPart;
      if (s.lastUsedAt && s.lastUsedAt < twoYearsAgo)
        warnings.push(`${s.name} の最終利用が2年以上前`);
    }
  } else {
    expScore = 15;
  }
  breakdown["経験・直近利用"] = Math.round(expScore);

  // 工程・役割 (10)
  const procTotal = project.processes.length;
  const procHit = project.processes.filter(
    (p) => engineer.processes.includes(p) || engineer.roles.includes(p)
  ).length;
  breakdown["工程・役割"] = procTotal === 0 ? 10 : Math.round((procHit / procTotal) * 10);
  if (procTotal > 0 && procHit < procTotal)
    missing.push(
      `工程未経験: ${project.processes.filter((p) => !engineer.processes.includes(p) && !engineer.roles.includes(p)).join(", ")}`
    );

  // 稼働開始日 (10): 開始日ちょうど〜30日前で満点、遅れなしが前提
  if (!engineer.availableFrom) {
    breakdown["稼働開始日"] = 5;
    warnings.push("稼働可能日が未登録");
  } else {
    const gapDays = Math.floor(
      (project.startDate.getTime() - engineer.availableFrom.getTime()) / 86_400_000
    );
    breakdown["稼働開始日"] = gapDays < 0 ? 0 : gapDays <= 30 ? 10 : gapDays <= 60 ? 7 : 4;
    if (gapDays >= 0 && gapDays <= 30) matched.push("稼働開始日が案件開始に適合");
  }

  // 単価 (10): 上限に対する余裕で配点
  const rateRatio = engineer.desiredRateYen / project.rateMaxYen;
  breakdown["単価"] = rateRatio <= 0.85 ? 10 : rateRatio <= 0.95 ? 8 : rateRatio <= 1 ? 6 : 0;
  if (rateRatio <= 1) matched.push("希望単価が案件上限内");

  // 通勤・在宅 (10): 案件の出社条件が人材の許容範囲より緩いほど高得点
  const projOrder = REMOTE_LEVEL_ORDER[project.remoteLevel] ?? 0;
  const engOrder = REMOTE_LEVEL_ORDER[engineer.remotePreference] ?? 0;
  // engineer.remotePreference = 許容できる最低出社条件（例: R2 なら週2〜3出社まで許容）
  breakdown["通勤・在宅"] = projOrder >= engOrder ? 10 : Math.max(0, 10 - (engOrder - projOrder) * 3);
  if (projOrder < engOrder)
    warnings.push("案件の出社頻度が人材の希望より多い（要確認）");

  // 業種・業務知識 (5)
  breakdown["業種・業務知識"] =
    !project.industry ? 5 : engineer.industries.includes(project.industry) ? 5 : 0;
  if (project.industry && engineer.industries.includes(project.industry))
    matched.push(`業種経験: ${project.industry}`);

  // 所属信頼加点（最大5点、§19.2）
  breakdown["所属信頼"] = Math.min(
    AFFILIATION_TRUST_POINTS[engineer.affiliationType] ?? 0,
    5
  );

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  for (const f of failures) missing.unshift(f);

  return {
    passed: failures.length === 0,
    score: total,
    breakdown,
    matchedConditions: matched,
    missingConditions: missing,
    warnings,
  };
}
