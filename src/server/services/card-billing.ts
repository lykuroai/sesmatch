// カード決済（Stripe サブスクリプション。PRO版仕様書 §4.15, §6.2）
//
// - Checkout で PRO（月払い／年払い）を開始する。請求周期は翌月1日（JST）に固定し、開始当月は無料（日割りなし）
// - 追加担当者は月末（JST の最終日 12 時以降）に有効担当者数を数え、超過分 × 4,000円（税別）を
//   保留中の請求項目として Stripe に送る。月払いは翌月1日の更新請求書に合算、年払いの非更新月は単独の請求書を起こす
// - Stripe の請求書が支払われたら plan_invoices に同期（PAID）し、企業コンソール /billing から Stripe の請求書ページを開ける
// - 決済失敗: 代表へメール → 14 日の猶予（planExpiresAt を失敗日+14日に設定。期限切れは要求ごとに FREE 扱い）
//   → 入金で解消（planExpiresAt を戻す）。サブスクリプション解約（期末到来）で FREE へ。データは削除しない
// - 二重請求防止: 請求書払いの月次生成は paymentMethod=INVOICE のみ対象。Stripe 契約中の企業は運営のプラン変更を制限する
// - 冪等性: Stripe の Webhook は再送されるため、各処理は同じイベントを複数回受けても結果が変わらないようにする

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { appBaseUrl, sendMail } from "@/server/mail";
import { effectivePlan } from "@/server/plan/features";
import { calcTax } from "@/server/billing/fee";
import { EXTRA_SEAT_YEN } from "@/server/billing/plan-fee";
import { getStripe, isStripeConfigured, stripeEnv, type Stripe } from "@/server/billing/stripe";

export const CARD_GRACE_DAYS = 14;
const JST_OFFSET_MS = 9 * 3600_000;

// ---- 日付（JST）の純粋ヘルパー ----

export function nextMonthStartJst(now: Date): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 1) - JST_OFFSET_MS);
}
export function monthKeyJst(d: Date): string {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function isLastDayOfMonthJst(now: Date): boolean {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const next = new Date(jst.getTime() + 86_400_000);
  return next.getUTCMonth() !== jst.getUTCMonth();
}
export const jstHour = (now: Date) => new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();

// 年払いの更新月か（開始翌月を1か月目として 12 か月ごと）。plan-fee.ts の YEARLY 判定と同じ
export function isYearlyRenewalMonth(planStartedAt: Date, month: string): boolean {
  const idx = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return y * 12 + (m - 1);
  };
  const diff = idx(month) - idx(monthKeyJst(planStartedAt)) - 1;
  return diff >= 0 && diff % 12 === 0;
}

const NOT_AVAILABLE = { error: { code: "CARD_NOT_AVAILABLE" as const, message: "カード決済は現在ご利用いただけません（請求書払いをご利用ください）" } };

// ---- Checkout（PRO の申込）----

export async function createCheckoutSession(auth: AuthContext, cycle: "MONTHLY" | "YEARLY", now = new Date()) {
  const env = stripeEnv();
  if (!env) return NOT_AVAILABLE;
  const company = await prisma.company.findUniqueOrThrow({ where: { id: auth.companyId } });
  if (company.stripeSubscriptionId)
    return { error: { code: "VERSION_CONFLICT" as const, message: "既にカード決済で契約中です。変更・解約は「お支払い方法の管理」から行ってください" } };
  if (company.plan === "PRO" && company.paymentMethod === "INVOICE" && effectivePlan(company, now) === "PRO")
    return { error: { code: "VERSION_CONFLICT" as const, message: "請求書払いで PRO 版をご契約中です。カード決済への切替はお問合せからご依頼ください（二重請求を防ぐため）" } };
  const stripe = getStripe();
  let customerId = company.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ name: company.name, email: auth.email, metadata: { companyId: company.id } });
    customerId = customer.id;
    await prisma.company.update({ where: { id: company.id }, data: { stripeCustomerId: customerId } });
  }
  const anchor = Math.floor(nextMonthStartJst(now).getTime() / 1000);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: cycle === "YEARLY" ? env.priceYearly : env.priceMonthly, quantity: 1 }],
    subscription_data: {
      billing_cycle_anchor: anchor,
      proration_behavior: "none",
      metadata: { companyId: company.id, cycle },
      ...(env.taxRateId ? { default_tax_rates: [env.taxRateId] } : {}),
    },
    metadata: { companyId: company.id, cycle },
    locale: "ja",
    success_url: `${appBaseUrl()}/billing?checkout=success`,
    cancel_url: `${appBaseUrl()}/billing?checkout=cancel`,
  });
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "CardCheckoutStarted", targetType: "Company", targetId: auth.companyId, metadata: { cycle } });
  return { url: session.url };
}

