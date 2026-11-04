// 企業のセキュリティ設定: IP 制限（PRO版仕様書 §4.12）と SSO 設定（§4.13）。
// 2要素認証の必須化は auth/mfa.ts。設定変更はすべて監査に記録する（個人情報は書かない）。
//
// - IP 制限: 許可 IP／CIDR を20件まで。設定者の現在 IP を含まないリストは保存できない（ロックアウト防止）。
//   PRO でなくなれば制限は効かない（effectiveIpAllowList）。運営は緊急解除できる（監査・代表へメール）
// - SSO: OIDC（issuer・clientId・clientSecret）または SAML（IdP の SSO URL・証明書）。
//   設定は JSON を AES-GCM で暗号化して保存。企業識別子 slug は SSO 開始 URL に使う。
//   SSO 必須化（パスワードログイン禁止）は代表（OWNER）を除いて適用する

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { decryptString, encryptString } from "@/server/crypto";
import { appBaseUrl, sendMail } from "@/server/mail";
import { hasFeature } from "@/server/plan/features";
import type { AuthContext } from "@/server/auth/session";
import { isIpAllowed, validateIpAllowList } from "./ip";
import { normalizeCert, samlMetadata } from "./sso/saml";

export type SsoConfig =
  | { provider: "OIDC"; issuer: string; clientId: string; clientSecret: string }
  | { provider: "SAML"; entryPoint: string; idpCert: string; idpIssuer?: string };

export const SSO_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

// SP 側の固定値（IdP に登録してもらう URL）
export function ssoServiceProvider(base = appBaseUrl()) {
  return {
    entityId: `${base}/api/v1/auth/sso/metadata`,
    acsUrl: `${base}/api/v1/auth/sso/callback`, // SAML（POST）
    redirectUri: `${base}/api/v1/auth/sso/callback`, // OIDC（GET）
  };
}

export const ssoStartUrl = (slug: string, base = appBaseUrl()) => `${base}/api/v1/auth/sso/${slug}/start`;

export function parseSsoConfig(encrypted: string | null): SsoConfig | null {
  if (!encrypted) return null;
  try {
    const parsed = JSON.parse(decryptString(encrypted)) as SsoConfig;
    return parsed && (parsed.provider === "OIDC" || parsed.provider === "SAML") ? parsed : null;
  } catch {
    return null;
  }
}

// ---- 参照 ----

export async function getSecurityOverview(auth: AuthContext, currentIp: string | null) {
  const s = await prisma.companySecuritySettings.findUnique({ where: { companyId: auth.companyId } });
  const ipAllowList = Array.isArray(s?.ipAllowList) ? (s!.ipAllowList as string[]) : [];
  const cfg = parseSsoConfig(s?.ssoConfigEncrypted ?? null);
  const sp = ssoServiceProvider();
  return {
    ipRestriction: {
      allowList: ipAllowList,
      currentIp,
      active: hasFeature(auth, "ip_restriction") && ipAllowList.length > 0,
      currentIpAllowed: isIpAllowed(currentIp, ipAllowList),
    },
    sso: {
      provider: s?.ssoProvider ?? "NONE",
      slug: s?.ssoSlug ?? null,
      required: s?.ssoRequired ?? false,
      configured: cfg != null,
      oidc: cfg?.provider === "OIDC" ? { issuer: cfg.issuer, clientId: cfg.clientId, hasSecret: !!cfg.clientSecret } : null,
      saml: cfg?.provider === "SAML" ? { entryPoint: cfg.entryPoint, idpIssuer: cfg.idpIssuer ?? "", certLength: cfg.idpCert.length } : null,
      sp: { ...sp, metadataUrl: `${appBaseUrl()}/api/v1/auth/sso/metadata`, startUrl: s?.ssoSlug ? ssoStartUrl(s.ssoSlug) : null },
    },
  };
}

// ---- IP 制限 ----

