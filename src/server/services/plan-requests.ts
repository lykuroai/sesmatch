// PRO 版の申込・解約申請（2026-11-05 郭指示）。
//
// - 入口は3つ: ①お問合せ（従来どおり運営がプラン変更）②新規登録画面のプラン選択（source=REGISTER）③会社マイページ「プラン」（source=CONSOLE）
// - 申込だけではプランは変わらない。運営コンソール「PRO申込」で承認すると PRO 開始（請求書払い・月払い・開始当月無料、翌月分から月初請求）
// - 解約申請の承認は、承認した月の末日 23:59:59 JST を期限に設定する（翌月から基本版。返金なし。データは保持）
// - 受付は規約の適用開始日 2026-12-04（JST）から。それまでは API も拒否する
// - 申込・承認・却下は代表（OWNER）へメール、申込は運営（OPERATIONS_MAIL）へも通知。送信失敗で処理は失敗させない
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { appBaseUrl, sendMail } from "@/server/mail";
import type { AuthContext } from "@/server/auth/session";
import { effectivePlan } from "@/server/plan/features";
import { endOfMonthJst, isProSignupOpen, PRO_SIGNUP_CLOSED_MESSAGE } from "@/lib/plan-signup";
import { updateCompanyPlanByOperations } from "@/server/services/companies";

export type PlanRequestKind = "UPGRADE" | "CANCEL";
export type PlanRequestSource = "REGISTER" | "CONSOLE";

const KIND_LABEL: Record<PlanRequestKind, string> = { UPGRADE: "PRO 版の申込", CANCEL: "PRO 版の解約申請" };

type SvcError = { error: { code: "VALIDATION_ERROR" | "NOT_FOUND" | "DUPLICATE_ENTRY" | "VERSION_CONFLICT"; message?: string } };

// 代表（OWNER）のメールアドレス
async function ownerEmails(companyId: string): Promise<string[]> {
  const owners = await prisma.companyMember.findMany({
    where: { companyId, status: "ACTIVE", roles: { some: { role: "OWNER" } } },
    include: { userAccount: { select: { email: true } } },
  });
  return [...new Set(owners.map((m) => m.userAccount.email))];
}

async function mailOwners(companyId: string, subject: string, body: string) {
  for (const to of await ownerEmails(companyId)) {
    try {
      await sendMail({ to, subject, body });
    } catch (e) {
      console.error(`[mail] プラン申込の通知に失敗 companyId=${companyId}`, e);
    }
  }
}

async function mailOperations(subject: string, body: string) {
  const opsMail = process.env.OPERATIONS_MAIL;
  if (!opsMail) return;
  try {
    await sendMail({ to: opsMail, subject, body });
  } catch (e) {
    console.error("[mail] プラン申込の運営通知に失敗", e);
  }
}

