// 一斉スカウト（PRO版仕様書 §4.6, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
// - 基本版は 403 PLAN_REQUIRED
// - 重複応募ブロックに従いスキップし二重申込みにならない。21名以上・1日上限超過・連絡先入りの本文は拒否
// - 既読は相手が商談詳細を開いたときだけ付き、自分のメッセージには付かない
// - AI 下書きの入力に Level 2 情報（氏名・実額）を渡さない
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll, futureDate, iso } from "./helpers";
import { createProject, publishProject } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { createEntry, getEntry, markMessagesRead } from "@/server/services/entries";
import { createBulkScout, draftScoutMessage, getScoutBatch, listScoutBatches } from "@/server/services/scouts";
import { llmGateway } from "@/server/pipeline/llm";

// モック LLM（定型文の下書き）を強制する
delete process.env.LLM_BASE_URL;
delete process.env.ANTHROPIC_API_KEY;

vi.mock("@/server/mail", () => ({ appBaseUrl: () => "http://test.local", sendMail: async () => {} }));

beforeEach(async () => {
  await truncateAll();
});

async function ownProject(owner: Awaited<ReturnType<typeof makeCompany>>) {
  const r = await createProject(owner, {
    name: "スカウト案件",
    anonymousSummary: "金融系の開発案件",
    startDate: iso(futureDate(30)),
    contractType: "準委任",
    rateMaxYen: 800_000,
    locationCity: "東京都港区",
    requiredSkills: [{ name: "Java" }],
  });
  if ("error" in r) throw new Error(String(r.error));
  await publishProject(owner, r.project.id);
  return r.project;
}

async function engineersOf(owner: Awaited<ReturnType<typeof makeCompany>>, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const e = await createEngineer(owner, {
      name: `秘密 ${i}号`,
      ageBand: 30,
      affiliationType: "EMPLOYEE",
      desiredRateYen: 650_000,
      skills: [{ category: "LANGUAGE", name: "Java", months: 36 }],
    });
    await addConsent(owner, e.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
    await publishEngineer(owner, e.id);
    ids.push(e.id);
  }
  return ids;
}

