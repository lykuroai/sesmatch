// Web 会議（コンソール組込みの自前 Jitsi）のサービス（PRO版仕様書 §4.8）
//
// - 面談に紐づく会議室を PRO 側が作成する（商談の両社いずれかが PRO なら開催可。相手が FREE でも参加可）
// - 両社の担当者はコンソール内で参加（参加 JWT）。人材本人はゲスト URL（/m/<token>、ログイン不要、面談前後1時間）
// - 録画・文字起こしはしない。監査には作成・開始・終了・参加者種別のみ記録し、会話内容・氏名は記録しない
// - 面談のキャンセル・日時変更で会議室とゲスト URL を無効化する

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { effectivePlan, hasFeature } from "@/server/plan/features";
import { appBaseUrl } from "@/server/mail";
import { guestWindow, hashGuestToken, isWithinGuestWindow, jitsiConfig, meetingUrl, newGuestToken, newRoomId, signMeetingJwt } from "@/server/meeting/jitsi";

async function loadInterviewForParty(auth: AuthContext, interviewId: string) {
  const iv = await prisma.interview.findUnique({ where: { id: interviewId }, include: { entry: { select: { id: true, demandCompanyId: true, supplyCompanyId: true, status: true } } } });
  if (!iv) return null;
  if (iv.entry.demandCompanyId !== auth.companyId && iv.entry.supplyCompanyId !== auth.companyId) return null; // 当事者外は 404
  return iv;
}

export function meetingAvailable(): boolean {
  return jitsiConfig() != null;
}

// 会議室の作成（再発行）。作成できるのは PRO 側のみ
export async function createMeeting(auth: AuthContext, interviewId: string) {
  if (!meetingAvailable()) return { error: { code: "MEETING_NOT_AVAILABLE" as const, message: "Web 会議は現在ご利用いただけません（基盤が未設定です）" } };
  const gate = hasFeature(auth, "web_meeting");
  if (!gate) return { error: { code: "PLAN_REQUIRED" as const, message: "Web 会議の作成は PRO 版でご利用いただけます" } };
  const iv = await loadInterviewForParty(auth, interviewId);
  if (!iv) return { error: { code: "NOT_FOUND" as const } };
  if (iv.status !== "SCHEDULED") return { error: { code: "VERSION_CONFLICT" as const, message: "キャンセル・終了した面談には会議室を作成できません" } };
  const token = newGuestToken();
  const window = guestWindow(iv.scheduledAt);
  const updated = await prisma.interview.update({
    where: { id: iv.id },
    data: {
      meetingProvider: "JITSI",
      meetingRoomId: iv.meetingRoomId ?? newRoomId(),
      guestTokenHash: hashGuestToken(token),
      guestExpiresAt: window.to,
      method: "Web会議（組込み）",
    },
  });
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "MeetingCreated", targetType: "Interview", targetId: iv.id, metadata: { reissued: iv.meetingRoomId != null } });
  return { ok: true, interviewId: iv.id, roomId: updated.meetingRoomId, guestUrl: `${appBaseUrl()}/m/${token}`, guestValidFrom: window.from, guestValidTo: window.to };
}

// 会議室の無効化（面談のキャンセル等）
export async function revokeMeeting(auth: AuthContext, interviewId: string) {
  const iv = await loadInterviewForParty(auth, interviewId);
  if (!iv) return { error: { code: "NOT_FOUND" as const } };
  await prisma.interview.update({ where: { id: iv.id }, data: { meetingProvider: "NONE", meetingRoomId: null, guestTokenHash: null, guestExpiresAt: null } });
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "MeetingRevoked", targetType: "Interview", targetId: iv.id });
  return { ok: true };
}