export async function setIpAllowList(auth: AuthContext, entries: string[], currentIp: string | null) {
  const validated = validateIpAllowList(entries);
  if ("error" in validated) return { error: { code: "VALIDATION_ERROR" as const, message: validated.error } };
  const list = validated.list;
  if (list.length > 0) {
    if (!hasFeature(auth, "ip_restriction"))
      return { error: { code: "PLAN_REQUIRED" as const, message: "IP アドレス制限は PRO 版でご利用いただけます" } };
    if (!isIpAllowed(currentIp, list))
      return {
        error: {
          code: "VALIDATION_ERROR" as const,
          message: `現在の接続元 IP（${currentIp ?? "不明"}）が許可リストに含まれていないため保存できません（ロックアウト防止）`,
        },
      };
  }
  await prisma.companySecuritySettings.upsert({
    where: { companyId: auth.companyId },
    create: { companyId: auth.companyId, ipAllowList: list, updatedByMemberId: auth.memberId },
    update: { ipAllowList: list, updatedByMemberId: auth.memberId },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "IpAllowListChanged",
    targetType: "Company",
    targetId: auth.companyId,
    metadata: { count: list.length, entries: list },
  });
  return { ok: true, allowList: list };
}

// 運営: IP 制限の緊急解除（ロックアウト時のサポート用）。監査に記録し代表へメールする
export async function unlockIpRestrictionByOperations(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, include: { securitySettings: true } });
  if (!company) return { error: { code: "NOT_FOUND" as const } };
  const before = Array.isArray(company.securitySettings?.ipAllowList) ? (company.securitySettings!.ipAllowList as string[]) : [];
  if (before.length === 0) return { error: { code: "VERSION_CONFLICT" as const, message: "IP 制限は設定されていません" } };
  await prisma.companySecuritySettings.update({ where: { companyId }, data: { ipAllowList: [] } });
  await audit({
    tenantCompanyId: companyId,
    action: "IpRestrictionUnlockedByOperations",
    targetType: "Company",
    targetId: companyId,
    metadata: { by: "operations", previousCount: before.length },
  });
  await notifyOwners(
    companyId,
    "【SES DirectMatch】IP アドレス制限を運営が解除しました",
    (name) => `${name} 様（${company.name}）

サポート対応のため、貴社の IP アドレス制限（${before.length}件）を運営が解除しました。
必要に応じて企業コンソール「会社マイページ > セキュリティ」で再設定してください。
${appBaseUrl()}/settings/security

本操作は監査ログに記録されています。心当たりがない場合はお問合せください。`
  );
  return { ok: true };
}

// ---- SSO 設定 ----

export type SsoSettingsInput = {
  provider: "NONE" | "OIDC" | "SAML";
  slug?: string | null;
  required?: boolean;
  oidc?: { issuer: string; clientId: string; clientSecret?: string };
  saml?: { entryPoint: string; idpCert: string; idpIssuer?: string };
};