describe("一斉スカウト", () => {
  it("基本版は PLAN_REQUIRED", async () => {
    const free = await makeCompany("スカウト基本版株式会社");
    const r = await createBulkScout(free, { projectId: "x", engineerIds: ["y"], body: "こんにちは" });
    expect("error" in r && r.error.code).toBe("PLAN_REQUIRED");
  });

  it("選択した人材に商談と本文メッセージを作成し、既存の商談はスキップする。上限・連絡先も検査する", async () => {
    const pro = await setPlan(await makeCompany("スカウトPRO株式会社"), "PRO");
    const supply = await makeCompany("供給株式会社");
    const project = await ownProject(pro);
    const ids = await engineersOf(supply, 3);
    // 1名は既に商談あり
    const existing = await createEntry(pro, { type: "SCOUT", projectId: project.id, engineerId: ids[0] });
    if (existing.error) throw new Error(existing.error.code);

    const contact = await createBulkScout(pro, { projectId: project.id, engineerIds: ids, body: "連絡は 090-1234-5678 まで" });
    expect("error" in contact && contact.error.code).toBe("PII_VALIDATION_FAILED");

    const r = await createBulkScout(pro, { projectId: project.id, engineerIds: ids, body: "「{案件名}」のご紹介です。単価上限 {単価上限}" });
    if ("error" in r) throw new Error(r.error.message);
    expect(r.created).toHaveLength(2);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].engineerId).toBe(ids[0]);
    expect(await prisma.entry.count({ where: { projectId: project.id } })).toBe(3); // 二重申込みなし
    const batch = await getScoutBatch(pro, r.batchId);
    expect(batch?.stats).toMatchObject({ sent: 2, approved: 0, declined: 0, pending: 2 });
    expect(batch?.entries.every((e) => e.read === false)).toBe(true);
    // 本文はテンプレート展開済みで最初のメッセージになる
    const entry = await getEntry(pro, r.created[0].entryId);
    expect(entry?.messages[0].body).toBe("「スカウト案件」のご紹介です。単価上限 80万円");
    expect(entry?.messages[0].own).toBe(true);
    expect((await listScoutBatches(pro))[0].id).toBe(r.batchId);

    // 21名は拒否
    const many = await createBulkScout(pro, { projectId: project.id, engineerIds: Array.from({ length: 21 }, (_, i) => `e${i}`), body: "x" });
    expect("error" in many && many.error.code).toBe("VALIDATION_ERROR");
    // 他社の案件は NOT_FOUND
    const other = await createBulkScout(pro, { projectId: "nope", engineerIds: [ids[1]], body: "x" });
    expect("error" in other && other.error.code).toBe("NOT_FOUND");
  });

  it("1日50件の上限を超える送信は SCOUT_DAILY_LIMIT（当日の送信済み件数＋今回の件数で判定）", async () => {
    const pro = await setPlan(await makeCompany("上限PRO株式会社"), "PRO");
    const supply = await makeCompany("供給株式会社");
    const project = await ownProject(pro);
    const dummyProject = await ownProject(pro);
    const ids = await engineersOf(supply, 1);
    // 当日分の送信済み1件を模す
    const batch = await prisma.scoutBatch.create({
      data: { tenantCompanyId: pro.companyId, projectId: dummyProject.id, memberId: pro.memberId, templateBody: "x", requestedCount: 1, createdCount: 1, skippedCount: 0 },
    });
    await prisma.entry.create({
      data: {
        type: "SCOUT", status: "DEMAND_APPROVED", projectId: dummyProject.id, engineerId: ids[0],
        demandCompanyId: pro.companyId, supplyCompanyId: supply.companyId, createdByCompanyId: pro.companyId, createdByMemberId: pro.memberId,
        demandApprovedAt: new Date(), scoutBatchId: batch.id,
      },
    });
    const twenty = Array.from({ length: 20 }, (_, i) => `e${i}`);
    const ok = await createBulkScout(pro, { projectId: project.id, engineerIds: twenty, body: "x" }); // 1 + 20 ≦ 50
    expect("error" in ok).toBe(false);
    // 送信済み 1 件に対し、残り枠は 49。20件×3回目で超過させる代わりに、上限値を直接超える要求を模す
    const createdNow = await prisma.entry.count({ where: { createdByCompanyId: pro.companyId, scoutBatchId: { not: null } } });
    expect(createdNow).toBe(1); // 存在しない人材はスキップされ、作成は増えない
    // 50件相当の当日送信済みを作ってから要求すると拒否される
    const more = await engineersOf(supply, 2);
    for (let i = 0; i < 49; i++) {
      const p = await ownProject(pro);
      await prisma.entry.create({
        data: {
          type: "SCOUT", status: "DEMAND_APPROVED", projectId: p.id, engineerId: more[0],
          demandCompanyId: pro.companyId, supplyCompanyId: supply.companyId, createdByCompanyId: pro.companyId, createdByMemberId: pro.memberId,
          demandApprovedAt: new Date(), scoutBatchId: batch.id,
        },
      });
    }
    const limited = await createBulkScout(pro, { projectId: project.id, engineerIds: [more[1]], body: "x" });
    expect("error" in limited && limited.error.code).toBe("SCOUT_DAILY_LIMIT");
  });

  it("既読は相手が開いたときに付き、送信側が開いても付かない。AI 下書きの入力に氏名・実額を渡さない", async () => {
    const pro = await setPlan(await makeCompany("既読PRO株式会社"), "PRO");
    const supply = await makeCompany("供給株式会社");
    const project = await ownProject(pro);
    const ids = await engineersOf(supply, 1);
    const r = await createBulkScout(pro, { projectId: project.id, engineerIds: ids, body: "ご紹介です" });
    if ("error" in r) throw new Error(r.error.message);
    const entryId = r.created[0].entryId;
    expect(await markMessagesRead(pro, entryId)).toBe(0); // 自分のメッセージは既読対象外
    expect((await getEntry(pro, entryId))?.messages[0].readAt).toBeNull();
    expect(await markMessagesRead(supply, entryId)).toBe(1);
    expect((await getEntry(pro, entryId))?.messages[0].readAt).not.toBeNull();
    expect((await getScoutBatch(pro, r.batchId))?.entries[0].read).toBe(true);

    const spy = vi.spyOn(llmGateway, "draftScoutMessage");
    const draft = await draftScoutMessage(pro, { projectId: project.id, engineerIds: ids });
    const draftBody = (draft as { body?: string }).body;
    expect(draftBody && draftBody.length).toBeGreaterThan(0);
    const input = JSON.stringify(spy.mock.calls[0][0]);
    expect(input).not.toContain("秘密");
    expect(input).not.toContain("650000");
    expect(input).not.toContain("供給株式会社");
    expect(input).toContain("60〜70万円"); // Level 1 の単価帯のみ
    spy.mockRestore();
  });
});
