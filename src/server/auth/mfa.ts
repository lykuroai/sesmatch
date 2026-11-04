// 2要素認証（TOTP）と企業の必須化設定（PRO版仕様書 §4.11）
//
// - 2要素認証（認証アプリ）は基本版にも任意利用として提供する。バックアップコード10個を発行する
// - PRO は「全担当者に必須化」を設定できる。有効化後、未設定のメンバーは設定完了まで他の操作ができない
//   （API は 403 MFA_REQUIRED、コンソールは設定画面を表示）
// - 代表（OWNER）は必須化の解除ができる。運営はサポート目的で個人の2要素をリセットできる（監査記録）
// - 秘密鍵は暗号化保存、バックアップコードは SHA-256 で保存（1回のみ有効）

import { createHash } from "crypto";
import QRCode from "qrcode";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { decryptString, encryptString } from "@/server/crypto";
import { effectivePlan, hasFeature } from "@/server/plan/features";
import { generateBackupCodes, generateTotpSecret, otpauthUrl, verifyTotp } from "./totp";

const ISSUER = "SES DirectMatch";
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const hashCode = (c: string) => createHash("sha256").update(c.toUpperCase().replace(/\s|-/g, "")).digest("hex");

export async function getMfaStatus(userAccountId: string) {
  const m = await prisma.userMfa.findUnique({ where: { userAccountId } });
  return { enabled: !!m?.enabledAt, pendingSetup: !!m && !m.enabledAt, backupCodesLeft: m ? (m.backupCodes as string[]).length : 0 };
}

// 設定開始: 新しい秘密鍵を発行（未有効）。QR（data URL）と手入力用キーを返す
export async function beginMfaSetup(auth: AuthContext) {
  const existing = await prisma.userMfa.findUnique({ where: { userAccountId: auth.userAccountId } });
  if (existing?.enabledAt) return { error: { code: "VERSION_CONFLICT" as const, message: "2要素認証は既に有効です。変更するには一度無効化してください" } };
  const secret = generateTotpSecret();
  await prisma.userMfa.upsert({
    where: { userAccountId: auth.userAccountId },
    create: { userAccountId: auth.userAccountId, secretEncrypted: encryptString(secret), backupCodes: [] },
    update: { secretEncrypted: encryptString(secret), enabledAt: null, backupCodes: [] },
  });
  const url = otpauthUrl(ISSUER, auth.email, secret);
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 200 });
  return { secret, otpauthUrl: url, qrDataUrl };
}

// 有効化: 認証アプリのコードを検証し、バックアップコードを発行して返す（平文はこのときだけ）
export async function enableMfa(auth: AuthContext, code: string) {
  const m = await prisma.userMfa.findUnique({ where: { userAccountId: auth.userAccountId } });
  if (!m) return { error: { code: "VALIDATION_ERROR" as const, message: "先に設定を開始してください" } };
  if (m.enabledAt) return { error: { code: "VERSION_CONFLICT" as const, message: "既に有効です" } };
  if (!verifyTotp(decryptString(m.secretEncrypted), code))
    return { error: { code: "VALIDATION_ERROR" as const, message: "コードが一致しません。認証アプリの時刻設定を確認してください" } };
  const codes = generateBackupCodes();
  await prisma.userMfa.update({
    where: { userAccountId: auth.userAccountId },
    data: { enabledAt: new Date(), backupCodes: codes.map(hashCode), lastUsedAt: new Date() },
  });
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "MfaEnabled", targetType: "UserAccount", targetId: auth.userAccountId });
  return { ok: true, backupCodes: codes };
}

// 無効化（本人。コードまたはバックアップコードで確認）。企業が必須化している場合は不可
export async function disableMfa(auth: AuthContext, code: string) {
  if (auth.mfaRequired) return { error: { code: "FORBIDDEN" as const, message: "貴社は2要素認証を必須にしているため無効化できません" } };
  const ok = await verifyMfaCode(auth.userAccountId, code);
  if (!ok) return { error: { code: "VALIDATION_ERROR" as const, message: "コードが一致しません" } };
  await prisma.userMfa.delete({ where: { userAccountId: auth.userAccountId } });
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "MfaDisabled", targetType: "UserAccount", targetId: auth.userAccountId });
  return { ok: true };
}

