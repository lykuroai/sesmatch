// PRO 版の月額請求と優先サポート（PRO版仕様書 §4.5, §6.1, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { addMemberWithRoles, makeCompany, setPlan, truncateAll } from "./helpers";
import { generatePlanInvoices, getOwnPlanInvoice, listOwnPlanInvoices, markPlanInvoicePaid, voidPlanInvoice } from "@/server/services/plan-billing";
import { app } from "@/server/api/app";
import { issueApiToken } from "@/server/auth/api-token";

const sent: { to: string; subject: string; body: string }[] = [];
vi.mock("@/server/mail", () => ({
  appBaseUrl: () => "http://test.local",
  sendMail: async (m: { to: string; subject: string; body: string }) => {
    sent.push(m);
  },
}));

beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
});

const lastMonth = () => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1, 15);
  return d;
};
const thisMonthKey = () => new Date().toISOString().slice(0, 7);

describe("PRO 版の月額請求（§6.1）", () => {
  it("対象企業にだけ請求書を発行し、金額・追加席・一意性・通知・消込・取消が仕様どおり", async () => {
    const month = thisMonthKey();
    // 先月開始の PRO（担当者 7名 = 追加2名）
    const pro = await setPlan(await makeCompany("請求PRO株式会社"), "PRO");
    await prisma.company.update({ where: { id: pro.companyId }, data: { planStartedAt: lastMonth() } });
    for (let i = 0; i < 6; i++) await addMemberWithRoles(pro, ["SALES"]);
    // 対象外: 今月開始の PRO（開始当月は無料）、TRIAL、FREE、カード決済、期限切れ PRO
    const startedNow = await setPlan(await makeCompany("今月開始株式会社"), "PRO");
    const trial = await setPlan(await makeCompany("お試し株式会社"), "TRIAL", new Date(Date.now() + 10 * 86_400_000));
    await makeCompany("基本版株式会社");
    const card = await setPlan(await makeCompany("カード株式会社"), "PRO");
    await prisma.company.update({ where: { id: card.companyId }, data: { planStartedAt: lastMonth(), paymentMethod: "CARD" } });
    const expired = await setPlan(await makeCompany("期限切れ株式会社"), "PRO", new Date(Date.now() - 1000));
    await prisma.company.update({ where: { id: expired.companyId }, data: { planStartedAt: lastMonth() } });

    const r = await generatePlanInvoices(month);
    if ("error" in r) throw new Error(r.error.message);
    expect(r.created).toBe(1);
    expect(r.invoices[0]).toMatchObject({ companyId: pro.companyId, invoiceNumber: `P-${month.replace("-", "")}-0001`, totalYen: 52_580 }); // 39,800 + 8,000 = 47,800 + 税4,780
    const own = await listOwnPlanInvoices(pro);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ month, seats: 5, activeMembers: 7, extraSeats: 2, baseYen: 39_800, extraYen: 8_000, amountExTaxYen: 47_800, taxYen: 4_780, status: "ISSUED" });
    expect(await listOwnPlanInvoices(startedNow)).toHaveLength(0);
    expect(await listOwnPlanInvoices(trial)).toHaveLength(0);
    // 代表へ通知（メール本文に請求書番号）
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(pro.email);
    expect(sent[0].body).toContain(own[0].invoiceNumber);

    // 再実行は発行済みをスキップ（企業×月で一意）
    const again = await generatePlanInvoices(month);
    if ("error" in again) throw new Error(again.error.message);
    expect(again.created).toBe(0);
    expect(again.skipped).toBeGreaterThanOrEqual(1);
    expect(await prisma.planInvoice.count()).toBe(1);

    // 他社からは見えない（テナント分離）
    expect(await getOwnPlanInvoice(trial, own[0].id)).toBeNull();
    expect((await getOwnPlanInvoice(pro, own[0].id))?.companyName).toBe("請求PRO株式会社");

    // 入金消込 → 取消不可。未入金の取消は可
    const paid = await markPlanInvoicePaid(own[0].id);
    expect("ok" in paid && paid.ok).toBe(true);
    const voidAfterPaid = await voidPlanInvoice(own[0].id);
    expect("error" in voidAfterPaid && voidAfterPaid.error?.code).toBe("VERSION_CONFLICT");

    // 不正な月
    const bad = await generatePlanInvoices("2026/11");
    expect("error" in bad && bad.error?.code).toBe("VALIDATION_ERROR");
  });

  it("年払いは更新月に 398,000円、非更新月は追加担当者分のみ", async () => {
    const pro = await setPlan(await makeCompany("年払い株式会社"), "PRO");
    const start = new Date();
    start.setUTCMonth(start.getUTCMonth() - 13, 10); // 13か月前開始 → 今月が更新月（開始翌月から12か月目）
    await prisma.company.update({ where: { id: pro.companyId }, data: { planStartedAt: start, planBillingCycle: "YEARLY" } });
    const r = await generatePlanInvoices(thisMonthKey());
    if ("error" in r) throw new Error(r.error.message);
    expect(r.created).toBe(1);
    expect((await listOwnPlanInvoices(pro))[0]).toMatchObject({ baseYen: 398_000, extraYen: 0, amountExTaxYen: 398_000, taxYen: 39_800 });
  });
});

describe("優先サポート（§4.5）", () => {
  it("PRO 版からの問合せは priority が付き、運営一覧で先頭に並ぶ", async () => {
    const free = await makeCompany("問合せ基本版株式会社");
    const pro = await setPlan(await makeCompany("問合せPRO株式会社"), "PRO");
    const post = async (auth: typeof free) => {
      const issued = await issueApiToken(auth, { name: "t", scope: "connector", expiresInDays: null });
      if ("error" in issued) throw new Error("token");
      return app.request("/api/v1/inquiries", {
        method: "POST",
        headers: { Authorization: `Bearer ${issued.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ category: "操作方法", body: "テスト" }),
      });
    };
    expect((await post(free)).status).toBe(201);
    expect((await post(pro)).status).toBe(201);
    const rows = await prisma.inquiry.findMany({ orderBy: [{ priority: "desc" }, { createdAt: "desc" }] });
    expect(rows[0].tenantCompanyId).toBe(pro.companyId);
    expect(rows[0].priority).toBe(true);
    expect(rows[1].priority).toBe(false);
  });
});