// 申込の作成（内部）。登録画面（認証なし）と会社マイページ（認証あり）の両方から使う
export async function createPlanRequestInternal(input: {
  companyId: string;
  memberId: string | null;
  actorUserId?: string;
  kind: PlanRequestKind;
  source: PlanRequestSource;
  note?: string | null;
  now?: Date;
}): Promise<{ id: string } | SvcError> {
  const now = input.now ?? new Date();
  if (!isProSignupOpen(now)) return { error: { code: "VALIDATION_ERROR", message: PRO_SIGNUP_CLOSED_MESSAGE } };
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, name: true, plan: true, planExpiresAt: true, stripeSubscriptionId: true },
  });
  if (!company) return { error: { code: "NOT_FOUND" } };
  const current = effectivePlan(company, now);
  if (input.kind === "UPGRADE" && current === "PRO")
    return { error: { code: "VALIDATION_ERROR", message: "すでに PRO 版をご利用中です" } };
  if (input.kind === "CANCEL" && current !== "PRO")
    return { error: { code: "VALIDATION_ERROR", message: "PRO 版をご利用中の企業のみ解約を申請できます" } };
  if (input.kind === "CANCEL" && company.planExpiresAt)
    return { error: { code: "VALIDATION_ERROR", message: "すでに期限が設定されています（期限到来で基本版に戻ります）" } };
  if (company.stripeSubscriptionId)
    return { error: { code: "VERSION_CONFLICT", message: "カード決済でご契約中のため、お支払い方法の管理画面から手続きしてください" } };
  const pending = await prisma.planRequest.findFirst({ where: { tenantCompanyId: company.id, status: "PENDING" } });
  if (pending)
    return { error: { code: "DUPLICATE_ENTRY", message: `申請中の${KIND_LABEL[pending.kind]}があります。運営の処理をお待ちください` } };
  const note = input.note?.trim().slice(0, 1000) || null;
  const req = await prisma.planRequest.create({
    data: { tenantCompanyId: company.id, kind: input.kind, source: input.source, requestedByMemberId: input.memberId, note },
  });
  await audit({
    tenantCompanyId: company.id,
    actorUserId: input.actorUserId,
    action: "PlanRequestSubmitted",
    targetType: "PlanRequest",
    targetId: req.id,
    metadata: { kind: input.kind, source: input.source },
  });
  const label = KIND_LABEL[input.kind];
  await mailOwners(
    company.id,
    `【SES DirectMatch】${label}を受け付けました`,
    input.kind === "UPGRADE"
      ? `${company.name} 様

${label}を受け付けました。運営が確認のうえ PRO 版を有効化し、メールでご案内します。
PRO 版は月額 39,800円（税別・担当者5名まで）、請求書払い（月末締め・翌月末振込）です。
利用開始当月は無料で、翌月分から月初に請求書を発行します（日割りなし）。

申込状況: ${appBaseUrl()}/company/plan`
      : `${company.name} 様

${label}を受け付けました。運営が確認のうえ、当月末までのご利用で翌月から基本版へ変更します（登録データは保持されます）。

申請状況: ${appBaseUrl()}/company/plan`
  );
  await mailOperations(
    `【PRO申込】${label} — ${company.name}`,
    `企業: ${company.name}\n種別: ${label}\n入口: ${input.source === "REGISTER" ? "新規登録画面" : "会社マイページ"}\n備考: ${note ?? "（なし）"}\n\n運営コンソール: ${appBaseUrl()}/admin#plan-requests`
  );
  return { id: req.id };
}

// 会社マイページからの申込・解約申請（billing.manage）
export async function createPlanRequest(auth: AuthContext, input: { kind: PlanRequestKind; note?: string | null }, now = new Date()) {
  return createPlanRequestInternal({
    companyId: auth.companyId,
    memberId: auth.memberId,
    actorUserId: auth.userAccountId,
    kind: input.kind,
    source: "CONSOLE",
    note: input.note,
    now,
  });
}

// 自社の申込履歴（テナント分離）
export async function listOwnPlanRequests(auth: AuthContext) {
  return prisma.planRequest.findMany({ where: { tenantCompanyId: auth.companyId }, orderBy: { createdAt: "desc" }, take: 20 });
}

// 取り下げ（申請中のみ。他社の申込は 404）
export async function withdrawPlanRequest(auth: AuthContext, id: string): Promise<{ id: string } | SvcError> {
  const updated = await prisma.planRequest.updateMany({
    where: { id, tenantCompanyId: auth.companyId, status: "PENDING" },
    data: { status: "WITHDRAWN", processedAt: new Date() },
  });
  if (updated.count === 0) return { error: { code: "NOT_FOUND" } };
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "PlanRequestWithdrawn", targetType: "PlanRequest", targetId: id });
  return { id };
}

// ---- 運営 ----
export async function listPlanRequestsByOperations(status?: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN") {
  const items = await prisma.planRequest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.tenantCompanyId))] } },
    select: { id: true, name: true, plan: true, planExpiresAt: true, _count: { select: { members: { where: { status: "ACTIVE" } } } } },
  });
  const byId = new Map(companies.map((c) => [c.id, c]));
  const members = await prisma.companyMember.findMany({
    where: { id: { in: items.map((i) => i.requestedByMemberId).filter((v): v is string => !!v) } },
    include: { userAccount: { select: { name: true } } },
  });
  const memberName = new Map(members.map((m) => [m.id, m.userAccount.name]));
  return items.map((i) => {
    const co = byId.get(i.tenantCompanyId);
    return {
      ...i,
      companyName: co?.name ?? "",
      companyPlan: co ? effectivePlan(co) : "FREE",
      companyPlanExpiresAt: co?.planExpiresAt ?? null,
      activeMembers: co?._count.members ?? 0,
      requestedByName: i.requestedByMemberId ? (memberName.get(i.requestedByMemberId) ?? null) : null,
    };
  });
}

