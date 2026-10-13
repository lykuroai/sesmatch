// 企業ダッシュボード KPI（§8.3）

import { prisma } from "@/server/db";
import type { AuthContext } from "@/server/auth/session";
import { normalizeSkillTerm } from "@/lib/constants";

export async function getDashboard(auth: AuthContext) {
  const tenant = { tenantCompanyId: auth.companyId };
  const [
    publishedProjects,
    publishedEngineers,
    draftEngineers,
    reviewRequired,
    recentMatches,
    consentExpiring,
  ] = await Promise.all([
    prisma.project.count({ where: { ...tenant, status: "PUBLISHED" } }),
    prisma.engineer.count({ where: { ...tenant, status: "PUBLISHED" } }),
    prisma.engineer.count({ where: { ...tenant, status: "DRAFT" } }),
    prisma.ingestionJob.count({ where: { ...tenant, status: "REVIEW_REQUIRED" } }),
    prisma.matchingResult.count({
      where: { ...tenant, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
    // 同意・証憑期限警告: 30日以内に期限を迎える同意
    prisma.personConsent.count({
      where: {
        engineer: tenant,
        revokedAt: null,
        validUntil: { not: null, lte: new Date(Date.now() + 30 * 86_400_000) },
      },
    }),
  ]);

  // 承認待ち: 自社側の承認がまだのエントリー（§8.3）
  const [pendingApprovals, upcomingInterviews] = await Promise.all([
    prisma.entry.count({
      where: {
        OR: [
          { supplyCompanyId: auth.companyId, supplyApprovedAt: null, status: "DEMAND_APPROVED" },
          { demandCompanyId: auth.companyId, demandApprovedAt: null, status: "SUPPLY_APPROVED" },
        ],
      },
    }),
    prisma.interview.count({
      where: {
        status: "SCHEDULED",
        scheduledAt: { gte: new Date() },
        entry: {
          OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }],
        },
      },
    }),
  ]);

  // 稼働中人数・今月手数料（§8.3）
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [activeContracts, monthFees] = await Promise.all([
    prisma.contract.count({
      where: {
        status: "ACTIVE",
        OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }],
      },
    }),
    prisma.platformFee.aggregate({
      where: { demandCompanyId: auth.companyId, month: thisMonth, status: "CHARGED" },
      _sum: { feeExTaxYen: true },
    }),
  ]);

  return {
    publishedProjects, // 公開中案件
    publishedEngineers, // 営業中人材
    activeContracts, // 稼働中人数
    monthFeeYen: monthFees._sum.feeExTaxYen ?? 0, // 今月手数料（税抜）
    draftEngineers, // 下書き人材
    reviewRequired, // 対応待ち（人手確認）
    recentMatches, // 直近7日のマッチ計算
    consentExpiring, // 同意・証憑期限警告
    pendingApprovals, // 承認待ち
    upcomingInterviews, // 面談予定
  };
}

// ホームのスキル分布（案件と人材の主要スキル）。
// プラットフォーム全体の公開中案件・営業中人材を対象に、スキル名を
// 用語辞書（承認済み）と接尾辞正規化で名寄せして件数を数える（1案件/1人材につき同一スキルは1件）。
// 案件側は必須スキル（required=true）のみを対象とし、尚可スキルは数えない。
// 人材側の工程（PROCESS）・業種（INDUSTRY）は技術スキルではないため除外する。
// 個人情報・企業名は一切含めない（Level 1 の匿名集計）。
export type SkillDistributionRow = { name: string; projects: number; engineers: number };
export type SkillDistribution = {
  rows: SkillDistributionRow[]; // 合計件数の降順
  totalProjects: number; // 集計対象の公開中案件数
  totalEngineers: number; // 集計対象の営業中人材数
};

export async function getSkillDistribution(limit = 15): Promise<SkillDistribution> {
  const [projects, engineers, aliases] = await Promise.all([
    prisma.project.findMany({
      where: { status: "PUBLISHED" },
      select: { skills: { where: { required: true }, select: { name: true } } },
    }),
    prisma.engineer.findMany({
      where: { status: "PUBLISHED", deletedAt: null },
      select: { skills: { where: { category: { notIn: ["PROCESS", "INDUSTRY"] } }, select: { name: true } } },
    }),
    prisma.skillAlias.findMany({ where: { status: "APPROVED" }, select: { alias: true, canonical: true } }),
  ]);

  // 正規化キー → 正規形の表示名（辞書にある語は canonical を表示名にする）
  const canonicalOf = new Map<string, string>();
  for (const a of aliases) {
    const c = a.canonical.trim();
    canonicalOf.set(normalizeSkillTerm(a.alias), c);
    canonicalOf.set(normalizeSkillTerm(c), c);
  }
  const keyOf = (name: string) => {
    const base = normalizeSkillTerm(name);
    const c = canonicalOf.get(base);
    return c ? normalizeSkillTerm(c) : base;
  };

  const rows = new Map<string, SkillDistributionRow>();
  const bump = (names: string[], field: "projects" | "engineers") => {
    const seen = new Set<string>();
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const key = keyOf(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const row = rows.get(key) ?? { name: canonicalOf.get(normalizeSkillTerm(name)) ?? name, projects: 0, engineers: 0 };
      row[field] += 1;
      rows.set(key, row);
    }
  };
  for (const p of projects) bump(p.skills.map((s) => s.name), "projects");
  for (const e of engineers) bump(e.skills.map((s) => s.name), "engineers");

  const sorted = [...rows.values()].sort(
    (a, b) => b.projects + b.engineers - (a.projects + a.engineers) || a.name.localeCompare(b.name, "ja")
  );
  return { rows: sorted.slice(0, limit), totalProjects: projects.length, totalEngineers: engineers.length };
}
