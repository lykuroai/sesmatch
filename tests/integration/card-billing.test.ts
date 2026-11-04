// カード決済（PRO版仕様書 §4.15, §13）の統合テスト。Stripe の Webhook イベントを模擬して状態遷移を検証する。専用DB sesmatch_test
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll } from "./helpers";
import { Stripe } from "@/server/billing/stripe";
import { handleStripeEvent, CARD_GRACE_DAYS } from "@/server/services/card-billing";
import { generatePlanInvoices } from "@/server/services/plan-billing";
import { updateCompanyPlanByOperations } from "@/server/services/companies";
import { effectivePlan } from "@/server/plan/features";
import { app } from "@/server/api/app";

const sent: { to: string; subject: string }[] = [];
vi.mock("@/server/mail", () => ({
  appBaseUrl: () => "http://test.local",
  sendMail: async (m: { to: string; subject: string }) => {
    sent.push(m);
  },
}));

beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
});

const ev = (type: string, object: Record<string, unknown>) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } }) as unknown as Stripe.Event;
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

async function subscribe(companyId: string, cycle: "MONTHLY" | "YEARLY" = "MONTHLY") {
  const r = await handleStripeEvent(
    ev("checkout.session.completed", { id: "cs_1", customer: `cus_${companyId}`, subscription: `sub_${companyId}`, metadata: { companyId, cycle } })
  );
  expect(r.handled).toBe(true);
}