// ログイン時などの検証: TOTP またはバックアップコード（1回のみ）
export async function verifyMfaCode(userAccountId: string, code: string): Promise<boolean> {
  const m = await prisma.userMfa.findUnique({ where: { userAccountId } });
  if (!m?.enabledAt) return false;
  if (verifyTotp(decryptString(m.secretEncrypted), code)) {
    await prisma.userMfa.update({ where: { userAccountId }, data: { lastUsedAt: new Date() } });
    return true;
  }
  const hashed = hashCode(code);
  const codes = m.backupCodes as string[];
  if (!codes.includes(hashed)) return false;
  await prisma.userMfa.update({
    where: { userAccountId },
    data: { backupCodes: codes.filter((c) => c !== hashed), lastUsedAt: new Date() },
  });
  return true;
}

// ---- ログインの第2段階 ----

export async function createMfaChallenge(userAccountId: string) {
  await prisma.mfaChallenge.deleteMany({ where: { OR: [{ userAccountId }, { expiresAt: { lt: new Date() } }] } });
  const c = await prisma.mfaChallenge.create({ data: { userAccountId, expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL_MS) } });
  return c.id;
}

export async function consumeMfaChallenge(challengeId: string, code: string): Promise<string | null> {
  const c = await prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
  if (!c || c.expiresAt < new Date()) return null;
  const ok = await verifyMfaCode(c.userAccountId, code);
  if (!ok) return null;
  await prisma.mfaChallenge.delete({ where: { id: challengeId } }).catch(() => {});
  return c.userAccountId;
}

// ---- 企業の必須化（PRO）----

export async function getSecuritySettings(auth: AuthContext) {
  const s = await prisma.companySecuritySettings.findUnique({ where: { companyId: auth.companyId } });
  const members = await prisma.companyMember.findMany({
    where: { companyId: auth.companyId, status: "ACTIVE" },
    include: { userAccount: { include: { mfa: { select: { enabledAt: true } } } } },
  });
  return {
    mfaRequired: s?.mfaRequired ?? false,
    members: members.map((m) => ({ name: m.userAccount.name, mfaEnabled: !!m.userAccount.mfa?.enabledAt })),
  };
}

export async function setMfaRequired(auth: AuthContext, required: boolean) {
  if (required && !hasFeature(auth, "mfa_required"))
    return { error: { code: "PLAN_REQUIRED" as const, message: "2要素認証の必須化は PRO 版でご利用いただけます" } };
  if (required && !auth.mfaEnabled)
    return { error: { code: "VALIDATION_ERROR" as const, message: "先にご自身の2要素認証を有効にしてください（必須化後に自分がロックされるのを防ぐため）" } };
  await prisma.companySecuritySettings.upsert({
    where: { companyId: auth.companyId },
    create: { companyId: auth.companyId, mfaRequired: required, updatedByMemberId: auth.memberId },
    update: { mfaRequired: required, updatedByMemberId: auth.memberId },
  });
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "MfaRequirementChanged", targetType: "Company", targetId: auth.companyId, metadata: { required } });
  return { ok: true };
}

// 企業の必須化が実効か（設定が ON かつ PRO。PRO でなくなれば必須化は効かない）
export async function isMfaRequiredFor(company: { id: string; plan: "FREE" | "TRIAL" | "PRO"; planExpiresAt: Date | null }): Promise<boolean> {
  if (effectivePlan(company) === "FREE") return false;
  const s = await prisma.companySecuritySettings.findUnique({ where: { companyId: company.id }, select: { mfaRequired: true } });
  return s?.mfaRequired ?? false;
}

// 運営: 個人の2要素をリセット（サポート用）
export async function resetMfaByOperations(memberId: string) {
  const member = await prisma.companyMember.findUnique({ where: { id: memberId } });
  if (!member) return { error: { code: "NOT_FOUND" as const } };
  await prisma.userMfa.deleteMany({ where: { userAccountId: member.userAccountId } });
  await audit({ tenantCompanyId: member.companyId, action: "MfaResetByOperations", targetType: "UserAccount", targetId: member.userAccountId, metadata: { by: "operations" } });
  return { ok: true };
}