// Customer Portal（カード変更・解約・請求書閲覧）
export async function createPortalSession(auth: AuthContext) {
  if (!isStripeConfigured()) return NOT_AVAILABLE;
  const company = await prisma.company.findUniqueOrThrow({ where: { id: auth.companyId } });
  if (!company.stripeCustomerId) return { error: { code: "NOT_FOUND" as const, message: "カード決済の契約がありません" } };
  const session = await getStripe().billingPortal.sessions.create({ customer: company.stripeCustomerId, return_url: `${appBaseUrl()}/billing` });
  return { url: session.url };
}

export async function getCardBillingStatus(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { paymentMethod: true, stripeCustomerId: true, stripeSubscriptionId: true, cardPaymentFailedAt: true, planExpiresAt: true },
  });
  return {
    available: isStripeConfigured(),
    subscribed: !!c.stripeSubscriptionId,
    hasCustomer: !!c.stripeCustomerId,
    paymentFailedAt: c.cardPaymentFailedAt,
    graceUntil: c.cardPaymentFailedAt ? c.planExpiresAt : null,
  };
}

// ---- Webhook 受信（署名検証は API 層。ここは検証済みイベントを処理）----

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

export async function handleStripeEvent(event: Stripe.Event, now = new Date()): Promise<{ handled: boolean; note?: string }> {
  switch (event.type) {
    case "checkout.session.completed":
      return onCheckoutCompleted(event.data.object, now);
    case "invoice.paid":
      return onInvoicePaid(event.data.object, now);
    case "invoice.payment_failed":
      return onInvoicePaymentFailed(event.data.object, now);
    case "customer.subscription.deleted":
      return onSubscriptionDeleted(event.data.object, now);
    default:
      return { handled: false, note: `ignored: ${event.type}` };
  }
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session, now: Date) {
  const companyId = session.metadata?.companyId;
  const subscriptionId = idOf(session.subscription);
  const customerId = idOf(session.customer);
  if (!companyId || !subscriptionId || !customerId) return { handled: false, note: "metadata/subscription missing" };
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { handled: false, note: "company not found" };
  if (company.stripeSubscriptionId === subscriptionId) return { handled: true, note: "already applied" };
  const cycle = session.metadata?.cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  await prisma.company.update({
    where: { id: companyId },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      plan: "PRO",
      planStartedAt: company.plan === "PRO" && company.planStartedAt ? company.planStartedAt : now,
      planExpiresAt: null,
      paymentMethod: "CARD",
      planBillingCycle: cycle,
      cardPaymentFailedAt: null,
    },
  });
  await audit({ tenantCompanyId: companyId, action: "PlanChangedByCard", targetType: "Company", targetId: companyId, metadata: { plan: "PRO", cycle, eventId: event_id(session) } });
  await notifyOwners(
    companyId,
    "【SES DirectMatch】PRO 版（カード決済）のお申込を受け付けました",
    (name) => `${name} 様（${company.name}）

PRO 版（${cycle === "YEARLY" ? "年払い" : "月払い"}・カード決済）のお申込を受け付けました。本日から PRO 機能をご利用いただけます。
開始当月は無料で、翌月1日から請求が始まります（日割りなし）。
お支払い方法の変更・解約・請求書の確認は企業コンソールの会社マイページ「プラン・請求」から行えます。
${appBaseUrl()}/billing`
  );
  return { handled: true };
}

function invoiceMonth(invoice: Stripe.Invoice): string {
  if (invoice.metadata?.month && /^\d{4}-\d{2}$/.test(invoice.metadata.month)) return invoice.metadata.month;
  const subLine = invoice.lines?.data?.find((l) => l.parent?.type === "subscription_item_details");
  if (subLine?.period?.start) return monthKeyJst(new Date(subLine.period.start * 1000));
  const seatLine = invoice.lines?.data?.find((l) => l.metadata?.month);
  if (seatLine?.metadata?.month) return seatLine.metadata.month;
  return monthKeyJst(new Date((invoice.period_end || invoice.created) * 1000));
}

async function companyOfInvoice(invoice: Stripe.Invoice) {
  const customerId = idOf(invoice.customer);
  if (!customerId) return null;
  return prisma.company.findUnique({ where: { stripeCustomerId: customerId } });
}