describe("カード決済の状態遷移", () => {
  it("Checkout 完了で PRO・CARD になり、同じイベントの再送は無害", async () => {
    const owner = await makeCompany("カード株式会社");
    await subscribe(owner.companyId, "YEARLY");
    const co = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    expect(co).toMatchObject({ plan: "PRO", paymentMethod: "CARD", planBillingCycle: "YEARLY", stripeCustomerId: `cus_${owner.companyId}`, stripeSubscriptionId: `sub_${owner.companyId}` });
    expect(co.planStartedAt).not.toBeNull();
    expect(sent.some((m) => m.to === owner.email && m.subject.includes("お申込"))).toBe(true);
    await subscribe(owner.companyId, "YEARLY");
    expect(await prisma.auditEvent.count({ where: { tenantCompanyId: owner.companyId, action: "PlanChangedByCard" } })).toBe(1);
  });

  it("請求書の支払いで plan_invoices に同期し、決済失敗→14日猶予→入金で復帰、解約で FREE", async () => {
    const owner = await makeCompany("カード株式会社");
    await subscribe(owner.companyId);
    const customer = `cus_${owner.companyId}`;
    const periodStart = new Date("2026-11-30T15:00:00Z"); // 12/1 0:00 JST
    const invoice = {
      id: "in_1",
      number: "ABCD-0001",
      customer,
      total: 43780,
      subtotal: 39800,
      subtotal_excluding_tax: 39800,
      created: sec(periodStart),
      due_date: null,
      hosted_invoice_url: "https://invoice.stripe.test/in_1",
      metadata: {},
      lines: {
        data: [{ amount: 39800, metadata: {}, parent: { type: "subscription_item_details" }, period: { start: sec(periodStart), end: sec(new Date("2026-12-31T15:00:00Z")) } }],
      },
      parent: { subscription_details: { subscription: `sub_${owner.companyId}`, metadata: { cycle: "MONTHLY" } } },
    };
    expect((await handleStripeEvent(ev("invoice.paid", invoice))).handled).toBe(true);
    const synced = await prisma.planInvoice.findUniqueOrThrow({ where: { stripeInvoiceId: "in_1" } });
    expect(synced).toMatchObject({ companyId: owner.companyId, month: "2026-12", status: "PAID", invoiceNumber: "ABCD-0001", baseYen: 39800, extraYen: 0, taxYen: 3980, totalYen: 43780, stripeHostedUrl: "https://invoice.stripe.test/in_1" });
    // 再送しても1件のまま
    await handleStripeEvent(ev("invoice.paid", invoice));
    expect(await prisma.planInvoice.count({ where: { companyId: owner.companyId } })).toBe(1);

    // 追加担当者の行を含む請求書（翌月）
    const nextStart = new Date("2026-12-31T15:00:00Z");
    const invoice2 = {
      ...invoice,
      id: "in_2",
      number: "ABCD-0002",
      total: 52580,
      subtotal: 47800,
      subtotal_excluding_tax: 47800,
      created: sec(nextStart),
      lines: {
        data: [
          { amount: 39800, metadata: {}, parent: { type: "subscription_item_details" }, period: { start: sec(nextStart), end: sec(nextStart) + 86400 } },
          { amount: 8000, metadata: { kind: "extra_seats", extraSeats: "2", month: "2027-01" }, parent: { type: "invoice_item_details" }, period: { start: sec(nextStart) - 100, end: sec(nextStart) } },
        ],
      },
    };
    await handleStripeEvent(ev("invoice.paid", invoice2));
    expect(await prisma.planInvoice.findUniqueOrThrow({ where: { stripeInvoiceId: "in_2" } })).toMatchObject({ month: "2027-01", baseYen: 39800, extraYen: 8000, extraSeats: 2, activeMembers: 7, taxYen: 4780, totalYen: 52580 });

    // 決済失敗 → 猶予（planExpiresAt = 失敗日 + 14 日）
    const failedAt = new Date("2027-02-01T00:00:00Z");
    expect((await handleStripeEvent(ev("invoice.payment_failed", { ...invoice, id: "in_3" }), failedAt)).handled).toBe(true);
    let co = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    expect(co.cardPaymentFailedAt?.toISOString()).toBe(failedAt.toISOString());
    expect(co.planExpiresAt?.getTime()).toBe(failedAt.getTime() + CARD_GRACE_DAYS * 86_400_000);
    expect(effectivePlan(co, new Date(failedAt.getTime() + 13 * 86_400_000))).toBe("PRO");
    expect(effectivePlan(co, new Date(failedAt.getTime() + 15 * 86_400_000))).toBe("FREE");
    expect(sent.some((m) => m.subject.includes("失敗"))).toBe(true);
    // 2回目の失敗は猶予を延ばさない
    await handleStripeEvent(ev("invoice.payment_failed", { ...invoice, id: "in_3" }), new Date(failedAt.getTime() + 3 * 86_400_000));
    co = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    expect(co.cardPaymentFailedAt?.toISOString()).toBe(failedAt.toISOString());

    // 入金で復帰
    await handleStripeEvent(ev("invoice.paid", { ...invoice, id: "in_3", number: "ABCD-0003", created: sec(new Date("2027-01-31T15:00:00Z")), lines: { data: [{ amount: 39800, metadata: {}, parent: { type: "subscription_item_details" }, period: { start: sec(new Date("2027-01-31T15:00:00Z")), end: 0 } }] } }));
    co = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    expect(co.cardPaymentFailedAt).toBeNull();
    expect(co.planExpiresAt).toBeNull();
    expect(co.plan).toBe("PRO");

    // 解約（期末到来）→ FREE。データは残る
    expect((await handleStripeEvent(ev("customer.subscription.deleted", { id: `sub_${owner.companyId}`, customer }))).handled).toBe(true);
    co = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    expect(co).toMatchObject({ plan: "FREE", stripeSubscriptionId: null, stripeCustomerId: customer });
    expect(await prisma.planInvoice.count({ where: { companyId: owner.companyId } })).toBe(3);
    expect(sent.some((m) => m.subject.includes("基本版へ"))).toBe(true);
  });

  it("CARD と INVOICE の二重請求が起きない（月次生成は CARD を除外、運営はプラン・決済方法を変えられない）", async () => {
    const card = await makeCompany("カード株式会社");
    await subscribe(card.companyId);
    await prisma.company.update({ where: { id: card.companyId }, data: { planStartedAt: new Date("2026-09-01T00:00:00Z") } });
    const invoiceCo = await setPlan(await makeCompany("請求書株式会社"), "PRO");
    await prisma.company.update({ where: { id: invoiceCo.companyId }, data: { planStartedAt: new Date("2026-09-01T00:00:00Z") } });
    const r = await generatePlanInvoices("2026-11");
    if ("error" in r) throw new Error(r.error.message);
    expect(r.invoices.map((i) => i.companyId)).toEqual([invoiceCo.companyId]);
    expect(await updateCompanyPlanByOperations(card.companyId, { plan: "FREE" })).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    expect(await updateCompanyPlanByOperations(card.companyId, { plan: "PRO", paymentMethod: "INVOICE" })).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    // 席数の変更は可
    expect(await updateCompanyPlanByOperations(card.companyId, { plan: "PRO", planSeats: 8 })).not.toHaveProperty("error");
  });

  it("受信 Webhook は署名検証に失敗すると 400、成功すると処理する", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.STRIPE_PRICE_MONTHLY = "price_m";
    process.env.STRIPE_PRICE_YEARLY = "price_y";
    try {
      const owner = await makeCompany("Webhook株式会社");
      const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_1", customer: "cus_w", subscription: "sub_w", metadata: { companyId: owner.companyId, cycle: "MONTHLY" } } } });
      const bad = await app.request("/api/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": "t=1,v1=bad" }, body: payload });
      expect(bad.status).toBe(400);
      expect((await bad.json()).error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
      const ok = await app.request("/api/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header }, body: payload });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ received: true, handled: true });
      expect((await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } })).plan).toBe("PRO");
    } finally {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_PRICE_MONTHLY;
      delete process.env.STRIPE_PRICE_YEARLY;
    }
  });
});