// 担当者の参加 JWT（両社の当事者。相手が FREE でも参加可。会議室が無効なら 403）
export async function joinMeeting(auth: AuthContext, interviewId: string) {
  const cfg = jitsiConfig();
  if (!cfg) return { error: { code: "MEETING_NOT_AVAILABLE" as const, message: "Web 会議は現在ご利用いただけません" } };
  const iv = await loadInterviewForParty(auth, interviewId);
  if (!iv) return { error: { code: "NOT_FOUND" as const } };
  if (iv.meetingProvider !== "JITSI" || !iv.meetingRoomId || iv.status !== "SCHEDULED")
    return { error: { code: "MEETING_NOT_AVAILABLE" as const, message: "この面談の Web 会議は無効化されています" } };
  // 両社いずれかが PRO であること（作成側が FREE に戻った場合は開催不可）
  const companies = await prisma.company.findMany({ where: { id: { in: [iv.entry.demandCompanyId, iv.entry.supplyCompanyId] } }, select: { plan: true, planExpiresAt: true } });
  if (!companies.some((c) => effectivePlan(c) !== "FREE"))
    return { error: { code: "PLAN_REQUIRED" as const, message: "Web 会議は商談のいずれかの企業が PRO 版である必要があります" } };
  const token = signMeetingJwt(cfg, { room: iv.meetingRoomId, displayName: auth.userName, moderator: true });
  await prisma.interview.updateMany({ where: { id: iv.id, meetingStartedAt: null }, data: { meetingStartedAt: new Date() } });
  await audit({ tenantCompanyId: auth.companyId, actorUserId: auth.userAccountId, action: "MeetingJoined", targetType: "Interview", targetId: iv.id, metadata: { participant: "member" } });
  return { ok: true, domain: cfg.domain, room: iv.meetingRoomId, token, url: meetingUrl(cfg.domain, iv.meetingRoomId, token) };
}

// 人材本人のゲスト参加（ログイン不要。トークンの hash 照合・有効時間内のみ）
export async function joinMeetingAsGuest(guestToken: string, displayName: string, now = new Date()) {
  const cfg = jitsiConfig();
  if (!cfg) return { error: { code: "MEETING_NOT_AVAILABLE" as const, message: "Web 会議は現在ご利用いただけません" } };
  const iv = await prisma.interview.findFirst({ where: { guestTokenHash: hashGuestToken(guestToken), meetingProvider: "JITSI" }, include: { entry: { select: { demandCompanyId: true } } } });
  if (!iv || !iv.meetingRoomId || iv.status !== "SCHEDULED") return { error: { code: "NOT_FOUND" as const } };
  if (!isWithinGuestWindow(iv.scheduledAt, now))
    return { error: { code: "MEETING_NOT_AVAILABLE" as const, message: "この参加 URL は面談予定の前後1時間のみ有効です" } };
  const name = displayName.trim().slice(0, 30) || "ゲスト";
  const token = signMeetingJwt(cfg, { room: iv.meetingRoomId, displayName: name, moderator: false }, now);
  await audit({ tenantCompanyId: iv.entry.demandCompanyId, action: "MeetingJoined", targetType: "Interview", targetId: iv.id, metadata: { participant: "guest" } });
  return { ok: true, domain: cfg.domain, room: iv.meetingRoomId, token };
}

// ゲスト URL の有効性（参加ページの表示用。表示名入力前）
export async function peekGuestMeeting(guestToken: string, now = new Date()) {
  const iv = await prisma.interview.findFirst({ where: { guestTokenHash: hashGuestToken(guestToken), meetingProvider: "JITSI" } });
  if (!iv || iv.status !== "SCHEDULED") return null;
  const w = guestWindow(iv.scheduledAt);
  return { scheduledAt: iv.scheduledAt, validFrom: w.from, validTo: w.to, open: isWithinGuestWindow(iv.scheduledAt, now), available: meetingAvailable() };
}

// 面談のキャンセル・日時変更に連動した無効化（entries 側から呼ぶ）
export async function invalidateMeetingForInterview(interviewId: string) {
  await prisma.interview.updateMany({ where: { id: interviewId, meetingProvider: "JITSI" }, data: { meetingProvider: "NONE", meetingRoomId: null, guestTokenHash: null, guestExpiresAt: null } });
}
