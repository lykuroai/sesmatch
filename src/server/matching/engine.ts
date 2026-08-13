// 双方向マッチングエンジン（§19）
// ハードフィルター（§19.1）→ スコアリング（§19.2）→ 結果表示要素（§19.3）

import {
  AFFILIATION_TRUST_POINTS,
  normalizeSkillTerm,
  prefectureOf,
  REMOTE_LEVEL_ORDER,
} from "@/lib/constants";

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
  residenceCity?: string | null; // 居住エリア（通勤圏の参考警告に使用）
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
  locationCity?: string | null; // 勤務地（通勤圏の参考警告に使用）
};

export type MatchResult = {
  passed: boolean;
  score: number;
  breakdown: Record<string, number>;
  matchedConditions: string[];
  missingConditions: string[];
  warnings: string[];
};

// 名称の比較は正規化後の完全一致（§19 名寄せ）。
// 既定は接尾辞正規化（normalizeSkillTerm）。用語辞書を使う場合は呼び出し側が
// 辞書引き当てを含む normalize を注入する（エンジンは純粋関数のまま保つ）
export type MatchOptions = {
  normalize?: (name: string) => string;
  // 必須スキルの充足率しきい値（0〜1、既定1=全て充足が必要）。
  // 例: 0.9 なら必須スキルの90%以上を満たす人材も候補として通す（不足分は不足条件に表示）
  minRequiredSkillRatio?: number;
};

type Normalizer = (name: string) => string;

function findSkill(engineer: EngineerForMatch, name: string, n: Normalizer) {
  return engineer.skills.find((s) => n(s.name) === n(name));
}

// 必須スキルに「基本設計」等の工程・役割名や「保険」等の業種名が指定されている場合は、
// 人材の工程・役割・業種経験欄でも充足と判定する（スキル欄のみを見ると誰ともマッチしなくなる）
function hasProcessRoleOrIndustry(engineer: EngineerForMatch, name: string, n: Normalizer) {
  return (
    engineer.processes.some((p) => n(p) === n(name)) ||
    engineer.roles.some((r) => n(r) === n(name)) ||
    engineer.industries.some((i) => n(i) === n(name))
  );
}