async function onInvoicePaid(invoice: Stripe.Invoice, now: Date) {
  const company = await companyOfInvoice(invoice);
  if (!company) return { handled: false, note: "company not found" };
  if (!invoice.total || invoice.total <= 0) {
    // 申込時の 0 円請求書など。決済失敗の解消だけ反映する
    if (company.cardPaymentFailedAt) await prisma.company.update({ where: { id: company.id }, data: { cardPaymentFailedAt: null, planExpiresAt: null } });
    return { handled: true, note: "zero amount" };
  }
  const lines = invoice.lines?.data ?? [];
  const extraLines = lines.filter((l) => l.metadata?.kind === "extra_seats");
  const extraYen = extraLines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const extraSeats = extraLines.reduce((s, l) => s + Number(l.metadata?.extraSeats ?? 0), 0);
  const subtotal = invoice.subtotal_excluding_tax ?? invoice.subtotal ?? invoice.total;
  const taxYen = Math.max(0, invoice.total - subtotal);
  const baseYen = Math.max(0, subtotal - extraYen);
  const month = invoiceMonth(invoice);
  const cycle = invoice.parent?.subscription_details?.metadata?.cycle === "YEARLY" ? "YEARLY" : company.planBillingCycle;
  const data = {
    plan: "PRO" as const,
    billingCycle: cycle,
    seats: company.planSeats,
    activeMembers: company.planSeats + extraSeats,
    extraSeats,
    baseYen,
    extraYen,
    amountExTaxYen: subtotal,
    taxYen,
    totalYen: invoice.total,
    status: "PAID" as const,
    issuedAt: new Date((invoice.created || Math.floor(now.getTime() / 1000)) * 1000),
    dueAt: new Date((invoice.due_date ?? invoice.created ?? Math.floor(now.getTime() / 1000)) * 1000),
    paidAt: now,
    stripeInvoiceId: invoice.id,
    stripeHostedUrl: invoice.hosted_invoice_url ?? null,
  };
  const existing = await prisma.planInvoice.findFirst({ where: { OR: [{ stripeInvoiceId: invoice.id }, { companyId: company.id, month }] } });
  const record = existing
    ? await prisma.planInvoice.update({ where: { id: existing.id }, data })
    : await prisma.planInvoice.create({ data: { companyId: company.id, month, invoiceNumber: invoice.number ?? `S-${invoice.id}`, ...data } });
  // 決済失敗の解消・PRO 継続
  await prisma.company.update({
    where: { id: company.id },
    data: { cardPaymentFailedAt: null, planExpiresAt: null, plan: company.stripeSubscriptionId ? "PRO" : company.plan },
  });
  if (!existing || existing.status !== "PAID")
    await audit({ tenantCompanyId: company.id, action: "PlanInvoicePaid", targetType: "PlanInvoice", targetId: record.id, metadata: { month, totalYen: invoice.total, via: "stripe", stripeInvoiceId: invoice.id } });
  return { handled: true };
}

async function onInvoicePaymentFailed(invoice: Stripe.Invoice, now: Date) {
  const company = await companyOfInvoice(invoice);
  if (!company) return { handled: false, note: "company not found" };
  if (company.cardPaymentFailedAt) return { handled: true, note: "already in grace" };
  const graceUntil = new Date(now.getTime() + CARD_GRACE_DAYS * 86_400_000);
  await prisma.company.update({
    where: { id: company.id },
    data: {
      cardPaymentFailedAt: now,
      planExpiresAt: company.planExpiresAt && company.planExpiresAt < graceUntil ? company.planExpiresAt : graceUntil,
    },
  });
  await audit({ tenantCompanyId: company.id, action: "CardPaymentFailed", targetType: "Company", targetId: company.id, metadata: { stripeInvoiceId: invoice.id, graceUntil: graceUntil.toISOString() } });
  await notifyOwners(
    company.id,
    "【SES DirectMatch】PRO 版のカード決済に失敗しました（14日以内にご対応ください）",
    (name) => `${name} 様（${company.name}）

PRO 版のカード決済に失敗しました。${graceUntil.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} までにお支払いが確認できない場合、基本版（無料）へ自動的に切り替わります（データは削除されません）。
カード情報の更新・再決済は企業コンソールの会社マイページ「プラン・請求 > お支払い方法の管理」から行えます。
${appBaseUrl()}/billing`
  );
  return { handled: true };
}

