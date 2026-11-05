// PRO 版の月額請求（PRO版仕様書 §6.1）
//
// - 月初に運営が当月分の請求書を一括生成する（企業×月で一意。再実行は既存をスキップ）
// - 対象: 対象月の時点で plan=PRO・請求書払い・開通済みで、開始月が対象月より前の企業
// - 金額: 基本 39,800円 ＋ 追加担当者 4,000円 ×（有効担当者数 − 席数、下限0）。年払いは更新月のみ基本料金
//   ※ 担当者数は生成時点の有効担当者数で算定する（前月末時点の人数の履歴は持たないため）
// - 請求書は企業コンソール /billing で閲覧・印刷でき、代表（OWNER）へメール通知する
// - 入金消込（PAID）・取消（VOID）は運営のみ。成約手数料の invoices とは別テーブル

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { sendMail, appBaseUrl } from "@/server/mail";
import { calcPlanInvoice, dueDateOf, invoiceNumberOf } from "@/server/billing/plan-fee";

export type GenerateSummary = { month: string; created: number; skipped: number; invoices: { companyId: string; invoiceNumber: string; totalYen: number }[] };

export async function generatePlanInvoices(month: string, now = new Date()): Promise<GenerateSummary | { error: { code: "VALIDATION_ERROR"; message: string } }> {
  if (!/^\d{4}-\d{2}$/.test(month))
    return { error: { code: "VALIDATION_ERROR", message: "対象月は YYYY-MM 形式で指定してください" } };
  const companies = await prisma.company.findMany({
    where: { status: "ACTIVE", plan: "PRO", paymentMethod: "INVOICE" },
    include: { _count: { select: { members: { where: { status: "ACTIVE" } } } } },
  });
  const existing = new Set(
    (await prisma.planInvoice.findMany({ where: { month }, select: { companyId: true } })).map((i) => i.companyId)
  );
  const seqStart = await prisma.planInvoice.count({ where: { month } });
  const summary: GenerateSummary = { month, created: 0, skipped: 0, invoices: [] };
  let seq = seqStart;
  for (const co of companies) {
    if (existing.has(co.id)) {
      summary.skipped++;
      continue;
    }
    // 期限切れ PRO は対象外（effectivePlan と同じ判定）
    if (co.planExpiresAt && co.planExpiresAt < now) {
      summary.skipped++;
      continue;
    }
    const calc = calcPlanInvoice({
      plan: co.plan,
      billingCycle: co.planBillingCycle,
      paymentMethod: co.paymentMethod,
      planSeats: co.planSeats,
      activeMembers: co._count.members,
      planStartedAt: co.planStartedAt,
      month,
    });
    if (!calc) {
      summary.skipped++;
      continue;
    }
    seq++;
    const invoice = await prisma.planInvoice.create({
      data: {
        companyId: co.id,
        month,
        invoiceNumber: invoiceNumberOf(month, seq),
        plan: co.plan,
        billingCycle: co.planBillingCycle,
        seats: co.planSeats,
        activeMembers: co._count.members,
        extraSeats: calc.extraSeats,
        baseYen: calc.baseYen,
        extraYen: calc.extraYen,
        amountExTaxYen: calc.amountExTaxYen,
        taxYen: calc.taxYen,
        totalYen: calc.totalYen,
        dueAt: dueDateOf(month),
        issuedAt: now,
      },
    });
    await audit({
      tenantCompanyId: co.id,
      action: "PlanInvoiceIssued",
      targetType: "PlanInvoice",
      targetId: invoice.id,
      metadata: { month, invoiceNumber: invoice.invoiceNumber, totalYen: invoice.totalYen, extraSeats: invoice.extraSeats },
    });
    await notifyOwners(co.id, co.name, invoice.id, invoice.invoiceNumber, invoice.totalYen, month);
    summary.created++;
    summary.invoices.push({ companyId: co.id, invoiceNumber: invoice.invoiceNumber, totalYen: invoice.totalYen });
  }
  return summary;
}

async function notifyOwners(companyId: string, companyName: string, invoiceId: string, invoiceNumber: string, totalYen: number, month: string) {
  try {
    const owners = await prisma.companyMember.findMany({
      where: { companyId, status: "ACTIVE", roles: { some: { role: "OWNER" } } },
      include: { userAccount: true },
    });
    await Promise.all(
      owners.map((m) =>
        sendMail({
          to: m.userAccount.email,
          subject: `【SES DirectMatch】PRO 版 ${month} 分の請求書を発行しました（${invoiceNumber}）`,
          body: `${m.userAccount.name} 様（${companyName}）

PRO 版 ${month} 分のご請求書を発行しました。
請求書番号: ${invoiceNumber}
ご請求金額（税込）: ${totalYen.toLocaleString()}円
お支払期限: 翌月末日

請求書は企業コンソールの会社マイページ「プラン・請求」からご確認・印刷いただけます。
${appBaseUrl()}/billing/plan-invoices/${invoiceId}`,
        })
      )
    );
  } catch (e) {
    console.error(`[mail] PRO 請求書の通知に失敗 invoiceId=${invoiceId}`, e);
  }
}

export async function listPlanInvoicesByOperations(month?: string) {
  const invoices = await prisma.planInvoice.findMany({
    where: month ? { month } : {},
    orderBy: [{ month: "desc" }, { invoiceNumber: "asc" }],
    take: 500,
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: invoices.map((i) => i.companyId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  return invoices.map((i) => ({ ...i, companyName: nameById.get(i.companyId) ?? "?" }));
}

export async function markPlanInvoicePaid(id: string, paidAt = new Date()) {
  const inv = await prisma.planInvoice.findUnique({ where: { id } });
  if (!inv) return { error: { code: "NOT_FOUND" as const } };
  if (inv.status === "VOID") return { error: { code: "VERSION_CONFLICT" as const, message: "取消済みの請求書です" } };
  const updated = await prisma.planInvoice.update({ where: { id }, data: { status: "PAID", paidAt } });
  await audit({ tenantCompanyId: inv.companyId, action: "PlanInvoicePaid", targetType: "PlanInvoice", targetId: id, metadata: { invoiceNumber: inv.invoiceNumber } });
  return { ok: true, invoice: updated };
}

export async function voidPlanInvoice(id: string) {
  const inv = await prisma.planInvoice.findUnique({ where: { id } });
  if (!inv) return { error: { code: "NOT_FOUND" as const } };
  if (inv.status === "PAID") return { error: { code: "VERSION_CONFLICT" as const, message: "入金済みの請求書は取消できません" } };
  const updated = await prisma.planInvoice.update({ where: { id }, data: { status: "VOID", voidedAt: new Date() } });
  await audit({ tenantCompanyId: inv.companyId, action: "PlanInvoiceVoided", targetType: "PlanInvoice", targetId: id, metadata: { invoiceNumber: inv.invoiceNumber } });
  return { ok: true, invoice: updated };
}

// 企業側: 自社の PRO 請求書（テナント分離）。取消済みも履歴として返す
export async function listOwnPlanInvoices(auth: AuthContext) {
  return prisma.planInvoice.findMany({ where: { companyId: auth.companyId }, orderBy: { month: "desc" } });
}

export async function getOwnPlanInvoice(auth: AuthContext, id: string) {
  const inv = await prisma.planInvoice.findFirst({ where: { id, companyId: auth.companyId } });
  if (!inv) return null;
  const company = await prisma.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { name: true } });
  return { ...inv, companyName: company.name };
}