// ---- ハードフィルター（§19.1）----
export function hardFilter(
  project: ProjectForMatch,
  engineer: EngineerForMatch,
  opts?: MatchOptions
): string[] {
  const n = opts?.normalize ?? normalizeSkillTerm;
  const failures: string[] = [];

  // 公開状態・本人同意
  if (engineer.status !== "PUBLISHED") failures.push("人材が公開状態でない");
  if (!engineer.hasValidConsent) failures.push("有効な本人同意がない");
  if (project.status !== "PUBLISHED") failures.push("案件が公開状態でない");

  // 必須スキル（工程・役割・業種名の場合は各欄でも充足）
  const skillFailures: string[] = [];
  for (const rs of project.requiredSkills) {
    const skill = findSkill(engineer, rs.name, n);
    if (skill) {
      if (rs.minMonths && skill.months < rs.minMonths)
        skillFailures.push(`必須スキル経験不足: ${rs.name}（${skill.months}ヶ月 < ${rs.minMonths}ヶ月）`);
    } else if (hasProcessRoleOrIndustry(engineer, rs.name, n)) {
      // 工程・役割・業種での充足は経験月数を持たないため、月数条件付きの場合は不足扱い
      if (rs.minMonths)
        skillFailures.push(`必須スキル経験不足: ${rs.name}（経験月数未登録 < ${rs.minMonths}ヶ月）`);
    } else {
      skillFailures.push(`必須スキル不足: ${rs.name}`);
    }
  }
  // 充足率がしきい値以上なら必須スキルの不足は許容する（画面の「必須スキル適合」条件。既定は100%）
  const reqCount = project.requiredSkills.length;
  const fulfilledRatio = reqCount === 0 ? 1 : (reqCount - skillFailures.length) / reqCount;
  if (fulfilledRatio + 1e-9 < (opts?.minRequiredSkillRatio ?? 1)) failures.push(...skillFailures);

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
export function score(
  project: ProjectForMatch,
  engineer: EngineerForMatch,
  opts?: MatchOptions
): MatchResult {
  const n = opts?.normalize ?? normalizeSkillTerm;
  const failures = hardFilter(project, engineer, opts);
  const breakdown: Record<string, number> = {};
  const matched: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  // 必須スキル (30): 全て満たしていることが前提（ハードフィルター）。充足率で配点。
  // 工程・役割・業種名の必須指定は各欄でも充足（月数条件なしの場合のみ）
  const reqTotal = project.requiredSkills.length;
  const reqHit = project.requiredSkills.filter((rs) => {
    const s = findSkill(engineer, rs.name, n);
    if (s) return !rs.minMonths || s.months >= rs.minMonths;
    return !rs.minMonths && hasProcessRoleOrIndustry(engineer, rs.name, n);
  }).length;
  breakdown["必須スキル"] = reqTotal === 0 ? 30 : Math.round((reqHit / reqTotal) * 30);
  if (reqTotal > 0 && reqHit === reqTotal) matched.push("必須スキルを全て充足");
  // しきい値緩和で通過した場合、不足した必須スキルを不足条件として表示する
  if (reqTotal > 0 && reqHit < reqTotal && !failures.some((f) => f.startsWith("必須スキル"))) {
    const unmet = project.requiredSkills
      .filter((rs) => {
        const s = findSkill(engineer, rs.name, n);
        if (s) return rs.minMonths != null && s.months < rs.minMonths;
        return rs.minMonths != null || !hasProcessRoleOrIndustry(engineer, rs.name, n);
      })
      .map((rs) => rs.name);
    if (unmet.length > 0) missing.push(`必須スキル不足: ${unmet.join(", ")}`);
  }

  // 尚可スキル (10)
  const prefTotal = project.preferredSkills.length;
  const prefHits = project.preferredSkills.filter((ps) => findSkill(engineer, ps.name, n));
  breakdown["尚可スキル"] =
    prefTotal === 0 ? 10 : Math.round((prefHits.length / prefTotal) * 10);
  if (prefHits.length > 0)
    matched.push(`尚可スキル: ${prefHits.map((p) => p.name).join(", ")}`);
  const prefMissing = project.preferredSkills.filter((ps) => !findSkill(engineer, ps.name, n));
  if (prefMissing.length > 0)
    missing.push(`尚可スキル未保有: ${prefMissing.map((p) => p.name).join(", ")}`);

  // 経験・直近利用 (15): 必須スキルの経験月数と最終利用日
  let expScore = 0;
  if (reqTotal > 0) {
    const perSkill = 15 / reqTotal;
    for (const rs of project.requiredSkills) {
      const s = findSkill(engineer, rs.name, n);
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

  // 工程・役割 (10): 名寄せ（正規化・辞書）を適用して比較
  const hasProc = (p: string) =>
    engineer.processes.some((x) => n(x) === n(p)) || engineer.roles.some((x) => n(x) === n(p));
  const procTotal = project.processes.length;
  const procHit = project.processes.filter(hasProc).length;
  breakdown["工程・役割"] = procTotal === 0 ? 10 : Math.round((procHit / procTotal) * 10);
  if (procTotal > 0 && procHit < procTotal)
    missing.push(`工程未経験: ${project.processes.filter((p) => !hasProc(p)).join(", ")}`);

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

  // 通勤圏（参考警告）: 出社がある案件で、居住都道府県と勤務地都道府県が異なる場合は要確認。
  // 足切りにはしない（引越・遠距離通勤等は人が判断）。都道府県が読み取れない旧データは判定しない
  if (project.onsiteDaysPerWeek >= 1) {
    const projPref = prefectureOf(project.locationCity);
    const engPref = prefectureOf(engineer.residenceCity);
    if (projPref && engPref && projPref !== engPref)
      warnings.push(`通勤圏の確認が必要（居住: ${engPref} / 勤務地: ${projPref}）`);
  }

  // 業種・業務知識 (5): 名寄せ（正規化・辞書）を適用して比較
  const industryHit =
    !!project.industry && engineer.industries.some((i) => n(i) === n(project.industry!));
  breakdown["業種・業務知識"] = !project.industry ? 5 : industryHit ? 5 : 0;
  if (industryHit) matched.push(`業種経験: ${project.industry}`);

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
