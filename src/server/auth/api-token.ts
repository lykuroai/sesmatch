// APIトークン（PAT）認証（local_server_spec_v0_1.md §4.1）
// ローカルサーバ等の機械連携向け。メンバー単位で発行し、実効権限は
// 「スコープに含まれる権限 ∩ メンバー本人のロール権限」で決まる。
// 平文は発行時に一度だけ返し、DBにはSHA-256ハッシュのみ保存する。

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { hasPermission, type Permission } from "./rbac";
import type { AuthContext } from "./session";

export const TOKEN_PREFIX = "ses_pat_";

// スコープ → 許可される権限。商談申込みの承認・契約・請求・メンバー管理は含めない
// （トークン漏えい時の被害を取込・登録・提案までに限定する）
export const TOKEN_SCOPES: Record<string, Permission[]> = {
  ingest: ["ingestion.create"],
  "ingest-register": ["ingestion.create", "engineer.create", "project.create"],
  // ローカルサーバ v0.2（仕様書 §9: 公開送信・検索・人材提案／案件紹介）向け
  connector: [
    "ingestion.create",
    "engineer.create",
    "project.create",
    "engineer.read.masked",
    "project.read",
    "engineer.publish",
    "project.publish",
    "entry.submit",
    "entry.read",
  ],
};

export type TokenScopeName = keyof typeof TOKEN_SCOPES;

const hashToken = (plain: string) => createHash("sha256").update(plain).digest("hex");

// lastUsedAt はアクセス毎ではなく1時間に1回だけ更新する（書き込み負荷対策）
const LAST_USED_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export type ApiTokenAuth = {
  auth: AuthContext;
  tokenPermissions: Permission[]; // スコープ由来の権限（実効権限はロールとの積集合で判定する）
};

// Bearer トークンを検証して AuthContext を組み立てる。無効なら null
export async function resolveApiToken(bearer: string | undefined): Promise<ApiTokenAuth | null> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX)) return null;
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(bearer) },
    include: { member: { include: { userAccount: true, company: true, roles: true } } },
  });
  if (!token || token.revokedAt) return null;
  if (token.expiresAt && token.expiresAt < new Date()) return null;
  // メンバー無効化・企業停止で自動失効（§4.1）
  if (token.member.status !== "ACTIVE" || token.member.company.status !== "ACTIVE") return null;

  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS) {
    await prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  const scopePermissions = TOKEN_SCOPES[token.scope] ?? [];
  return {
    auth: {
      userAccountId: token.member.userAccountId,
      userName: token.member.userAccount.name,
      email: token.member.userAccount.email,
      memberId: token.member.id,
      companyId: token.member.companyId,
      companyName: token.member.company.name,
      roles: token.member.roles.map((r) => r.role),
    },
    tokenPermissions: scopePermissions,
  };
}

// トークン発行（発行者本人のトークンとして作成）。平文は戻り値でのみ返す
export async function issueApiToken(
  auth: AuthContext,
  params: { name: string; scope: TokenScopeName; expiresInDays: number | null }
) {
  const scopePermissions = TOKEN_SCOPES[params.scope];
  if (!scopePermissions) return { error: { code: "VALIDATION_ERROR" as const, message: "スコープが不正です" } };
  // スコープの権限を1つも持たないメンバーには発行しない（実効権限が空のトークンを防ぐ）
  if (!scopePermissions.some((p) => hasPermission(auth.roles, p)))
    return {
      error: {
        code: "FORBIDDEN" as const,
        message: "このスコープに必要な権限がありません（トークンの実効権限は本人の権限との積集合です）",
      },
    };
  const plain = `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  const created = await prisma.apiToken.create({
    data: {
      tokenHash: hashToken(plain),
      name: params.name,
      memberId: auth.memberId,
      scope: params.scope,
      expiresAt:
        params.expiresInDays != null
          ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
    },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ApiTokenIssued",
    targetType: "ApiToken",
    targetId: created.id,
    metadata: { name: params.name, scope: params.scope, expiresAt: created.expiresAt },
  });
  return { token: plain, item: serializeToken({ ...created, member: { userAccount: { name: auth.userName } } }) };
}

// 一覧: 自分のトークン。member.manage 権限があれば自社全員分
export async function listApiTokens(auth: AuthContext) {
  const companyWide = hasPermission(auth.roles, "member.manage");
  const tokens = await prisma.apiToken.findMany({
    where: companyWide
      ? { member: { companyId: auth.companyId } }
      : { memberId: auth.memberId },
    include: { member: { include: { userAccount: true } } },
    orderBy: { createdAt: "desc" },
  });
  return { items: tokens.map(serializeToken) };
}

// 失効: 自分のトークン、または member.manage 権限で自社トークン
export async function revokeApiToken(auth: AuthContext, tokenId: string) {
  const token = await prisma.apiToken.findFirst({
    where: { id: tokenId, member: { companyId: auth.companyId } }, // テナント分離
    include: { member: true },
  });
  if (!token) return { error: { code: "NOT_FOUND" as const } };
  if (token.memberId !== auth.memberId && !hasPermission(auth.roles, "member.manage"))
    return { error: { code: "FORBIDDEN" as const, message: "他の担当者のトークンを失効する権限がありません" } };
  if (token.revokedAt) return { error: { code: "VERSION_CONFLICT" as const, message: "既に失効済みです" } };
  await prisma.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ApiTokenRevoked",
    targetType: "ApiToken",
    targetId: token.id,
    metadata: { name: token.name },
  });
  return { ok: true };
}

function serializeToken(t: {
  id: string;
  name: string;
  scope: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  member: { userAccount: { name: string } } | null;
}) {
  return {
    id: t.id,
    name: t.name,
    scope: t.scope,
    issuerName: t.member?.userAccount.name ?? null,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    revokedAt: t.revokedAt,
    createdAt: t.createdAt,
  };
}
