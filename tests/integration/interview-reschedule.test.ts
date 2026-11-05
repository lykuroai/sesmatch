// 面談の変更（日時・方法・メモ。2026-11-06）の統合テスト。専用DB sesmatch_test に対して実行する
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll, futureDate, iso } from "./helpers";
import { createProject, publishProject } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { approveEntry, createEntry, rescheduleInterview, scheduleInterview } from "@/server/services/entries";
import { createMeeting, joinMeeting, joinMeetingAsGuest, peekGuestMeeting } from "@/server/services/meetings";

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

describe("面談の変更", () => {
  it("日時・方法・メモを変更できる。Web 会議の日時変更は会議室と本人用 URL を維持して有効時間を移し、Web 会議以外への変更で無効化する", async () => {
    const demand = await setPlan(await makeCompany("需要PRO株式会社"), "PRO");
    const supply = await makeCompany("供給基本版株式会社");
    const entryId = await mutualEntry(demand, supply);
    const at1 = new Date(Date.now() + 30 * 60 * 1000);
    const iv = await scheduleInterview(supply, entryId, { scheduledAt: at1.toISOString(), method: "オンライン", note: "初回" });
    if ("error" in iv && iv.error) throw new Error(iv.error.code);
    const interviewId = iv.interview!.id;

    // 相手側（需要側）も変更できる。メモの変更
    const r1 = await rescheduleInterview(demand, interviewId, { note: "場所は後日連絡" });
    if ("error" in r1) throw new Error(String(r1.error));
    expect(r1.interview.note).toBe("場所は後日連絡");
    expect(r1.interview.method).toBe("オンライン");

    // Web 会議を作成してから日時を変更 → 会議室・本人用 URL は維持、有効時間は新しい日時の前後1時間
    const created = await createMeeting(demand, interviewId);
    if ("error" in created) throw new Error(String(created.error));
    const guestToken = created.guestUrl.split("/m/")[1];
    const at2 = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5時間後
    const r2 = await rescheduleInterview(supply, interviewId, { scheduledAt: at2.toISOString() });
    if ("error" in r2) throw new Error(String(r2.error));
    expect(r2.interview.meetingProvider).toBe("JITSI");
    expect(r2.interview.meetingRoomId).toBe(created.roomId);
    expect(r2.interview.guestExpiresAt?.getTime()).toBe(at2.getTime() + 60 * 60 * 1000);
    expect((await peekGuestMeeting(guestToken))?.open).toBe(false); // 今は有効時間外
    const inWindow = await joinMeetingAsGuest(guestToken, "T.K", new Date(at2.getTime() - 10 * 60 * 1000));
    expect("error" in inWindow).toBe(false);
    const j = await joinMeeting(demand, interviewId);
    expect("error" in j).toBe(false);

    // 方法を対面に変更 → 会議室・本人用 URL を無効化
    const r3 = await rescheduleInterview(demand, interviewId, { method: "対面" });
    if ("error" in r3) throw new Error(String(r3.error));
    expect(r3.interview.meetingProvider).toBe("NONE");
    expect(r3.interview.meetingRoomId).toBeNull();
    const after = await joinMeeting(demand, interviewId);
    expect("error" in after && after.error?.code).toBe("MEETING_NOT_AVAILABLE");
    expect("error" in (await joinMeetingAsGuest(guestToken, "x", new Date(at2.getTime())))).toBe(true);

    // 第三者は 404、不正な日時は VALIDATION_ERROR
    const third = await makeCompany("第三者株式会社");
    expect("error" in (await rescheduleInterview(third, interviewId, { note: "x" })) && (await rescheduleInterview(third, interviewId, { note: "x" })).error?.code).toBe("NOT_FOUND");
    const bad = await rescheduleInterview(demand, interviewId, { scheduledAt: "not-a-date" });
    expect("error" in bad && bad.error?.code).toBe("VALIDATION_ERROR");

    // 終了・キャンセルした面談は変更不可
    await prisma.interview.update({ where: { id: interviewId }, data: { status: "DONE" } });
    const done = await rescheduleInterview(demand, interviewId, { note: "x" });
    expect("error" in done && done.error?.code).toBe("VERSION_CONFLICT");

    // 監査ログ（氏名を含めない）
    const audits = await prisma.auditEvent.findMany({ where: { action: "InterviewRescheduled" } });
    expect(audits.length).toBe(3);
    expect(JSON.stringify(audits)).not.toContain("本人 太郎");
  });
});