export async function setSsoSettings(auth: AuthContext, input: SsoSettingsInput) {
  const existing = await prisma.companySecuritySettings.findUnique({ where: { companyId: auth.companyId } });
  const current = parseSsoConfig(existing?.ssoConfigEncrypted ?? null);
  const required = input.required ?? false;
  if (input.provider !== "NONE" || required) {
    if (!hasFeature(auth, "sso")) return { error: { code: "PLAN_REQUIRED" as const, message: "SSO は PRO 版でご利用いただけます" } };
  }
  let slug: string | null = existing?.ssoSlug ?? null;
  if (input.provider !== "NONE") {
    slug = (input.slug ?? slug ?? "").trim().toLowerCase();
    if (!SSO_SLUG_RE.test(slug))
      return { error: { code: "VALIDATION_ERROR" as const, message: "SSO 識別子は英小文字・数字・ハイフンで3〜32文字にしてください" } };
    const taken = await prisma.companySecuritySettings.findUnique({ where: { ssoSlug: slug } });
    if (taken && taken.companyId !== auth.companyId)
      return { error: { code: "VERSION_CONFLICT" as const, message: "この SSO 識別子は使用されています" } };
  }
  let config: SsoConfig | null = null;
  if (input.provider === "OIDC") {
    const o = input.oidc;
    const issuer = o?.issuer?.trim() ?? "";
    const clientId = o?.clientId?.trim() ?? "";
    const clientSecret = o?.clientSecret?.trim() || (current?.provider === "OIDC" ? current.clientSecret : "");
    if (!/^https:\/\//.test(issuer)) return { error: { code: "VALIDATION_ERROR" as const, message: "Issuer は https:// で始まる URL を入力してください" } };
    if (!clientId || !clientSecret)
      return { error: { code: "VALIDATION_ERROR" as const, message: "クライアント ID とクライアントシークレットを入力してください" } };
    config = { provider: "OIDC", issuer: issuer.replace(/\/$/, ""), clientId, clientSecret };
  } else if (input.provider === "SAML") {
    const s = input.saml;
    const entryPoint = s?.entryPoint?.trim() ?? "";
    const idpCert = normalizeCert(s?.idpCert ?? "") || (current?.provider === "SAML" ? current.idpCert : "");
    if (!/^https:\/\//.test(entryPoint)) return { error: { code: "VALIDATION_ERROR" as const, message: "IdP の SSO URL は https:// で始まる URL を入力してください" } };
    if (!idpCert || !/^[A-Za-z0-9+/=]+$/.test(idpCert) || idpCert.length < 100)
      return { error: { code: "VALIDATION_ERROR" as const, message: "IdP の署名証明書（PEM）を貼り付けてください" } };
    config = { provider: "SAML", entryPoint, idpCert, idpIssuer: s?.idpIssuer?.trim() || undefined };
  }
  if (required && !config)
    return { error: { code: "VALIDATION_ERROR" as const, message: "SSO 必須化には先に IdP の設定が必要です" } };
  await prisma.companySecuritySettings.upsert({
    where: { companyId: auth.companyId },
    create: {
      companyId: auth.companyId,
      ssoProvider: input.provider,
      ssoSlug: input.provider === "NONE" ? null : slug,
      ssoConfigEncrypted: config ? encryptString(JSON.stringify(config)) : null,
      ssoRequired: required && !!config,
      updatedByMemberId: auth.memberId,
    },
    update: {
      ssoProvider: input.provider,
      ssoSlug: input.provider === "NONE" ? null : slug,
      ssoConfigEncrypted: config ? encryptString(JSON.stringify(config)) : null,
      ssoRequired: required && !!config,
      updatedByMemberId: auth.memberId,
    },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "SsoSettingsChanged",
    targetType: "Company",
    targetId: auth.companyId,
    metadata: { provider: input.provider, required: required && !!config, slug: input.provider === "NONE" ? null : slug },
  });
  return { ok: true };
}

// SSO 開始用: slug から企業と設定を引く（PRO でなければ null）
export async function findSsoCompanyBySlug(slug: string) {
  const s = await prisma.companySecuritySettings.findUnique({ where: { ssoSlug: slug.toLowerCase() }, include: { company: true } });
  if (!s || s.ssoProvider === "NONE" || s.company.status !== "ACTIVE") return null;
  if (!hasFeature(s.company, "sso")) return null;
  const config = parseSsoConfig(s.ssoConfigEncrypted);
  if (!config || config.provider !== s.ssoProvider) return null;
  return { companyId: s.companyId, companyName: s.company.name, config, required: s.ssoRequired };
}

export function samlSpMetadataXml(): string {
  const sp = ssoServiceProvider();
  return samlMetadata(null, { entityId: sp.entityId, callbackUrl: sp.acsUrl });
}

async function notifyOwners(companyId: string, subject: string, body: (name: string) => string) {
  try {
    const owners = await prisma.companyMember.findMany({
      where: { companyId, status: "ACTIVE", roles: { some: { role: "OWNER" } } },
      include: { userAccount: true },
    });
    await Promise.all(owners.map((m) => sendMail({ to: m.userAccount.email, subject, body: body(m.userAccount.name) })));
  } catch (e) {
    console.error("[security] 代表への通知に失敗", e);
  }
}
