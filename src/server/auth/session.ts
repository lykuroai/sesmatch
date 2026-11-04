import { randomBytes } from "crypto";
import { prisma } from "@/server/db";
import { effectivePlan, type CompanyPlan } from "@/server/plan/features";

export const SESSION_COOKIE = "sesmatch_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8時間

export type AuthContext = {
  userAccountId: string;
  userName: string;
  email: string;
  memberId: string;
  companyId: string; // 企業IDは認証情報から確定し、入力値を信用しない（§31）
  companyName: string;
  roles: string[];
  plan: CompanyPlan; // 実効プラン（期限切れの TRIAL/PRO は FREE。PRO版仕様書 §5）
  mfaEnabled: boolean; // 本人の2要素認証が有効か（§4.11）
  mfaRequired: boolean; // 企業が2要素認証を必須化しているか（PRO のときのみ実効）
};

export async function createSession(userAccountId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, userAccountId, expiresAt } });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}

export async function resolveSession(token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { userAccount: true },
  });
  if (!session || session.expiresAt < new Date()) return null;

  // ログイン後、所属企業コンソールを自動表示（§8.1）。MVPでは1ユーザー=1企業所属を前提とする。
  const member = await prisma.companyMember.findFirst({
    where: { userAccountId: session.userAccountId, status: "ACTIVE" },
    include: { company: { include: { securitySettings: { select: { mfaRequired: true } } } }, roles: true },
  });
  if (!member || member.company.status !== "ACTIVE") return null;
  const mfa = await prisma.userMfa.findUnique({ where: { userAccountId: session.userAccountId }, select: { enabledAt: true } });
  const plan = effectivePlan(member.company);

  return {
    userAccountId: session.userAccountId,
    userName: session.userAccount.name,
    email: session.userAccount.email,
    memberId: member.id,
    companyId: member.companyId,
    companyName: member.company.name,
    roles: member.roles.map((r) => r.role),
    plan,
    mfaEnabled: !!mfa?.enabledAt,
    mfaRequired: plan !== "FREE" && !!member.company.securitySettings?.mfaRequired,
  };
}
