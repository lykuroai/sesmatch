// REST API（§28）: ベースパス /api/v1、JSON、UTF-8、日時 ISO 8601 UTC、金額は円整数
// 共通エラー（§29）

import { timingSafeEqual, createHash } from "crypto";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import {
  createSession,
  destroySession,
  resolveSession,
  SESSION_COOKIE,
  type AuthContext,
} from "@/server/auth/session";
import { hasPermission, type Permission } from "@/server/auth/rbac";
import { audit } from "@/server/audit";
import {
  addConsent,
  createEngineer,
  attachSkillSheet,
  getEngineer,
  getSkillSheetFile,
  reExtractSkillSheet,
  listEngineers,
  deleteEngineer,
  publishEngineer,
  unpublishEngineer,
  setEngineerWorkStatus,
  updateEngineer,
} from "@/server/services/engineers";
import {
  createProject,
  getProject,
  listProjects,
  deleteProject,
  publishProject,
  unpublishProject,
  setProjectWorkflowStatus,
  updateProject,
} from "@/server/services/projects";
import {
  matchEngineerToProjects,
  matchProjectToEngineers,
} from "@/server/services/matching";
import { getDashboard } from "@/server/services/dashboard";
import {
  approveEntry,
  createEntry,
  declineEntry,
  getEntry,
  getEntrySkillSheetFile,
  listEntries,
  moveToConditions,
  scheduleInterview,
  sendMessage,
} from "@/server/services/entries";
import {
  cancelContract,
  confirmWorkMonth,
  createContract,
  getContract,
  listContracts,
  signContract,
  startWork,
  terminateContract,
  updateContract,
} from "@/server/services/contracts";
import {
  generateInvoice,
  listFees,
  listInvoices,
} from "@/server/services/billing";
import {
  createPrivacyRequest,
  decidePrivacyRequest,
  executePurge,
  listPrivacyRequests,
} from "@/server/services/privacy";
import {
  applyCompany,
  approveCompany,
  rejectCompany,
  sendEmailVerificationCode,
  deleteCompanyByOperations,
  deleteMember,
  deleteMemberByOperations,
  deleteProspect,
  importCompanies,
  importProspects,
  listProspects,
  inviteMember,
  listAllCompanies,
  listAllMembersByOperations,
  listCompanyMembersByOperations,
  listPendingCompanies,
  promoteMemberToOwnerByOperations,
  sendBroadcastMailByOperations,
  reinviteMember,
  reinviteMemberByOperations,
  suspendMember,
  updateCompanyByOperations,
  updateOwnCompany,
  updateMemberByOperations,
  updateMemberProfile,
  updateMemberRoles,
} from "@/server/services/companies";
import {
  listContractsForOperations,
  listEngineersWorkStatusForOperations,
} from "@/server/services/operations-monitor";
import { retryIngestion, startIngestion } from "@/server/pipeline/ingest";
import { appBaseUrl, sendMail } from "@/server/mail";
import { isImageFilename, MAX_MERGE_IMAGES, mergeImagesToPdf } from "@/server/pipeline/images-to-pdf";
import { csvToCompanyRows, parseCsv } from "@/lib/csv";
import { remoteLevelFromOnsiteDays, remoteLevelToOnsiteDays } from "@/lib/constants";
import { registerNewTermAliases } from "@/server/services/skill-aliases";
import { engineerDraftSchema, projectDraftSchema } from "@/server/pipeline/llm";

type Env = { Variables: { auth: AuthContext } };

export const app = new Hono<Env>().basePath("/api/v1");

const err = (code: string, message?: string) => ({ error: { code, message } });

// 取込アップロードのサイズ上限（DoS対策 §32）。原本は同期でメモリ展開・解析するため上限を設ける
const MAX_INGEST_BYTES = 20 * 1024 * 1024;

// サービス層のエラー結果 → HTTP ステータス（§29）
type SvcErr = { code: string; message?: string };
const svcError = (result: object): SvcErr | null =>
  (result as { error?: SvcErr }).error ?? null;
const statusFor = (code: string): 400 | 403 | 404 | 409 | 422 =>
  code === "NOT_FOUND"
    ? 404
    : code === "FORBIDDEN"
      ? 403
      : code === "DUPLICATE_ENTRY" || code === "VERSION_CONFLICT"
        ? 409
        : code === "CONSENT_REQUIRED" || code === "PII_VALIDATION_FAILED"
          ? 422
          : 400;

// ---- ヘルスチェック（ALB・監視用）: 未認証。DB 疎通まで確認する ----

app.get("/health", async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 503);
  }
});

// ---- 企業申込（§6.4, §28）: 未認証で受け付ける ----

