// Web 会議（PRO版仕様書 §4.8, §13）の統合テスト。専用DB sesmatch_test に対して実行する。Jitsi 基盤は環境変数で模す
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll, futureDate, iso } from "./helpers";
import { createProject, publishProject } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { approveEntry, createEntry, scheduleInterview } from "@/server/services/entries";
import { createMeeting, joinMeeting, joinMeetingAsGuest, peekGuestMeeting, revokeMeeting } from "@/server/services/meetings";
import { verifyMeetingJwt } from "@/server/meeting/jitsi";

vi.mock("@/server/mail", () => ({ appBaseUrl: () => "http://test.local", sendMail: async () => {} }));
process.env.JITSI_DOMAIN = "meet.example.test";
process.env.JITSI_APP_ID = "sesmatch";
process.env.JITSI_APP_SECRET = "test-secret";

beforeEach(async () => {
  await truncateAll();
});

async function mutualEntry(demand: Awaited<ReturnType<typeof makeCompany>>, supply: Awaited<ReturnType<typeof makeCompany>>) {
  const r = await createProject(demand, { name: "案件", anonymousSummary: "x", startDate: iso(futureDate(30)), contractType: "準委任", rateMaxYen: 800_000, requiredSkills: [{ name: "Java" }] });
  if ("error" in r) throw new Error("project");
  await publishProject(demand, r.project.id);
  const e = await createEngineer(supply, { name: "本人 太郎", ageBand: 30, affiliationType: "EMPLOYEE", desiredRateYen: 700_000, skills: [{ category: "LANGUAGE", name: "Java", months: 36 }] });
  await addConsent(supply, e.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
  await publishEngineer(supply, e.id);
  const entry = await createEntry(demand, { type: "SCOUT", projectId: r.project.id, engineerId: e.id });
  if (entry.error) throw new Error(entry.error.code);
  const ok = await approveEntry(supply, entry.entry!.id);
  if (ok.error) throw new Error(ok.error.code);
  return entry.entry!.id;
}

describe("Web 会議", () => {
  it("作成は PRO 側のみ。両社が参加でき、本人はゲスト URL で面談前後1時間だけ参加できる。無効化で入れなくなる", async () => {
    const demand = await setPlan(await makeCompany("需要PRO株式会社"), "PRO");
    const supply = await makeCompany("供給基本版株式会社");
    const entryId = await mutualEntry(demand, supply);
    const scheduledAt = new Date(Date.now() + 30 * 60 * 1000); // 30分後
    const iv = await scheduleInterview(supply, entryId, { scheduledAt: scheduledAt.toISOString(), method: "オンライン" });
    if ("error" in iv && iv.error) throw new Error(iv.error.code);
    const interviewId = iv.interview!.id;

    // FREE 側は作成不可
    const denied = await createMeeting(supply, interviewId);
    expect("error" in denied && denied.error?.code).toBe("PLAN_REQUIRED");
    // PRO 側が作成 → 会議室名はランダム、ゲスト URL が返る（DB には hash のみ）
    const created = await createMeeting(demand, interviewId);
    if ("error" in created) throw new Error(String(created.error));
    expect(created.roomId).toMatch(/^ses-[0-9a-f]{24}$/);
    const guestToken = created.guestUrl.split("/m/")[1];
    const row = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
    expect(row.guestTokenHash).not.toBe(guestToken);
    expect(row.method).toBe("Web会議（組込み）");

    // 両社の担当者が参加できる（相手が FREE でも可）。JWT は会議室名と表示名のみ
    for (const auth of [demand, supply]) {
      const j = await joinMeeting(auth, interviewId);
      if ("error" in j) throw new Error(String(j.error));
      const v = verifyMeetingJwt({ appId: "sesmatch", appSecret: "test-secret" }, j.token);
      expect(v?.room).toBe(created.roomId);
      expect(j.token).not.toContain("@");
    }
    // 第三者は 404
    const third = await makeCompany("第三者株式会社");
    expect("error" in (await joinMeeting(third, interviewId)) && (await joinMeeting(third, interviewId)).error?.code).toBe("NOT_FOUND");

    // ゲスト: 有効時間内は参加可、時間外は不可
    expect((await peekGuestMeeting(guestToken))?.open).toBe(true);
    const g = await joinMeetingAsGuest(guestToken, "T.K");
    if ("error" in g) throw new Error(String(g.error));
    expect(verifyMeetingJwt({ appId: "sesmatch", appSecret: "test-secret" }, g.token)).toEqual({ room: created.roomId, name: "T.K" });
    const late = await joinMeetingAsGuest(guestToken, "T.K", new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000));
    expect("error" in late && late.error?.code).toBe("MEETING_NOT_AVAILABLE");
    expect("error" in (await joinMeetingAsGuest("wrong", "x"))).toBe(true);

    // 再発行で旧 URL は無効
    const reissued = await createMeeting(demand, interviewId);
    if ("error" in reissued) throw new Error("reissue");
    expect(reissued.roomId).toBe(created.roomId); // 会議室は維持
    expect("error" in (await joinMeetingAsGuest(guestToken, "x"))).toBe(true);

    // 無効化後は参加不可
    await revokeMeeting(demand, interviewId);
    const after = await joinMeeting(demand, interviewId);
    expect("error" in after && after.error?.code).toBe("MEETING_NOT_AVAILABLE");

    // 監査ログに氏名・会話内容を含めない
    const audits = await prisma.auditEvent.findMany({ where: { action: { in: ["MeetingCreated", "MeetingJoined", "MeetingRevoked"] } } });
    expect(audits.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(audits)).not.toContain("本人 太郎");
    expect(JSON.stringify(audits)).not.toContain("T.K");
  });

  it("基盤未設定（環境変数なし）では作成・参加できない", async () => {
    const saved = process.env.JITSI_DOMAIN;
    delete process.env.JITSI_DOMAIN;
    try {
      const demand = await setPlan(await makeCompany("需要PRO株式会社"), "PRO");
      const supply = await makeCompany("供給株式会社");
      const entryId = await mutualEntry(demand, supply);
      const iv = await scheduleInterview(demand, entryId, { scheduledAt: new Date().toISOString(), method: "オンライン" });
      const r = await createMeeting(demand, iv.interview!.id);
      expect("error" in r && r.error?.code).toBe("MEETING_NOT_AVAILABLE");
    } finally {
      process.env.JITSI_DOMAIN = saved;
    }
  });
});
