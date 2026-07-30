// 請求・入金（§23）。手数料は需要側企業負担。

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { calcTax } from "@/server/billing/fee";

export async function listFees(auth: AuthContext) {
  return prisma.platformFee.findMany({
    where: { demandCompanyId: auth.companyId },
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
  });
}

export async function listInvoices(auth: AuthContext) {
  return prisma.invoice.findMany({
    where: { demandCompanyId: auth.companyId },
    orderBy: { month: "desc" },
  });
}

// 対象月の未請求 CHARGED 手数料を集計して請求書を発行する
export async function generateInvoice(auth: AuthContext, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month))
    return { error: { code: "VALIDATION_ERROR" as const, message: "対象月は YYYY-MM 形式で指定してください" } };

  return prisma.$transaction(async (tx) => {
    const fees = await tx.platformFee.findMany({
      where: { demandCompanyId: auth.companyId, month, status: "CHARGED", invoiceId: null },
    });
    if (fees.length === 0)
      return { error: { code: "NOT_FOUND" as const, message: "対象月の未請求手数料がありません" } };

    const feeExTaxYen = fees.reduce((a, f) => a + f.feeExTaxYen, 0);
    const taxYen = calcTax(feeExTaxYen);
    const invoice = await tx.invoice.upsert({
      where: { demandCompanyId_month: { demandCompanyId: auth.companyId, month } },
      create: {
        demandCompanyId: auth.companyId,
        month,
        feeExTaxYen,
        taxYen,
        totalYen: feeExTaxYen + taxYen,
      },
      update: {
        feeExTaxYen: { increment: feeExTaxYen },
        taxYen: { increment: taxYen },
        totalYen: { increment: feeExTaxYen + taxYen },
      },
    });
    await tx.platformFee.updateMany({
      where: { id: { in: fees.map((f) => f.id) } },
      data: { invoiceId: invoice.id },
    });
    await audit({
      tenantCompanyId: auth.companyId,
      actorUserId: auth.userAccountId,
      action: "InvoiceIssued",
      targetType: "Invoice",
      targetId: invoice.id,
      metadata: { month, feeCount: fees.length, totalYen: invoice.totalYen },
    });
    return { invoice };
  });
}

// 入金記録
export async function markInvoicePaid(auth: AuthContext, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, demandCompanyId: auth.companyId },
  });
  if (!invoice) return { error: { code: "NOT_FOUND" as const } };
  if (invoice.status === "PAID")
    return { error: { code: "VERSION_CONFLICT" as const, message: "既に入金済みです" } };
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "PAID", paidAt: new Date() },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "InvoicePaid",
    targetType: "Invoice",
    targetId: invoiceId,
  });
  return { ok: true as const };
}
