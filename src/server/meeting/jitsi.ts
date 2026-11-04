// Web 会議（自前 Jitsi Meet）の純粋ロジック（PRO版仕様書 §4.8）
//
// - 会議室名はランダムな識別子（案件名・氏名を含めない）
// - 入室には本プラットフォームが発行する短命の JWT（Jitsi の JWT 認証: HS256、aud=jitsi, iss=JITSI_APP_ID, sub=JITSI_DOMAIN, room）
// - 人材本人はログイン不要のゲスト URL（トークンは DB に SHA-256 で保存。面談予定の前後1時間のみ有効）
// - 環境変数: JITSI_DOMAIN（例 meet.lykuro.ai）、JITSI_APP_ID、JITSI_APP_SECRET。未設定なら Web 会議は提供しない

import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";

export const GUEST_WINDOW_MS = 60 * 60 * 1000; // 面談予定の前後1時間
export const MEETING_JWT_TTL_SEC = 2 * 60 * 60; // 参加 JWT の有効期間（2時間）

export function jitsiConfig(): { domain: string; appId: string; appSecret: string } | null {
  const domain = process.env.JITSI_DOMAIN;
  const appId = process.env.JITSI_APP_ID;
  const appSecret = process.env.JITSI_APP_SECRET;
  if (!domain || !appId || !appSecret) return null;
  return { domain, appId, appSecret };
}

export function newRoomId(): string {
  return `ses-${randomBytes(12).toString("hex")}`;
}

export function newGuestToken(): string {
  return randomBytes(24).toString("hex");
}

export const hashGuestToken = (t: string) => createHash("sha256").update(t).digest("hex");

// ゲスト URL の有効期間（面談予定の前後1時間）
export function guestWindow(scheduledAt: Date): { from: Date; to: Date } {
  return { from: new Date(scheduledAt.getTime() - GUEST_WINDOW_MS), to: new Date(scheduledAt.getTime() + GUEST_WINDOW_MS) };
}

export function isWithinGuestWindow(scheduledAt: Date, now = new Date()): boolean {
  const w = guestWindow(scheduledAt);
  return now >= w.from && now <= w.to;
}

// 参加 JWT（Jitsi の JWT 認証仕様に準拠）。表示名のみ渡し、メール・企業名は渡さない
export function signMeetingJwt(
  cfg: { appId: string; appSecret: string; domain: string },
  input: { room: string; displayName: string; moderator: boolean; ttlSec?: number },
  now = new Date()
): string {
  const iat = Math.floor(now.getTime() / 1000);
  return jwt.sign(
    {
      aud: "jitsi",
      iss: cfg.appId,
      sub: cfg.domain,
      room: input.room,
      iat,
      nbf: iat - 10,
      exp: iat + (input.ttlSec ?? MEETING_JWT_TTL_SEC),
      context: { user: { name: input.displayName, moderator: input.moderator ? "true" : "false" } },
    },
    cfg.appSecret,
    { algorithm: "HS256" }
  );
}

export function verifyMeetingJwt(cfg: { appId: string; appSecret: string }, token: string): { room: string; name: string } | null {
  try {
    const p = jwt.verify(token, cfg.appSecret, { algorithms: ["HS256"], audience: "jitsi", issuer: cfg.appId }) as { room: string; context?: { user?: { name?: string } } };
    return { room: p.room, name: p.context?.user?.name ?? "" };
  } catch {
    return null;
  }
}

export function meetingUrl(domain: string, room: string, token: string): string {
  return `https://${domain}/${encodeURIComponent(room)}?jwt=${encodeURIComponent(token)}`;
}