// 承認: UPGRADE → PRO 開始（請求書払い・月払い・無期限）、CANCEL → 当月末を期限に設定
export async function approvePlanRequest(id: string, note?: string | null, now = new Date()): Promise<{ id: string } | SvcError> {
  const req = await prisma.planRequest.findUnique({ where: { id } });
  if (!req) return { error: { code: "NOT_FOUND" } };
  if (req.status !== "PENDING") return { error: { code: "VERSION_CONFLICT", message: "この申込は処理済みです" } };
  const company = await prisma.company.findUnique({ where: { id: req.tenantCompanyId } });
  if (!company) return { error: { code: "NOT_FOUND" } };
  const result =
    req.kind === "UPGRADE"
      ? await updateCompanyPlanByOperations(company.id, { plan: "PRO", planExpiresAt: null, paymentMethod: "INVOICE" })
      : await updateCompanyPlanByOperations(company.id, { plan: company.plan === "FREE" ? "PRO" : company.plan, planExpiresAt: endOfMonthJst(now) });
  if ("error" in result) return result as SvcError;
  const updated = await prisma.planRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED", processedAt: now, processedNote: note?.trim().slice(0, 1000) || null },
  });
  if (updated.count === 0) return { error: { code: "VERSION_CONFLICT", message: "この申込は処理済みです" } };
  await audit({ tenantCompanyId: company.id, action: "PlanRequestApproved", targetType: "PlanRequest", targetId: id, metadata: { kind: req.kind } });
  await mailOwners(
    company.id,
    req.kind === "UPGRADE" ? "【SES DirectMatch】PRO 版が有効になりました" : "【SES DirectMatch】PRO 版の解約を受け付けました",
    req.kind === "UPGRADE"
      ? `${company.name} 様

PRO 版を有効にしました。本日から PRO 版の機能をご利用いただけます。
利用開始当月は無料で、翌月分から月初に請求書（請求書払い・月末締め翌月末振込）を発行し、企業コンソールの会社マイページ「プラン・請求」に表示します。

${appBaseUrl()}/company/plan`
      : `${company.name} 様

PRO 版の解約を受け付けました。${endOfMonthJst(now).replace(/-/g, "/")} まで PRO 版をご利用いただけ、翌月から基本版となります（登録データは保持されます）。

${appBaseUrl()}/company/plan`
  );
  return { id };
}

export async function rejectPlanRequest(id: string, note: string, now = new Date()): Promise<{ id: string } | SvcError> {
  const reason = note.trim().slice(0, 1000);
  if (!reason) return { error: { code: "VALIDATION_ERROR", message: "却下理由を入力してください" } };
  const req = await prisma.planRequest.findUnique({ where: { id } });
  if (!req) return { error: { code: "NOT_FOUND" } };
  const updated = await prisma.planRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", processedAt: now, processedNote: reason },
  });
  if (updated.count === 0) return { error: { code: "VERSION_CONFLICT", message: "この申込は処理済みです" } };
  await audit({ tenantCompanyId: req.tenantCompanyId, action: "PlanRequestRejected", targetType: "PlanRequest", targetId: id, metadata: { kind: req.kind } });
  const company = await prisma.company.findUnique({ where: { id: req.tenantCompanyId }, select: { name: true } });
  await mailOwners(
    req.tenantCompanyId,
    `【SES DirectMatch】${KIND_LABEL[req.kind]}について`,
    `${company?.name ?? ""} 様

${KIND_LABEL[req.kind]}を確認しましたが、今回はお受けできませんでした。
理由: ${reason}

ご不明な点は企業コンソールの「お問合せ」からご連絡ください。`
  );
  return { id };
}
