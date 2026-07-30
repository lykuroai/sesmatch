// 企業ダッシュボード KPI（§8.3）

import { prisma } from "@/server/db";
import type { AuthContext } from "@/server/auth/session";

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