// 代表メールの確認コード送付
app.post("/companies/applications/email-verification", async (c) => {
  const parsed = z
    .object({ email: z.string().email() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", "メールアドレスを確認してください"), 400);
  const result = await sendEmailVerificationCode(parsed.data.email);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/companies/applications", async (c) => {
  const parsed = z
    .object({
      companyName: z.string().min(1),
      companyType: z.enum(["CORPORATION", "SOLE_PROPRIETOR"]),
      corporateNumber: z.string().optional(),
      address: z.string().min(1),
      ownerName: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8),
      agreedToTerms: z.boolean(),
      emailVerificationCode: z.string().min(1),
      duplicateWarningConfirmed: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", "入力内容を確認してください（パスワードは8文字以上）"), 400);
  const result = await applyCompany(parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  // 類似企業あり（社名 or 所在地の片方一致）→ 警告。クライアントは確認の上 duplicateWarningConfirmed で再送する
  if ("duplicateWarning" in result)
    return c.json({ ok: false, duplicateWarning: result.duplicateWarning }, 200);
  return c.json({ ok: true, companyId: (result as { companyId: string }).companyId }, 201);
});

// ---- 運営審査（運営トークン保護。運営コンソールは対象外のため簡易実装）----

const requireAdminToken = async (
  c: { req: { header: (n: string) => string | undefined }; json: (o: object, s: 401) => Response },
  next: () => Promise<void>
) => {
  const token = process.env.PLATFORM_ADMIN_TOKEN;
  const provided = c.req.header("X-Admin-Token");
  if (!token || !provided || !constantTimeEqual(provided, token)) {
    return c.json(err("UNAUTHENTICATED"), 401);
  }
  await next();
};

// 定数時間比較（タイミング攻撃対策 §31）。長さの差異も漏らさないよう SHA-256 の固定長で比較する
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

app.get("/operations/companies", requireAdminToken, async (c) =>
  c.json({ items: await listPendingCompanies() })
);

// 承認して開通。申込フローのオーナーへ承認通知メールを送る。
// CSV取込由来のパスワード未発行担当者へは、開通後に運営が「初期パスワード再発行（再招待）」で個別発行する。
app.post("/operations/companies/:id/approve", requireAdminToken, async (c) => {
  const result = await approveCompany(c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 審査却下（申込者へ通知して申込データを削除）
app.post("/operations/companies/:id/reject", requireAdminToken, async (c) => {
  const parsed = z
    .object({ reason: z.string().optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  const result = await rejectCompany(
    c.req.param("id"),
    parsed.success ? parsed.data.reason : undefined
  );
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 企業リスト（CSV）一括取込。ヘッダ行の列名で判定（3列: 企業名, 担当者名, メールアドレス も可）。
// 取込企業は審査待ちで登録され、承認まで無効・メール配信なし
app.post("/operations/companies/import", requireAdminToken, async (c) => {
  const parsed = z
    .object({ csv: z.string().min(1).max(20_000_000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const rows = csvToCompanyRows(parseCsv(parsed.data.csv));
  if (rows.length === 0) return c.json(err("VALIDATION_ERROR", "データ行がありません"), 400);
  const result = await importCompanies(rows);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 全企業一覧と企業情報の修正（取込した不完全データの補完）
app.get("/operations/companies/all", requireAdminToken, async (c) =>
  c.json({ items: await listAllCompanies() })
);

app.put("/operations/companies/:id", requireAdminToken, async (c) => {
  const parsed = z
    .object({
      name: z.string().min(1),
      companyType: z.enum(["CORPORATION", "SOLE_PROPRIETOR"]),
      corporateNumber: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await updateCompanyByOperations(c.req.param("id"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 企業の削除（取込ミス等の是正用）。業務データを持つ企業は 409 で拒否
app.delete("/operations/companies/:id", requireAdminToken, async (c) => {
  const result = await deleteCompanyByOperations(c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 運営: 担当者管理（一覧・修正・削除・再招待）。運営権限のためオーナーも操作可
app.get("/operations/companies/:id/members", requireAdminToken, async (c) => {
  const result = await listCompanyMembersByOperations(c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.put("/operations/members/:id", requireAdminToken, async (c) => {
  const parsed = z
    .object({ name: z.string().min(1), email: z.string().email() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await updateMemberByOperations(c.req.param("id"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.delete("/operations/members/:id", requireAdminToken, async (c) => {
  const result = await deleteMemberByOperations(c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/operations/members/:id/promote-owner", requireAdminToken, async (c) => {
  const result = await promoteMemberToOwnerByOperations(c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/operations/members/:id/reinvite", requireAdminToken, async (c) => {
  const result = await reinviteMemberByOperations(c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 運営: メール配信（営業PR・お知らせ）。宛先一覧と一斉送信。
// 1リクエストの宛先は担当者・販促先合計200名まで（UI側で分割送信する）
app.get("/operations/members/all", requireAdminToken, async (c) =>
  c.json(await listAllMembersByOperations())
);

app.post("/operations/mail/broadcast", requireAdminToken, async (c) => {
  const parsed = z
    .object({
      memberIds: z.array(z.string()).max(200).optional(),
      prospectIds: z.array(z.string()).max(200).optional(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(20000),
    })
    .refine(
      (v) => (v.memberIds?.length ?? 0) + (v.prospectIds?.length ?? 0) > 0,
      { message: "宛先を選択してください" }
    )
    .refine((v) => (v.memberIds?.length ?? 0) + (v.prospectIds?.length ?? 0) <= 200, {
      message: "宛先は1リクエスト200名までです",
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await sendBroadcastMailByOperations(parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 運営: 販促先リストの取込（企業CSVと同じ3列/5列フォーマット）・一覧・削除
app.post("/operations/prospects/import", requireAdminToken, async (c) => {
  const parsed = z
    .object({ csv: z.string().min(1).max(20_000_000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const rows = csvToCompanyRows(parseCsv(parsed.data.csv));
  if (rows.length === 0) return c.json(err("VALIDATION_ERROR", "データ行がありません"), 400);
  return c.json(await importProspects(rows));
});

app.get("/operations/prospects", requireAdminToken, async (c) =>
  c.json(await listProspects())
);

app.delete("/operations/prospects/:id", requireAdminToken, async (c) => {
  const result = await deleteProspect(c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 通報の運営対応（§24）: 全テナントの通報を横断で参照・ステータス更新
// 契約ごとの稼働状況・金額・手数料の監視（テナント横断）
app.get("/operations/contracts", requireAdminToken, async (c) =>
  c.json({ items: await listContractsForOperations() })
);

// 人材の稼働状況の監視（テナント横断）
app.get("/operations/engineers", requireAdminToken, async (c) =>
  c.json({ items: await listEngineersWorkStatusForOperations() })
);

// ---- 用語辞書（スキル・工程・業種の同義語 §19 名寄せ）----
app.get("/operations/skill-aliases", requireAdminToken, async (c) =>
  c.json({ items: await prisma.skillAlias.findMany({ orderBy: { createdAt: "desc" } }) })
);

app.post("/operations/skill-aliases", requireAdminToken, async (c) => {
  const parsed = z
    .object({ alias: z.string().min(1), canonical: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", "表記と正規形を入力してください"), 400);
  try {
    const created = await prisma.skillAlias.create({
      data: { alias: parsed.data.alias.trim(), canonical: parsed.data.canonical.trim() },
    });
    return c.json(created, 201);
  } catch {
    return c.json(err("DUPLICATE_ENTRY", "同じ表記が登録済みです"), 409);
  }
});

// 正規形の手動修正（LLM自動登録分の是正に使う）
app.put("/operations/skill-aliases/:id", requireAdminToken, async (c) => {
  const parsed = z
    .object({ canonical: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", "正規形を入力してください"), 400);
  const updated = await prisma.skillAlias
    .update({ where: { id: c.req.param("id") }, data: { canonical: parsed.data.canonical.trim() } })
    .catch(() => null);
  if (!updated) return c.json(err("NOT_FOUND"), 404);
  return c.json(updated);
});

app.delete("/operations/skill-aliases/:id", requireAdminToken, async (c) => {
  await prisma.skillAlias.delete({ where: { id: c.req.param("id") } }).catch(() => null);
  return c.json({ ok: true });
});

// お問合せ（運営側）: 一覧・対応状況の更新・スレッド回答
app.get("/operations/inquiries", requireAdminToken, async (c) => {
  const inquiries = await prisma.inquiry.findMany({
    include: { messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: inquiries.map((q) => q.tenantCompanyId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(companies.map((co) => [co.id, co.name]));
  return c.json({
    items: inquiries.map((q) => ({ ...q, companyName: nameById.get(q.tenantCompanyId) ?? "?" })),
  });
});

// 運営からのスレッド回答。回答すると状態は「対応中（REVIEWING）」になり、問い合わせ者へメール通知する
app.post("/operations/inquiries/:id/messages", requireAdminToken, async (c) => {
  const parsed = z
    .object({ body: z.string().min(1).max(5000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const inquiry = await prisma.inquiry.findUnique({ where: { id: c.req.param("id") } });
  if (!inquiry) return c.json(err("NOT_FOUND"), 404);
  const message = await prisma.inquiryMessage.create({
    data: { inquiryId: inquiry.id, fromOperator: true, body: parsed.data.body },
  });
  if (inquiry.status === "OPEN")
    await prisma.inquiry.update({ where: { id: inquiry.id }, data: { status: "REVIEWING" } });
  else await prisma.inquiry.update({ where: { id: inquiry.id }, data: {} }); // updatedAt 更新
  await audit({
    tenantCompanyId: inquiry.tenantCompanyId,
    action: "InquiryReplied",
    targetType: "Inquiry",
    targetId: inquiry.id,
    metadata: { fromOperator: true },
  });
  // 問い合わせ担当者へメール通知（担当者が特定できない場合は送らない）
  if (inquiry.memberId) {
    const member = await prisma.companyMember.findUnique({
      where: { id: inquiry.memberId },
      include: { userAccount: { select: { email: true } } },
    });
    const to = member?.userAccount?.email;
    if (to) {
      await sendMail({
        to,
        subject: `【SES DirectMatch】お問合せ ${inquiry.code} への回答が届きました`,
        body: `お問合せ ${inquiry.code}（${inquiry.category}）に運営からの回答が届きました。\n\n${parsed.data.body}\n\n続きはお問合せページからご確認ください: ${appBaseUrl()}/support`,
      });
    }
  }
  return c.json(message, 201);
});

app.post("/operations/inquiries/:id/status", requireAdminToken, async (c) => {
  const parsed = z
    .object({ status: z.enum(["REVIEWING", "RESOLVED"]) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const inquiry = await prisma.inquiry.findUnique({ where: { id: c.req.param("id") } });
  if (!inquiry) return c.json(err("NOT_FOUND"), 404);
  await prisma.inquiry.update({ where: { id: inquiry.id }, data: { status: parsed.data.status } });
  await audit({
    tenantCompanyId: inquiry.tenantCompanyId,
    action: "InquiryStatusUpdated",
    targetType: "Inquiry",
    targetId: inquiry.id,
    metadata: { status: parsed.data.status },
  });
  return c.json({ ok: true });
});

app.get("/operations/reports", requireAdminToken, async (c) => {
  const reports = await prisma.report.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const companies = await prisma.company.findMany({
    where: { id: { in: reports.map((r) => r.tenantCompanyId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(companies.map((co) => [co.id, co.name]));
  return c.json({
    items: reports.map((r) => ({ ...r, reporterCompanyName: nameById.get(r.tenantCompanyId) ?? "?" })),
  });
});

app.post("/operations/reports/:id/status", requireAdminToken, async (c) => {
  const parsed = z
    .object({ status: z.enum(["REVIEWING", "RESOLVED"]) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const report = await prisma.report.findUnique({ where: { id: c.req.param("id") } });
  if (!report) return c.json(err("NOT_FOUND"), 404);
  await prisma.report.update({ where: { id: report.id }, data: { status: parsed.data.status } });
  await audit({
    tenantCompanyId: report.tenantCompanyId,
    action: "ReportStatusUpdated",
    targetType: "Report",
    targetId: report.id,
    metadata: { status: parsed.data.status },
  });
  return c.json({ ok: true });
});

// ---- 認証 ----

app.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email(), password: z.string() }).safeParse(body);
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);

  const account = await prisma.userAccount.findUnique({ where: { email: parsed.data.email } });
  if (!account || !(await verifyPassword(parsed.data.password, account.passwordHash))) {
    await audit({ action: "LoginFailed", metadata: { email: parsed.data.email } });
    return c.json(err("UNAUTHENTICATED", "メールアドレスまたはパスワードが違います"), 401);
  }
  // 審査中・停止中の企業はログイン不可（§6.4）
  const membership = await prisma.companyMember.findFirst({
    where: { userAccountId: account.id, status: "ACTIVE" },
    include: { company: true },
  });
  if (membership?.company.status === "APPLIED")
    return c.json(err("FORBIDDEN", "運営審査中です。開通までお待ちください"), 403);
  if (!membership || membership.company.status !== "ACTIVE")
    return c.json(err("FORBIDDEN", "有効な企業所属がありません"), 403);
  const { token, expiresAt } = await createSession(account.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
    secure: process.env.NODE_ENV === "production", // 本番はHTTPS必須
  });
  await audit({ actorUserId: account.id, action: "LoginSucceeded" });
  return c.json({ ok: true });
});

app.post("/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---- 認証ミドルウェア: 企業IDは認証情報から確定する（§31）----

app.use("*", async (c, next) => {
  const auth = await resolveSession(getCookie(c, SESSION_COOKIE));
  if (!auth) return c.json(err("UNAUTHENTICATED"), 401);
  c.set("auth", auth);
  await next();
});

const requirePermission =
  (permission: Permission) =>
  async (c: { get: (k: "auth") => AuthContext; json: (o: object, s: 403) => Response }, next: () => Promise<void>) => {
    if (!hasPermission(c.get("auth").roles, permission)) {
      return c.json(err("FORBIDDEN", `権限がありません: ${permission}`), 403);
    }
    await next();
  };

// ---- ダッシュボード ----

app.get("/company/dashboard", requirePermission("dashboard.read"), async (c) =>
  c.json(await getDashboard(c.get("auth")))
);

// ---- 企業情報（オーナー・管理者による自社情報の修正）----

app.put("/company/profile", requirePermission("company.manage"), async (c) => {
  const parsed = z
    .object({
      name: z.string().min(1),
      companyType: z.enum(["CORPORATION", "SOLE_PROPRIETOR"]),
      corporateNumber: z.string().optional(),
      address: z.string().optional(),
      dispatchLicenseNumber: z.string().optional(),
      dispatchLicenseExpiry: z.string().optional(),
      dispatchManagerName: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await updateOwnCompany(c.get("auth"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// ---- 担当者管理（§7, §28）----

app.post("/company/members/invitations", requirePermission("member.manage"), async (c) => {
  const parsed = z
    .object({
      email: z.string().email(),
      name: z.string().min(1),
      roles: z.array(z.string()).min(1),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await inviteMember(c.get("auth"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result, 201);
});

app.put("/company/members/:id/roles", requirePermission("member.manage"), async (c) => {
  const parsed = z
    .object({ roles: z.array(z.string()).min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await updateMemberRoles(c.get("auth"), c.req.param("id"), parsed.data.roles);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/company/members/:id/suspend", requirePermission("member.manage"), async (c) => {
  const result = await suspendMember(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.put("/company/members/:id", requirePermission("member.manage"), async (c) => {
  const parsed = z
    .object({ name: z.string().min(1), email: z.string().email() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await updateMemberProfile(c.get("auth"), c.req.param("id"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/company/members/:id/reinvite", requirePermission("member.manage"), async (c) => {
  const result = await reinviteMember(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.delete("/company/members/:id", requirePermission("member.manage"), async (c) => {
  const result = await deleteMember(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.get("/me", async (c) => {
  const auth = c.get("auth");
  return c.json({
    userName: auth.userName,
    email: auth.email,
    companyName: auth.companyName,
    roles: auth.roles,
  });
});

// ---- 人材 ----

app.get("/engineers", requirePermission("engineer.read.masked"), async (c) => {
  const scope = c.req.query("scope") === "public" ? "public" : "own";
  const page = parseInt(c.req.query("page") ?? "") || undefined; // 未指定は全件（後方互換）
  return c.json(await listEngineers(c.get("auth"), scope, c.req.query("q"), page));
});

const engineerInputSchema = z.object({
  name: z.string().min(1),
  ageBand: z.number().int().min(20).max(70),
  affiliationType: z.enum(["EMPLOYEE", "AFFILIATED", "FREELANCER", "SUBTIER1"]),
  residenceCity: z.string().optional(),
  nearestStation: z.string().optional(),
  nationality: z.string().optional(),
  availableFrom: z.string().optional(),
  availabilityRate: z.number().int().min(0).max(100).optional(),
  desiredRateYen: z.number().int().positive(),
  commuteMaxMinutes: z.number().int().optional(),
  maxOnsiteDaysPerWeek: z.number().int().min(0).max(5).optional(),
  remotePreference: z.enum(["R0", "R1", "R2", "R3", "R4", "R5"]).optional(),
  travelOk: z.boolean().optional(),
  summary: z.string().optional(),
  processes: z.array(z.string()).optional(),
  roles: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  skills: z
    .array(
      z.object({
        category: z.enum([
          "LANGUAGE",
          "FRAMEWORK",
          "DATABASE",
          "CLOUD",
          "OS",
          "TOOL",
          "CERTIFICATION",
          "PROCESS",
          "INDUSTRY",
        ]),
        name: z.string(),
        months: z.number().int().min(0),
        lastUsedAt: z.string().optional(),
      })
    )
    .optional(),
});

app.post("/engineers", requirePermission("engineer.create"), async (c) => {
  const parsed = engineerInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", parsed.error.message), 400);
  return c.json(await createEngineer(c.get("auth"), parsed.data), 201);
});

// 職務経歴書（スキルシート）の添付・差し替え（自社人材のみ）
app.post("/engineers/:id/skill-sheet", requirePermission("engineer.create"), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json(err("VALIDATION_ERROR", "file が必要です"), 400);
  const result = await attachSkillSheet(c.get("auth"), c.req.param("id"), {
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    content: Buffer.from(await file.arrayBuffer()),
  });
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result, 201);
});

// 添付済み職務経歴書からの再抽出（匿名化テキスト・抽出値を再反映）
app.post("/engineers/:id/skill-sheet/re-extract", requirePermission("engineer.create"), async (c) => {
  const result = await reExtractSkillSheet(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 職務経歴書のダウンロード（原本＝PII を含むため自社 + engineer.read.pii のみ）
app.get("/engineers/:id/skill-sheet", requirePermission("engineer.read.pii"), async (c) => {
  const file = await getSkillSheetFile(c.get("auth"), c.req.param("id"));
  if (!file) return c.json(err("NOT_FOUND"), 404);
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    },
  });
});

app.get("/engineers/:id", requirePermission("engineer.read.masked"), async (c) => {
  const engineer = await getEngineer(c.get("auth"), c.req.param("id"));
  if (!engineer) return c.json(err("NOT_FOUND"), 404);
  return c.json(engineer);
});

app.put("/engineers/:id", requirePermission("engineer.create"), async (c) => {
  const parsed = engineerInputSchema
    .omit({ name: true })
    .extend({ name: z.string().min(1).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", parsed.error.message), 400);
  const result = await updateEngineer(c.get("auth"), c.req.param("id"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json((result as { engineer: unknown }).engineer);
});

// 人材の削除（論理削除）。進行中エントリーがある場合は 409
app.delete("/engineers/:id", requirePermission("engineer.create"), async (c) => {
  const result = await deleteEngineer(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/engineers/:id/consents", requirePermission("consent.manage"), async (c) => {
  const parsed = z
    .object({
      method: z.string(),
      documentVersion: z.string(),
      purposes: z.array(z.string()),
      validUntil: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const consent = await addConsent(c.get("auth"), c.req.param("id"), parsed.data);
  if (!consent) return c.json(err("NOT_FOUND"), 404);
  return c.json(consent, 201);
});

// 人材の稼働状態（紹介中/商談中/成約/稼働中）の手動設定
app.post("/engineers/:id/work-status", requirePermission("engineer.create"), async (c) => {
  const parsed = z
    .object({ status: z.enum(["PROPOSING", "NEGOTIATING", "CONTRACTED", "WORKING"]) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await setEngineerWorkStatus(c.get("auth"), c.req.param("id"), parsed.data.status);
  if ("error" in result) return c.json(err("NOT_FOUND"), 404);
  return c.json(result);
});

app.post("/engineers/:id/publish", requirePermission("engineer.publish"), async (c) => {
  const result = await publishEngineer(c.get("auth"), c.req.param("id"));
  if ("error" in result) {
    if (result.error === "NOT_FOUND") return c.json(err("NOT_FOUND"), 404);
    return c.json(err("CONSENT_REQUIRED", "有効な本人同意（または就労資格確認）がありません"), 422);
  }
  return c.json(result);
});

// 公開の取り下げ（公開中 → 下書き）
app.post("/engineers/:id/unpublish", requirePermission("engineer.publish"), async (c) => {
  const result = await unpublishEngineer(c.get("auth"), c.req.param("id"));
  if ("error" in result) return c.json(err("NOT_FOUND"), 404);
  return c.json(result);
});

// ---- 案件 ----

app.get("/projects", requirePermission("project.read"), async (c) => {
  const scope = c.req.query("scope") === "public" ? "public" : "own";
  const page = parseInt(c.req.query("page") ?? "") || undefined; // 未指定は全件（後方互換）
  return c.json(await listProjects(c.get("auth"), scope, c.req.query("q"), page));
});

const projectInputSchema = z.object({
  name: z.string().min(1),
  anonymousSummary: z.string().min(1),
  industry: z.string().optional(),
  headcount: z.number().int().positive().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
  longTerm: z.boolean().optional(),
  locationCity: z.string().optional(),
  nearestStation: z.string().optional(),
  onsiteDaysPerWeek: z.number().int().min(0).max(5).optional(),
  remoteLevel: z.enum(["R0", "R1", "R2", "R3", "R4", "R5"]).optional(),
  rateMinYen: z.number().int().positive().optional(),
  rateMaxYen: z.number().int().positive(),
  contractType: z.enum(["準委任", "請負", "労働者派遣"]),
  dispatchConflictDate: z.string().optional(),
  dispatchDemandManager: z.string().optional(),
  dispatchProhibitedConfirmed: z.boolean().optional(),
  allowSubtier: z.boolean().optional(),
  noForeignNational: z.boolean().optional(),
  acceptedTypes: z.array(z.enum(["EMPLOYEE", "AFFILIATED", "FREELANCER", "SUBTIER1"])).optional(),
  interviewCount: z.number().int().min(0).optional(),
  processes: z.array(z.string()).optional(),
  requiredSkills: z.array(z.object({ name: z.string(), minMonths: z.number().int().optional() })).optional(),
  preferredSkills: z.array(z.object({ name: z.string() })).optional(),
});

app.post("/projects", requirePermission("project.create"), async (c) => {
  const parsed = projectInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", parsed.error.message), 400);
  const result = await createProject(c.get("auth"), parsed.data);
  if ("error" in result) return c.json(err("VALIDATION_ERROR", result.error), 400);
  return c.json(result.project, 201);
});

app.get("/projects/:id", requirePermission("project.read"), async (c) => {
  const project = await getProject(c.get("auth"), c.req.param("id"));
  if (!project) return c.json(err("NOT_FOUND"), 404);
  return c.json(project);
});

app.put("/projects/:id", requirePermission("project.create"), async (c) => {
  const parsed = projectInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", parsed.error.message), 400);
  const result = await updateProject(c.get("auth"), c.req.param("id"), parsed.data);
  if ("error" in result) {
    if (result.error === "NOT_FOUND") return c.json(err("NOT_FOUND"), 404);
    return c.json(err("VALIDATION_ERROR", result.error), 400);
  }
  return c.json(result.project);
});

// 案件の削除（物理削除）。エントリーがある場合は 409
app.delete("/projects/:id", requirePermission("project.create"), async (c) => {
  const result = await deleteProject(c.get("auth"), c.req.param("id"));
  if ("error" in result) {
    if (result.error === "NOT_FOUND") return c.json(err("NOT_FOUND"), 404);
    return c.json(err("VERSION_CONFLICT", result.error), 409);
  }
  return c.json(result);
});

// 案件の進行状態（募集中/商談中/成約/終了）の手動設定
app.post("/projects/:id/workflow-status", requirePermission("project.create"), async (c) => {
  const parsed = z
    .object({ status: z.enum(["RECRUITING", "NEGOTIATING", "CONTRACTED", "ENDED"]) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await setProjectWorkflowStatus(c.get("auth"), c.req.param("id"), parsed.data.status);
  if ("error" in result) return c.json(err("NOT_FOUND"), 404);
  return c.json(result);
});

app.post("/projects/:id/publish", requirePermission("project.publish"), async (c) => {
  const result = await publishProject(c.get("auth"), c.req.param("id"));
  if ("error" in result) return c.json(err("NOT_FOUND"), 404);
  return c.json(result);
});

// 公開の取り下げ（公開中 → 下書き）
app.post("/projects/:id/unpublish", requirePermission("project.publish"), async (c) => {
  const result = await unpublishProject(c.get("auth"), c.req.param("id"));
  if ("error" in result) return c.json(err("NOT_FOUND"), 404);
  return c.json(result);
});

// ---- マッチング（§19, §28）----

// minRequiredSkillRatio: 必須スキル充足率のしきい値（0.5〜1、省略時1=全て充足）
app.post("/matches/project-to-engineers", requirePermission("match.run"), async (c) => {
  const parsed = z
    .object({ projectId: z.string(), minRequiredSkillRatio: z.number().min(0.5).max(1).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await matchProjectToEngineers(c.get("auth"), parsed.data.projectId, {
    minRequiredSkillRatio: parsed.data.minRequiredSkillRatio,
  });
  if (!result) return c.json(err("NOT_FOUND"), 404);
  return c.json(result);
});

app.post("/matches/engineer-to-projects", requirePermission("match.run"), async (c) => {
  const parsed = z
    .object({ engineerId: z.string(), minRequiredSkillRatio: z.number().min(0.5).max(1).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await matchEngineerToProjects(c.get("auth"), parsed.data.engineerId, {
    minRequiredSkillRatio: parsed.data.minRequiredSkillRatio,
  });
  if (!result) return c.json(err("NOT_FOUND"), 404);
  return c.json(result);
});

// ---- 取込（§9, §28）----

// ファイルアップロード（multipart）またはテキスト貼り付け（JSON: メール本文等 §9.1）に対応
app.post("/ingestions", requirePermission("ingestion.create"), async (c) => {
  const auth = c.get("auth");
  const contentType = c.req.header("Content-Type") ?? "";

  let filename: string;
  let mimeType: string;
  let content: Buffer;

  if (contentType.includes("application/json")) {
    // 貼り付け取込: メール本文・案件票テキスト等
    const parsed = z
      .object({ text: z.string().min(1).max(100_000), title: z.string().max(200).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(err("VALIDATION_ERROR", "text が必要です"), 400);
    filename = `${(parsed.data.title?.trim() || "貼り付け取込").replace(/[/\\]/g, "_")}.txt`;
    mimeType = "text/plain";
    content = Buffer.from(parsed.data.text, "utf-8");
  } else {
    const form = await c.req.formData().catch(() => null);
    const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File);
    if (files.length === 0) return c.json(err("VALIDATION_ERROR", "file が必要です"), 400);
    // サイズ上限（DoS対策）: メモリ全量展開・同期解析の前に拒否する
    for (const f of files) {
      if (f.size > MAX_INGEST_BYTES)
        return c.json(err("VALIDATION_ERROR", "ファイルは1件20MB以下にしてください"), 400);
    }
    if (files.length === 1) {
      const file = files[0];
      filename = file.name;
      mimeType = file.type || "text/plain";
      content = Buffer.from(await file.arrayBuffer());
    } else {
      // 複数ファイル = 複数ページ撮影画像を1件として取込（画像のみ、1画像=1ページのPDFへ結合）
      if (files.length > MAX_MERGE_IMAGES)
        return c.json(err("VALIDATION_ERROR", `まとめて取り込める画像は${MAX_MERGE_IMAGES}枚までです`), 400);
      if (!files.every((f) => isImageFilename(f.name) || f.type.startsWith("image/")))
        return c.json(
          err("VALIDATION_ERROR", "まとめて取込できるのは画像（撮影ページ）のみです。書類ファイルは1件ずつ取り込んでください"),
          400
        );
      const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
      content = await mergeImagesToPdf(buffers);
      const base = files[0].name.replace(/\.[^.]+$/, "").replace(/[/\\]/g, "_") || "撮影取込";
      filename = `${base}_${files.length}ページ.pdf`;
      mimeType = "application/pdf";
    }
    if (content.length > MAX_INGEST_BYTES)
      return c.json(err("VALIDATION_ERROR", "ファイルは20MB以下にしてください"), 400);
  }

  const job = await startIngestion({
    tenantCompanyId: auth.companyId,
    memberId: auth.memberId,
    actorUserId: auth.userAccountId,
    filename,
    mimeType,
    content,
  });
  return c.json(job, 201);
});

app.get("/ingestions", requirePermission("ingestion.create"), async (c) => {
  const auth = c.get("auth");
  const jobs = await prisma.ingestionJob.findMany({
    where: { tenantCompanyId: auth.companyId },
    include: { sourceDocument: true, extraction: true },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ items: jobs });
});

app.get("/ingestions/:id", requirePermission("ingestion.create"), async (c) => {
  const auth = c.get("auth");
  const job = await prisma.ingestionJob.findFirst({
    where: { id: c.req.param("id"), tenantCompanyId: auth.companyId }, // テナント分離
    include: { sourceDocument: true, extraction: true },
  });
  if (!job) return c.json(err("NOT_FOUND"), 404);
  return c.json(job);
});

// 人手確認 → 確定DB反映（§9.2）
// 失敗した取込ジョブの再実行（LLM一時障害等からの復旧）
app.post("/ingestions/:id/retry", requirePermission("ingestion.create"), async (c) => {
  const auth = c.get("auth");
  const result = await retryIngestion({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    jobId: c.req.param("id"),
  });
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 取込の削除（人手確認待ち・失敗のみ）。確定前のデータを原本・PII置換表ごと破棄する
app.delete("/ingestions/:id", requirePermission("ingestion.confirm"), async (c) => {
  const auth = c.get("auth");
  const job = await prisma.ingestionJob.findFirst({
    where: { id: c.req.param("id"), tenantCompanyId: auth.companyId }, // テナント分離
    include: { sourceDocument: { include: { skillSheetOfEngineers: { select: { id: true } } } } },
  });
  if (!job) return c.json(err("NOT_FOUND"), 404);
  if (!["REVIEW_REQUIRED", "FAILED"].includes(job.status))
    return c.json(err("VERSION_CONFLICT", "人手確認待ちまたは失敗した取込のみ削除できます"), 409);
  await prisma.extractionResult.deleteMany({ where: { ingestionJobId: job.id } });
  await prisma.ingestionJob.delete({ where: { id: job.id } });
  // 同じ原本を参照する他のジョブ・職務経歴書参照がなければ、原本ファイルとPII置換表も削除する
  const otherJobs = await prisma.ingestionJob.count({
    where: { sourceDocumentId: job.sourceDocumentId },
  });
  if (otherJobs === 0 && job.sourceDocument.skillSheetOfEngineers.length === 0) {
    await prisma.piiTokenMap.deleteMany({ where: { sourceDocumentId: job.sourceDocumentId } });
    await prisma.sourceDocument.delete({ where: { id: job.sourceDocumentId } });
    const { unlink } = await import("fs/promises");
    await unlink(job.sourceDocument.storagePath).catch(() => {});
  }
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "IngestionDeleted",
    targetType: "IngestionJob",
    targetId: job.id,
  });
  return c.json({ ok: true });
});

app.post("/ingestions/:id/confirm", requirePermission("ingestion.confirm"), async (c) => {
  const auth = c.get("auth");
  const job = await prisma.ingestionJob.findFirst({
    where: { id: c.req.param("id"), tenantCompanyId: auth.companyId },
    include: { sourceDocument: true, extraction: true },
  });
  if (!job || !job.extraction) return c.json(err("NOT_FOUND"), 404);
  if (job.status !== "REVIEW_REQUIRED")
    return c.json(err("VERSION_CONFLICT", "人手確認待ちではありません"), 409);

  // 担当者が修正した確定値（未指定なら抽出値をそのまま確定）
  const body = await c.req.json().catch(() => ({}));
  const confirmed = body?.confirmed ?? job.extraction.extractedJson;

  const REMOTE_LEVELS = ["R0", "R1", "R2", "R3", "R4", "R5"] as const;
  let createdId: string | null = null;
  if (job.sourceDocument.kind === "ENGINEER_SHEET") {
    const parsed = engineerDraftSchema.safeParse(confirmed);
    if (!parsed.success) return c.json(err("VALIDATION_ERROR", parsed.error.message), 400);
    const d = parsed.data;
    // 所属区分: 確認時の指定 > LLM抽出値 > 自社所属（既定）
    const AFFILIATION_TYPES = ["EMPLOYEE", "AFFILIATED", "FREELANCER", "SUBTIER1"] as const;
    const bodyAffiliation = AFFILIATION_TYPES.find((t) => t === body?.affiliationType);
    // 許容出社条件: 確認時の指定 > 抽出値の最大出社日数からの導出。週最大出社日数は連動
    const bodyRemotePref = REMOTE_LEVELS.find((r) => r === body?.remotePreference);
    const result = await createEngineer(auth, {
      // 氏名は匿名化済み抽出値に含まれないため、確認画面で担当者が入力する
      name: typeof body?.name === "string" && body.name ? body.name : "（未入力）",
      ageBand: d.ageBand ?? 30,
      affiliationType: bodyAffiliation ?? d.affiliationType ?? "AFFILIATED",
      nationality: d.nationality ?? undefined, // 国籍（国名。未指定は日本国籍とみなす）
      residenceCity: d.residenceCity ?? undefined,
      availableFrom: d.availableFrom ?? undefined,
      desiredRateYen: d.desiredRateYen ?? 600_000,
      maxOnsiteDaysPerWeek: bodyRemotePref
        ? remoteLevelToOnsiteDays(bodyRemotePref)
        : (d.maxOnsiteDaysPerWeek ?? undefined),
      remotePreference:
        bodyRemotePref ??
        (d.maxOnsiteDaysPerWeek != null
          ? remoteLevelFromOnsiteDays(d.maxOnsiteDaysPerWeek)
          : undefined),
      summary: d.summary,
      processes: d.processes,
      roles: d.roles,
      industries: d.industries,
      // 経験期間不明（null）は 0ヶ月として登録し、担当者が人材編集で補正する。
      // 工程・業種経験は必須スキル判定・検索で使えるようスキルとしても登録する（重複名は除外）
      skills: (() => {
        const base = d.skills.map((s) => ({ ...s, months: s.months ?? 0 }));
        const names = new Set(base.map((s) => s.name.trim().toLowerCase()));
        const extras = [
          ...d.processes.map((name) => ({ name, category: "PROCESS", months: 0 })),
          ...d.industries.map((name) => ({ name, category: "INDUSTRY", months: 0 })),
        ].filter((s) => {
          const k = s.name.trim().toLowerCase();
          if (!k || names.has(k)) return false;
          names.add(k);
          return true;
        });
        return [...base, ...extras];
      })(),
    });
    createdId = result.id;
  } else if (job.sourceDocument.kind === "PROJECT_DESCRIPTION") {
    const parsed = projectDraftSchema.safeParse(confirmed);
    if (!parsed.success) return c.json(err("VALIDATION_ERROR", parsed.error.message), 400);
    const d = parsed.data;
    // 在宅区分: 確認時の指定 > 週出社日数からの導出（両者は重複情報のため出社日数を正とする）
    const bodyRemote = REMOTE_LEVELS.find((r) => r === body?.remoteLevel);
    const result = await createProject(auth, {
      // 案件名が抽出できなかった場合はファイル名を使うが、拡張子（.txt 等）は付けない
      name: d.name ?? job.sourceDocument.filename.replace(/\.[^.]+$/, ""),
      anonymousSummary: d.summary,
      startDate: d.startDate ?? new Date().toISOString().slice(0, 10),
      // 取込確定時は準委任として登録し、労働者派遣等は案件編集で設定する（派遣の必須項目は取込値に含まれないため）
      contractType: "準委任",
      rateMaxYen: d.rateMaxYen ?? 800_000,
      locationCity: d.locationCity ?? undefined,
      // 週出社日数は在宅区分と連動: 確認画面で在宅区分が指定されればそこから導出、
      // なければ抽出値の日数（在宅区分もそこから導出）を使う
      onsiteDaysPerWeek: bodyRemote
        ? remoteLevelToOnsiteDays(bodyRemote)
        : (d.onsiteDaysPerWeek ?? undefined),
      remoteLevel:
        bodyRemote ??
        (d.onsiteDaysPerWeek != null ? remoteLevelFromOnsiteDays(d.onsiteDaysPerWeek) : undefined),
      noForeignNational: d.noForeignNational ?? false, // 記載なし（null）は可として登録し、確認画面・案件編集で修正する
      requiredSkills: d.requiredSkills.map((name) => ({ name })),
      preferredSkills: d.preferredSkills.map((name) => ({ name })),
    });
    if ("error" in result) return c.json(err("VALIDATION_ERROR", result.error), 400);
    createdId = result.project.id;
    // 用語辞書の自動増補（Phase 2 名寄せ）
    await registerNewTermAliases([...d.requiredSkills, ...d.preferredSkills], auth.companyId);
  }

  // 匿名化済み原文を作成された案件・人材に保存する（詳細表示用）。
  // 人材は取込原本を職務経歴書（スキルシート）としてそのまま紐づける
  if (createdId && job.sourceDocument.kind === "ENGINEER_SHEET") {
    await prisma.engineer.update({
      where: { id: createdId },
      data: { maskedSourceText: job.extraction.maskedText, skillSheetDocumentId: job.sourceDocumentId },
    });
  } else if (createdId && job.sourceDocument.kind === "PROJECT_DESCRIPTION") {
    await prisma.project.update({
      where: { id: createdId },
      data: { maskedSourceText: job.extraction.maskedText },
    });
  }

  await prisma.extractionResult.update({
    where: { id: job.extraction.id },
    data: {
      confirmedJson: confirmed as object,
      confirmedByMemberId: auth.memberId,
      confirmedAt: new Date(),
    },
  });
  await prisma.ingestionJob.update({ where: { id: job.id }, data: { status: "CONFIRMED" } });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "IngestionConfirmed",
    targetType: "IngestionJob",
    targetId: job.id,
    metadata: { createdId },
  });
  return c.json({ ok: true, createdId, kind: job.sourceDocument.kind });
});

// ---- エントリー・双方承認・開示（§20, §28）----

app.get("/entries", requirePermission("entry.read"), async (c) => {
  return c.json({ items: await listEntries(c.get("auth")) });
});

app.post("/entries", requirePermission("entry.submit"), async (c) => {
  const parsed = z
    .object({
      type: z.enum(["PROPOSAL", "SCOUT"]),
      projectId: z.string(),
      engineerId: z.string(),
      note: z.string().optional(),
      subtierApproved: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await createEntry(c.get("auth"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json((result as { entry: unknown }).entry, 201);
});

app.get("/entries/:id", requirePermission("entry.read"), async (c) => {
  const entry = await getEntry(c.get("auth"), c.req.param("id"));
  if (!entry) return c.json(err("NOT_FOUND"), 404);
  return c.json(entry);
});

// Level 2 開示後の職務経歴書ダウンロード（エントリー当事者のみ・双方承認後のみ）
app.get("/entries/:id/skill-sheet", requirePermission("entry.read"), async (c) => {
  const file = await getEntrySkillSheetFile(c.get("auth"), c.req.param("id"));
  if (!file) return c.json(err("NOT_FOUND"), 404);
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    },
  });
});

app.post("/entries/:id/approvals", requirePermission("entry.approve"), async (c) => {
  const result = await approveEntry(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/entries/:id/decline", requirePermission("entry.approve"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await declineEntry(c.get("auth"), c.req.param("id"), body?.reason, "DECLINED");
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/entries/:id/withdraw", requirePermission("entry.submit"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await declineEntry(c.get("auth"), c.req.param("id"), body?.reason, "WITHDRAWN");
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/entries/:id/messages", requirePermission("message.send"), async (c) => {
  const parsed = z.object({ body: z.string().min(1).max(4000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await sendMessage(c.get("auth"), c.req.param("id"), parsed.data.body);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result.message, 201);
});

app.post("/entries/:id/interviews", requirePermission("interview.manage"), async (c) => {
  const parsed = z
    .object({ scheduledAt: z.string(), method: z.string(), note: z.string().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await scheduleInterview(c.get("auth"), c.req.param("id"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result.interview, 201);
});

app.post("/entries/:id/conditions", requirePermission("entry.approve"), async (c) => {
  const result = await moveToConditions(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// ---- 契約・稼働（§22, §28）----

app.get("/contracts", requirePermission("contract.read"), async (c) => {
  return c.json({ items: await listContracts(c.get("auth")) });
});

app.get("/contracts/:id", requirePermission("contract.read"), async (c) => {
  const contract = await getContract(c.get("auth"), c.req.param("id"));
  if (!contract) return c.json(err("NOT_FOUND"), 404);
  return c.json(contract);
});

app.post("/contracts", requirePermission("contract.create"), async (c) => {
  const parsed = z
    .object({
      entryId: z.string(),
      contractType: z.enum(["準委任", "請負", "労働者派遣"]),
      monthlyRateYen: z.number().int().positive(),
      startDate: z.string(),
      endDate: z.string().optional(),
      commandChecklist: z.record(z.string(), z.string()),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await createContract(c.get("auth"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json((result as { contract: unknown }).contract, 201);
});

// 署名完了前の契約修正（§22）。修正すると既存署名は取り消され双方の再署名が必要。
// version は編集開始時に取得した版数（他の担当者の修正を知らないままの上書き防止に必須）
app.put("/contracts/:id", requirePermission("contract.create"), async (c) => {
  const parsed = z
    .object({
      contractType: z.enum(["準委任", "請負", "労働者派遣"]),
      monthlyRateYen: z.number().int().positive(),
      startDate: z.string(),
      endDate: z.string().optional(),
      commandChecklist: z.record(z.string(), z.string()),
      notes: z.string().max(2000).optional(),
      version: z.number().int().positive(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await updateContract(c.get("auth"), c.req.param("id"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json((result as { contract: unknown }).contract);
});

app.post("/contracts/:id/sign", requirePermission("contract.sign"), async (c) => {
  // version は署名者が画面で閲覧していた契約の版数（修正競合の防止に必須）
  const parsed = z
    .object({ version: z.number().int().positive() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json(err("VALIDATION_ERROR", "署名には閲覧中の契約の版数（version）が必要です"), 400);
  const result = await signContract(c.get("auth"), c.req.param("id"), parsed.data.version);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/contracts/:id/work-start", requirePermission("contract.sign"), async (c) => {
  const parsed = z.object({ date: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await startWork(c.get("auth"), c.req.param("id"), parsed.data.date);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/contracts/:id/cancel", requirePermission("contract.sign"), async (c) => {
  const result = await cancelContract(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/contracts/:id/terminate", requirePermission("contract.sign"), async (c) => {
  const parsed = z
    .object({ date: z.string(), reason: z.string().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await terminateContract(c.get("auth"), c.req.param("id"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// 月次稼働確認 + 手数料計算（§23, §28）
app.post("/contracts/:id/work-months", requirePermission("workmonth.confirm"), async (c) => {
  const parsed = z
    .object({ month: z.string(), amountYen: z.number().int().positive() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await confirmWorkMonth(c.get("auth"), c.req.param("id"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result, 201);
});

// ---- 手数料・請求（§23, §28）----

app.get("/fees", requirePermission("billing.read"), async (c) => {
  return c.json({ items: await listFees(c.get("auth")) });
});

app.get("/invoices", requirePermission("billing.read"), async (c) => {
  return c.json({ items: await listInvoices(c.get("auth")) });
});

app.post("/invoices", requirePermission("billing.manage"), async (c) => {
  const parsed = z.object({ month: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await generateInvoice(c.get("auth"), parsed.data.month);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json((result as { invoice: unknown }).invoice, 201);
});

// ---- 本人訂正・削除請求（§26, §28）----

app.get("/privacy/requests", requirePermission("privacy.process"), async (c) => {
  return c.json({ items: await listPrivacyRequests(c.get("auth")) });
});

app.post("/privacy/requests", requirePermission("privacy.process"), async (c) => {
  const parsed = z
    .object({
      engineerId: z.string(),
      kind: z.enum(["CORRECTION", "DELETION"]),
      reason: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await createPrivacyRequest(c.get("auth"), parsed.data);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json((result as { request: unknown }).request, 201);
});

app.post("/privacy/requests/:id/decision", requirePermission("privacy.process"), async (c) => {
  const parsed = z.object({ approve: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const result = await decidePrivacyRequest(c.get("auth"), c.req.param("id"), parsed.data.approve);
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

app.post("/privacy/requests/:id/purge", requirePermission("privacy.process"), async (c) => {
  const result = await executePurge(c.get("auth"), c.req.param("id"));
  const er = svcError(result);
  if (er) return c.json(err(er.code, er.message), statusFor(er.code));
  return c.json(result);
});

// ---- 企業間関係（§8.2, §12.4）----

app.get("/relationships", requirePermission("relationship.manage"), async (c) => {
  const items = await prisma.companyRelationship.findMany({
    where: { companyId: c.get("auth").companyId },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ items });
});

app.post("/relationships", requirePermission("relationship.manage"), async (c) => {
  const parsed = z
    .object({
      partnerName: z.string().min(1),
      type: z.enum(["PARTNER", "SUBTIER", "SALES_DELEGATION"]),
      contractConfirmed: z.boolean().optional(),
      note: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const auth = c.get("auth");
  const rel = await prisma.companyRelationship.create({
    data: { companyId: auth.companyId, ...parsed.data },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "RelationshipRegistered",
    targetType: "CompanyRelationship",
    targetId: rel.id,
    metadata: { type: rel.type },
  });
  return c.json(rel, 201);
});

// ---- 通報・異議申立て（§24, Phase 2）----

app.get("/reports", requirePermission("report.create"), async (c) => {
  const items = await prisma.report.findMany({
    where: { tenantCompanyId: c.get("auth").companyId },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ items });
});

app.post("/reports", requirePermission("report.create"), async (c) => {
  const parsed = z
    .object({
      category: z.string().min(1),
      targetRef: z.string().optional(),
      body: z.string().min(1).max(4000),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR"), 400);
  const auth = c.get("auth");
  const report = await prisma.report.create({
    data: { tenantCompanyId: auth.companyId, ...parsed.data },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ReportSubmitted",
    targetType: "Report",
    targetId: report.id,
    metadata: { category: report.category },
  });
  return c.json(report, 201);
});

// ---- お問合せ（企業→運営）----

// お問合せ番号の採番: システム全体の最大番号+1（Q+6桁。案件・人材コードと同方式）
async function nextInquiryCode(): Promise<string> {
  const rows = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(code FROM '[0-9]+$') AS INTEGER)) AS max
    FROM inquiries WHERE code ~ '^Q[0-9]+$'`;
  return `Q${String(Number(rows[0]?.max ?? 0) + 1).padStart(6, "0")}`;
}

// 認証済みの担当者なら誰でも送信できる（権限不要）
app.post("/inquiries", async (c) => {
  const parsed = z
    .object({ category: z.string().min(1).max(50), body: z.string().min(1).max(5000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", "分類と内容を入力してください"), 400);
  const auth = c.get("auth");
  const inquiry = await prisma.inquiry.create({
    data: {
      code: await nextInquiryCode(),
      tenantCompanyId: auth.companyId,
      memberId: auth.memberId,
      ...parsed.data,
    },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "InquirySubmitted",
    targetType: "Inquiry",
    targetId: inquiry.id,
    metadata: { category: inquiry.category },
  });
  // 運営宛の通知メール（OPERATIONS_MAIL 未設定時は送らない。送信失敗しても受付は成立）
  const opsMail = process.env.OPERATIONS_MAIL;
  if (opsMail) {
    await sendMail({
      to: opsMail,
      subject: `【お問合せ ${inquiry.code}】${inquiry.category} — ${auth.companyName}`,
      body: `企業: ${auth.companyName}\n担当者: ${auth.userName}\n分類: ${inquiry.category}\n\n${inquiry.body}\n\n運営コンソール: ${appBaseUrl()}/admin#inquiries`,
    });
  }
  return c.json(inquiry, 201);
});

// 自社のお問合せ履歴（スレッド付き）
app.get("/inquiries", async (c) => {
  const auth = c.get("auth");
  const items = await prisma.inquiry.findMany({
    where: { tenantCompanyId: auth.companyId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return c.json({ items });
});

// お問合せへの追記（企業側）。返信すると状態は「受付済み（OPEN）」に戻る
app.post("/inquiries/:id/messages", async (c) => {
  const parsed = z
    .object({ body: z.string().min(1).max(5000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("VALIDATION_ERROR", "内容を入力してください"), 400);
  const auth = c.get("auth");
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: c.req.param("id"), tenantCompanyId: auth.companyId }, // テナント分離
  });
  if (!inquiry) return c.json(err("NOT_FOUND"), 404);
  const message = await prisma.inquiryMessage.create({
    data: { inquiryId: inquiry.id, fromOperator: false, body: parsed.data.body },
  });
  await prisma.inquiry.update({ where: { id: inquiry.id }, data: { status: "OPEN" } });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "InquiryReplied",
    targetType: "Inquiry",
    targetId: inquiry.id,
  });
  const opsMail = process.env.OPERATIONS_MAIL;
  if (opsMail) {
    await sendMail({
      to: opsMail,
      subject: `【お問合せ追記 ${inquiry.code}】${inquiry.category} — ${auth.companyName}`,
      body: `企業: ${auth.companyName}\n担当者: ${auth.userName}\n\n${parsed.data.body}\n\n運営コンソール: ${appBaseUrl()}/admin#inquiries`,
    });
  }
  return c.json(message, 201);
});

// ---- 監査（§28, §31）----

app.get("/audit-events", requirePermission("audit.read"), async (c) => {
  const auth = c.get("auth");
  const items = await prisma.auditEvent.findMany({
    where: { tenantCompanyId: auth.companyId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return c.json({ items });
});