async function onSubscriptionDeleted(sub: Stripe.Subscription, now: Date) {
  const company = await prisma.company.findFirst({ where: { OR: [{ stripeSubscriptionId: sub.id }, { stripeCustomerId: idOf(sub.customer) ?? "" }] } });
  if (!company) return { handled: false, note: "company not found" };
  if (company.stripeSubscriptionId !== sub.id) return { handled: true, note: "subscription already replaced" };
  await prisma.company.update({
    where: { id: company.id },
    data: { plan: "FREE", planExpiresAt: null, planStartedAt: null, stripeSubscriptionId: null, cardPaymentFailedAt: null },
  });
  await audit({ tenantCompanyId: company.id, action: "PlanChangedByCard", targetType: "Company", targetId: company.id, metadata: { plan: "FREE", reason: "subscription_deleted", at: now.toISOString() } });
  await notifyOwners(
    company.id,
    "【SES DirectMatch】PRO 版の契約が終了し、基本版へ切り替わりました",
    (name) => `${name} 様（${company.name}）

カード決済のサブスクリプションが終了したため、基本版（無料）へ切り替わりました。登録データはそのまま保持されます。
再度 PRO 版をご利用になる場合は企業コンソールの会社マイページ「プラン・請求」からお申込みください。
${appBaseUrl()}/billing`
  );
  return { handled: true };
}

// ---- 追加担当者の使用量報告（月末。内部ジョブから呼ぶ）----

export async function reportExtraSeatsForCardCompanies(now = new Date()): Promise<{ month: string; reported: number; skipped: number }> {
  const billingMonth = monthKeyJst(nextMonthStartJst(now)); // 翌月分の請求に載せる
  const result = { month: billingMonth, reported: 0, skipped: 0 };
  if (!isStripeConfigured()) return result;
  const env = stripeEnv()!;
  const companies = await prisma.company.findMany({
    where: { status: "ACTIVE", paymentMethod: "CARD", plan: "PRO", stripeSubscriptionId: { not: null } },
    include: { _count: { select: { members: { where: { status: "ACTIVE" } } } } },
  });
  for (const co of companies) {
    if (effectivePlan(co, now) !== "PRO" || !co.stripeCustomerId) {
      result.skipped++;
      continue;
    }
    const extraSeats = Math.max(0, co._count.members - co.planSeats);
    if (extraSeats === 0) {
      result.skipped++;
      continue;
    }
    const already = await prisma.auditEvent.findFirst({
      where: { tenantCompanyId: co.id, action: "CardSeatUsageReported", metadata: { path: ["month"], equals: billingMonth } },
      select: { id: true },
    });
    if (already) {
      result.skipped++;
      continue;
    }
    const amountExTax = extraSeats * EXTRA_SEAT_YEN;
    const stripe = getStripe();
    await stripe.invoiceItems.create({
      customer: co.stripeCustomerId,
      currency: "jpy",
      amount: env.taxRateId ? amountExTax : amountExTax + calcTax(amountExTax),
      description: `追加担当者 ${extraSeats}名 × ${EXTRA_SEAT_YEN.toLocaleString()}円（${billingMonth} 分${env.taxRateId ? "・税別" : "・税込"}）`,
      metadata: { companyId: co.id, kind: "extra_seats", month: billingMonth, extraSeats: String(extraSeats) },
      ...(env.taxRateId ? { tax_rates: [env.taxRateId] } : {}),
    });
    // 年払いの非更新月は更新請求書が無いので、単独の請求書を起こす（自動確定・自動課金）
    if (co.planBillingCycle === "YEARLY" && !(co.planStartedAt && isYearlyRenewalMonth(co.planStartedAt, billingMonth))) {
      await stripe.invoices.create({
        customer: co.stripeCustomerId,
        auto_advance: true,
        collection_method: "charge_automatically",
        pending_invoice_items_behavior: "include",
        metadata: { companyId: co.id, month: billingMonth, kind: "extra_seats" },
      });
    }
    await audit({ tenantCompanyId: co.id, action: "CardSeatUsageReported", targetType: "Company", targetId: co.id, metadata: { month: billingMonth, extraSeats, amountExTaxYen: amountExTax } });
    result.reported++;
  }
  return result;
}

// ---- 共通 ----

const event_id = (o: { id?: string }) => o.id ?? null;

async function notifyOwners(companyId: string, subject: string, body: (name: string) => string) {
  try {
    const owners = await prisma.companyMember.findMany({
      where: { companyId, status: "ACTIVE", roles: { some: { role: "OWNER" } } },
      include: { userAccount: true },
    });
    await Promise.all(owners.map((m) => sendMail({ to: m.userAccount.email, subject, body: body(m.userAccount.name) })));
  } catch (e) {
    console.error("[card-billing] 代表への通知に失敗", e);
  }
}
