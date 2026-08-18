// ローカル在庫 × 親サーバ公開データの簡易マッチング（本体 §19 の簡易版）。
// ローカル抽出JSON（自社側）と検索結果の匿名項目（相手側）だけで判定する。
// 本体エンジンとの差分: 用語辞書なし（接尾辞正規化のみ）、所属・就労資格など
// ローカル側に無い項目は判定から除外（不明分は中間点）。

const TERM_SUFFIXES = ["業務経験", "開発経験", "業務", "経験", "関連", "案件", "開発", "系"];

export function normalizeSkillTerm(name) {
  let s = String(name ?? "").trim().toLowerCase();
  for (let changed = true; changed; ) {
    changed = false;
    for (const suf of TERM_SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return s;
}

const AFFILIATION_TRUST_POINTS = { EMPLOYEE: 5, AFFILIATED: 4, FREELANCER: 4, SUBTIER1: 2 };

const n = normalizeSkillTerm;
const eq = (a, b) => n(a) === n(b);

// 公開人材の単価帯 "70〜80万円" → 円の下限・上限
function parseRateBand(band) {
  const m = /^(\d+)〜(\d+)万円$/.exec(String(band ?? ""));
  return m ? { min: Number(m[1]) * 10_000, max: Number(m[2]) * 10_000 } : null;
}

const isForeign = (nationality) => {
  const s = String(nationality ?? "").trim().toLowerCase();
  return s !== "" && !["日本", "日本国", "japan", "jp"].includes(s);
};

const day = (v) => (v ? new Date(v) : null);
const gapDays = (from, to) => Math.floor((to.getTime() - from.getTime()) / 86_400_000);

// 開始日の配点（§19.2 と同じ刻み）。available が null は中間点＋警告
function startScore(availableFrom, startDate, missing, warnings) {
  const a = day(availableFrom);
  const s = day(startDate);
  if (!s) return 5;
  if (!a) {
    warnings.push("稼働可能日が未登録");
    return 5;
  }
  const g = gapDays(a, s);
  if (g < 0) return 0;
  return g <= 30 ? 10 : g <= 60 ? 7 : 4;
}

// スキル群からの充足判定（スキル欄＋工程・役割・業種欄）
function findSkill(skills, name) {
  return (skills ?? []).find((s) => eq(s.name, name));
}
function hasProcessRoleOrIndustry(x, name) {
  return [...(x.processes ?? []), ...(x.roles ?? []), ...(x.industries ?? [])].some((v) => eq(v, name));
}

// ---- ローカル人材（抽出JSON） × 公開案件 ------------------------------------
// x: extracted.json（人材）, p: 親サーバ検索結果の案件
export function matchEngineerToProject(x, p) {
  const missing = [];
  const warnings = [];
  const failures = [];

  const required = p.requiredSkills ?? []; // [{name, minMonths}]
  for (const rs of required) {
    const s = findSkill(x.skills, rs.name);
    if (s) {
      if (rs.minMonths && (s.months ?? 0) < rs.minMonths)
        failures.push(`必須スキル経験不足: ${rs.name}`);
    } else if (!hasProcessRoleOrIndustry(x, rs.name) || rs.minMonths) {
      failures.push(`必須スキル不足: ${rs.name}`);
    }
  }
  if (x.availableFrom && p.startDate && day(x.availableFrom) > day(p.startDate))
    failures.push("稼働開始日が案件開始日に間に合わない");
  if (x.desiredRateYen && p.rateMaxYen && x.desiredRateYen > p.rateMaxYen)
    failures.push("希望単価が案件上限を超過");
  if (x.maxOnsiteDaysPerWeek != null && (p.onsiteDaysPerWeek ?? 0) > x.maxOnsiteDaysPerWeek)
    failures.push(`出社条件不一致（案件: 週${p.onsiteDaysPerWeek}日）`);
  if (p.noForeignNational && isForeign(x.nationality)) failures.push("外国籍不可の案件");

  // スコア（§19.2 の配点。所属信頼はローカル側に情報が無いため 0）
  const bd = {};
  const reqTotal = required.length;
  const reqHit = required.filter((rs) => {
    const s = findSkill(x.skills, rs.name);
    if (s) return !rs.minMonths || (s.months ?? 0) >= rs.minMonths;
    return !rs.minMonths && hasProcessRoleOrIndustry(x, rs.name);
  }).length;
  bd.required = reqTotal === 0 ? 30 : Math.round((reqHit / reqTotal) * 30);

  const preferred = p.preferredSkills ?? [];
  const prefHit = preferred.filter((ps) => findSkill(x.skills, ps.name)).length;
  bd.preferred = preferred.length === 0 ? 10 : Math.round((prefHit / preferred.length) * 10);
  const prefMiss = preferred.filter((ps) => !findSkill(x.skills, ps.name)).map((ps) => ps.name);
  if (prefMiss.length) missing.push(`尚可スキル未保有: ${prefMiss.join(", ")}`);

  let exp = 0;
  if (reqTotal > 0) {
    const per = 15 / reqTotal;
    for (const rs of required) {
      const s = findSkill(x.skills, rs.name);
      if (s) exp += Math.min((s.months ?? 0) / 36, 1) * per * 0.6; // 直近利用はローカルに無いため経験月数のみ
    }
  } else {
    exp = 15;
  }
  bd.experience = Math.round(exp);

  const procTotal = (p.processes ?? []).length;
  const hasProc = (v) => [...(x.processes ?? []), ...(x.roles ?? [])].some((w) => eq(w, v));
  const procHit = (p.processes ?? []).filter(hasProc).length;
  bd.process = procTotal === 0 ? 10 : Math.round((procHit / procTotal) * 10);
  if (procTotal > 0 && procHit < procTotal)
    missing.push(`工程未経験: ${(p.processes ?? []).filter((v) => !hasProc(v)).join(", ")}`);

  bd.start = startScore(x.availableFrom, p.startDate, missing, warnings);

  const ratio = x.desiredRateYen && p.rateMaxYen ? x.desiredRateYen / p.rateMaxYen : null;
  bd.rate = ratio == null ? 5 : ratio <= 0.85 ? 10 : ratio <= 0.95 ? 8 : ratio <= 1 ? 6 : 0;
  if (ratio == null) warnings.push("希望単価が未登録");

  bd.onsite = x.maxOnsiteDaysPerWeek == null ? 5 : 10; // 超過はハードフィルター済み

  const industryHit = !!p.industry && (x.industries ?? []).some((i) => eq(i, p.industry));
  bd.industry = !p.industry ? 5 : industryHit ? 5 : 0;

  const score = Object.values(bd).reduce((a, b) => a + b, 0);
  for (const f of failures) missing.unshift(f);
  return { passed: failures.length === 0, score, missing, warnings };
}

// ---- ローカル案件（抽出JSON） × 公開人材 ------------------------------------
// x: extracted.json（案件）, e: 親サーバ検索結果の人材
export function matchProjectToEngineer(x, e) {
  const missing = [];
  const warnings = [];
  const failures = [];

  const required = (x.requiredSkills ?? []).map((name) => ({ name })); // ローカル案件は名前のみ
  for (const rs of required) {
    if (!findSkill(e.skills, rs.name) && !hasProcessRoleOrIndustry(e, rs.name))
      failures.push(`必須スキル不足: ${rs.name}`);
  }
  if (e.availableFrom && x.startDate && day(e.availableFrom) > day(x.startDate))
    failures.push("稼働開始日が案件開始日に間に合わない");
  const band = parseRateBand(e.rateBand);
  if (band && x.rateMaxYen && band.min > x.rateMaxYen) failures.push("単価帯が案件上限を超過");
  if (e.maxOnsiteDaysPerWeek != null && (x.onsiteDaysPerWeek ?? 0) > e.maxOnsiteDaysPerWeek)
    failures.push(`出社条件不一致（人材上限: 週${e.maxOnsiteDaysPerWeek}日）`);
  if (x.noForeignNational && e.foreignNational) failures.push("外国籍不可の案件");

  const bd = {};
  const reqTotal = required.length;
  const reqHit = required.filter(
    (rs) => findSkill(e.skills, rs.name) || hasProcessRoleOrIndustry(e, rs.name)
  ).length;
  bd.required = reqTotal === 0 ? 30 : Math.round((reqHit / reqTotal) * 30);

  const preferred = (x.preferredSkills ?? []).map((name) => ({ name }));
  const prefHit = preferred.filter((ps) => findSkill(e.skills, ps.name)).length;
  bd.preferred = preferred.length === 0 ? 10 : Math.round((prefHit / preferred.length) * 10);
  const prefMiss = preferred.filter((ps) => !findSkill(e.skills, ps.name)).map((ps) => ps.name);
  if (prefMiss.length) missing.push(`尚可スキル未保有: ${prefMiss.join(", ")}`);

  let exp = 0;
  if (reqTotal > 0) {
    const per = 15 / reqTotal;
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    for (const rs of required) {
      const s = findSkill(e.skills, rs.name);
      if (!s) continue;
      exp += Math.min((s.months ?? 0) / 36, 1) * per * 0.6;
      if (s.lastUsedAt && day(s.lastUsedAt) >= twoYearsAgo) exp += per * 0.4;
      else if (s.lastUsedAt) warnings.push(`${s.name} の最終利用が2年以上前`);
    }
  } else {
    exp = 15;
  }
  bd.experience = Math.round(exp);

  bd.process = 10; // ローカル案件の抽出JSONに工程指定が無いため常に満点扱い
  bd.start = startScore(e.availableFrom, x.startDate, missing, warnings);

  const ratio = band && x.rateMaxYen ? band.min / x.rateMaxYen : null;
  bd.rate = ratio == null ? 5 : ratio <= 0.85 ? 10 : ratio <= 0.95 ? 8 : ratio <= 1 ? 6 : 0;
  if (ratio == null) warnings.push("単価帯が読み取れません");

  bd.onsite = e.maxOnsiteDaysPerWeek == null ? 5 : 10;
  bd.industry = 5; // ローカル案件の抽出JSONに業種が無いため中立
  bd.trust = Math.min(AFFILIATION_TRUST_POINTS[e.affiliationType] ?? 0, 5);

  const score = Object.values(bd).reduce((a, b) => a + b, 0);
  for (const f of failures) missing.unshift(f);
  return { passed: failures.length === 0, score, missing, warnings };
}
