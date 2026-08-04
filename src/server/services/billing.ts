// 請求・入金（§23）。手数料は需要側企業負担。

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { calcTax } from "@/server/billing/fee";
import { ensureWorkMonths } from "./contracts";

export async function listFees(auth: AuthContext) {
  // 需要側の稼働中契約の月次手数料を最新化してから返す（自動計算 §23）
  const active = await prisma.contract.findMany({
    where: { status: "ACTIVE", demandCompanyId: auth.companyId },
  });
  for (const c of active) await ensureWorkMonths(c);
  return prisma.platformFee.findMany({
    where: { demandCompanyId: auth.companyId },
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
  });
}

// 請求画面用の明細（案件×人材のタイトル付き）。需要側企業は契約段階（Level 3）のため実名表示可
export async function listFeesDetailed(auth: AuthContext) {
  const fees = await listFees(auth);
  const [projects, engineers] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: [...new Set(fees.map((f) => f.projectId))] } },
      select: { id: true, code: true, name: true },
    }),
    prisma.engineer.findMany({
      where: { id: { in: [...new Set(fees.map((f) => f.engineerId))] } },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const pj = new Map(projects.map((p) => [p.id, p]));
  const en = new Map(engineers.map((e) => [e.id, e]));
  return fees.map((f) => ({
    id: f.id,
    month: f.month,
    createdAt: f.createdAt,
    title: `${pj.get(f.projectId)?.code ?? ""} ${pj.get(f.projectId)?.name ?? ""} ／ ${en.get(f.engineerId)?.code ?? ""} ${en.get(f.engineerId)?.name ?? ""}`.trim(),
    baseAmountYen: f.baseAmountYen,
    feeExTaxYen: f.feeExTaxYen,
    status: f.status,
    invoiceId: f.invoiceId,
  }));
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

    const base = await tx.invoice.upsert({
      where: { demandCompanyId_month: { demandCompanyId: auth.companyId, month } },
      create: { demandCompanyId: auth.companyId, month, feeExTaxYen: 0, taxYen: 0, totalYen: 0 },
      update: {},
    });
    await tx.platformFee.updateMany({
      where: { id: { in: fees.map((f) => f.id) } },
      data: { invoiceId: base.id },
    });
    // 正式な税額は請求書単位で月計に対して1回だけ端数処理する（インボイス制度の端数処理ルール）。
    // 明細行ごとの消費税は画面の確認用であり、合算しない
    const attached = await tx.platformFee.findMany({
      where: { invoiceId: base.id, status: "CHARGED" },
    });
    const feeExTaxYen = attached.reduce((a, f) => a + f.feeExTaxYen, 0);
    const taxYen = calcTax(feeExTaxYen);
    const invoice = await tx.invoice.update({
      where: { id: base.id },
      data: { feeExTaxYen, taxYen, totalYen: feeExTaxYen + taxYen },
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

// 請求書帳票（§23）: 請求書1件と明細（対象の手数料 + 案件/人材の表示情報）を返す。
// 需要側企業のみ参照可（テナント分離）
export async function getInvoiceDocument(auth: AuthContext, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, demandCompanyId: auth.companyId },
  });
  if (!invoice) return null;
  const [company, fees] = await Promise.all([
    prisma.company.findUnique({ where: { id: invoice.demandCompanyId } }),
    prisma.platformFee.findMany({
      // キャンセル（14日以内終了）・無料は請求書に載せない。金額も課金分のみで再計算する
      where: { invoiceId: invoice.id, status: "CHARGED" },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const [projects, engineers] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: fees.map((f) => f.projectId) } },
      select: { id: true, code: true, name: true },
    }),
    prisma.engineer.findMany({
      where: { id: { in: fees.map((f) => f.engineerId) } },
      select: { id: true, code: true, name: true }, // 契約段階は Level 3（§10）: 需要側に氏名開示済み
    }),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const engineerById = new Map(engineers.map((e) => [e.id, e]));
  // 表示金額は課金明細（返金除外後）から再計算する（発行後の返金を反映）
  const feeExTaxYen = fees.reduce((a, f) => a + f.feeExTaxYen, 0);
  const taxYen = calcTax(feeExTaxYen);
  return {
    id: invoice.id,
    month: invoice.month,
    feeExTaxYen,
    taxYen,
    totalYen: feeExTaxYen + taxYen,
    status: invoice.status,
    issuedAt: invoice.issuedAt,
    paidAt: invoice.paidAt,
    companyName: company?.name ?? "",
    lines: fees.map((f) => ({
      id: f.id,
      month: f.month,
      projectLabel: projectById.get(f.projectId)
        ? `${projectById.get(f.projectId)!.code} ${projectById.get(f.projectId)!.name}`
        : "-",
      engineerLabel: engineerById.get(f.engineerId)
        ? `${engineerById.get(f.engineerId)!.code} ${engineerById.get(f.engineerId)!.name}`
        : "-",
      baseAmountYen: f.baseAmountYen,
      feeExTaxYen: f.feeExTaxYen,
      chargeableMonthIndex: f.chargeableMonthIndex,
      status: f.status,
    })),
  };
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
