// 「Web 会議」画面の面談一覧（2026-11-05）の統合テスト。専用DB sesmatch_test に対して実行する
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCompany, setPlan, truncateAll, futureDate, iso } from "./helpers";
import { createProject, publishProject } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { approveEntry, createEntry, scheduleInterview } from "@/server/services/entries";
import { createMeeting, listCompanyInterviews } from "@/server/services/meetings";

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

describe("Web 会議画面の面談一覧", () => {
  it("両社に自社の面談だけが見え、今後／最近に分かれ、会議室の有無が分かる。第三者には見えない", async () => {
    const demand = await setPlan(await makeCompany("需要PRO株式会社"), "PRO");
    const supply = await makeCompany("供給基本版株式会社");
    const entryId = await mutualEntry(demand, supply);
    const now = new Date();
    const soon = await scheduleInterview(demand, entryId, { scheduledAt: new Date(now.getTime() + 2 * 3600_000).toISOString(), method: "オンライン" });
    const past = await scheduleInterview(demand, entryId, { scheduledAt: new Date(now.getTime() - 2 * 24 * 3600_000).toISOString(), method: "対面", note: "本社" });
    const old = await scheduleInterview(demand, entryId, { scheduledAt: new Date(now.getTime() - 30 * 24 * 3600_000).toISOString(), method: "対面" });
    if ("error" in soon || "error" in past || "error" in old) throw new Error("schedule");
    const created = await createMeeting(demand, soon.interview!.id);
    if ("error" in created) throw new Error(String(created.error));

    for (const auth of [demand, supply]) {
      const rows = await listCompanyInterviews(auth, now);
      expect(rows.map((r) => r.id).sort()).toEqual([soon.interview!.id, past.interview!.id].sort()); // 30日前は対象外
      const up = rows.find((r) => r.id === soon.interview!.id)!;
      expect(up.upcoming).toBe(true);
      expect(up.hasMeeting).toBe(true);
      expect(up.method).toBe("Web会議（組込み）");
      expect(up.side).toBe(auth === demand ? "DEMAND" : "SUPPLY");
      expect(up.engineerName).toBe("本人 太郎"); // 双方承認後は Level 2 開示済み
      expect(up.counterpartCompanyName).toBe(auth === demand ? "供給基本版株式会社" : "需要PRO株式会社");
      const recent = rows.find((r) => r.id === past.interview!.id)!;
      expect(recent.upcoming).toBe(false);
      expect(recent.hasMeeting).toBe(false);
    }
    const third = await makeCompany("第三者株式会社");
    expect(await listCompanyInterviews(third, now)).toEqual([]);
  });
});
