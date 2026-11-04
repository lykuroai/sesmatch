// 利用プランと相手企業名の明示（PRO版仕様書 §4.1, §5, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
// - PRO 版（お試し含む）は他社の公開案件・公開人材・商談に掲載企業名を明示する（片方向）
// - 基本版は取引先登録済みの企業のみ。PRO 企業自身の名前は相手の基本版企業には見えない
// - 期限切れの PRO/TRIAL は FREE として扱う
// - 人材本人の氏名・実額単価（Level 2）はプランにかかわらず双方承認後のみ
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { visibleCompanyNames } from "@/server/services/partners";
import { createProject, publishProject, listProjects, getProject } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer, listEngineers, getEngineer } from "@/server/services/engineers";
import { createEntry, getEntry } from "@/server/services/entries";
import { getOwnPlan, updateCompanyPlanByOperations } from "@/server/services/companies";
import { resolveApiToken, issueApiToken } from "@/server/auth/api-token";
import { futureDate, iso, makeCompany, setPlan, truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

async function publishFixtures(owner: Awaited<ReturnType<typeof makeCompany>>) {
  const projectResult = await createProject(owner, {
    name: "PRO テスト案件",
    anonymousSummary: "大手金融機関向けの開発案件",
    startDate: iso(futureDate(30)),
    contractType: "準委任",
    rateMaxYen: 800_000,
    requiredSkills: [{ name: "Java" }],
  });
  if ("error" in projectResult) throw new Error(String(projectResult.error));
  await publishProject(owner, projectResult.project.id);
  const engineer = await createEngineer(owner, {
    name: "明示 太郎",
    ageBand: 30,
    affiliationType: "EMPLOYEE",
    desiredRateYen: 700_000,
    availableFrom: iso(futureDate(10)),
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
  });
  await addConsent(owner, engineer.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
  await publishEngineer(owner, engineer.id);
  return { projectId: projectResult.project.id, engineerId: engineer.id };
}

describe("相手企業名の明示（§4.1）", () => {
  it("PRO 版は取引先登録がなくても他社の公開案件・人材に掲載企業名を表示する。基本版には出ない", async () => {
    const free = await makeCompany("基本版株式会社");
    const pro = await setPlan(await makeCompany("PRO株式会社"), "PRO");
    const lister = await makeCompany("掲載株式会社");
    const { projectId, engineerId } = await publishFixtures(lister);

    // PRO: 全他社の名前が引ける
    const proMap = await visibleCompanyNames(pro);
    expect(proMap.get(lister.companyId)).toBe("掲載株式会社");
    expect(proMap.get(free.companyId)).toBe("基本版株式会社");
    expect(proMap.has(pro.companyId)).toBe(false); // 自社は含めない

    const proProjects = await listProjects(pro, "public");
    expect(proProjects.items[0].partnerCompanyName).toBe("掲載株式会社");
    const proEngineers = await listEngineers(pro, "public");
    expect(proEngineers.items[0].partnerCompanyName).toBe("掲載株式会社");
    expect((await getProject(pro, projectId))?.partnerCompanyName).toBe("掲載株式会社");
    const proEngineer = await getEngineer(pro, engineerId);
    expect(proEngineer?.partnerCompanyName).toBe("掲載株式会社");
    // Level 2（氏名・実額）はプランにかかわらず開示しない
    expect(proEngineer).not.toHaveProperty("name", "明示 太郎");
    expect(JSON.stringify(proEngineer)).not.toContain("明示 太郎");
    expect(JSON.stringify(proEngineer)).not.toContain("700000");

    // FREE（取引先未登録）: 匿名のまま
    const freeMap = await visibleCompanyNames(free);
    expect(freeMap.size).toBe(0);
    const freeProjects = await listProjects(free, "public");
    expect(freeProjects.items[0].partnerCompanyName).toBeUndefined();
    expect((await getEngineer(free, engineerId))?.partnerCompanyName).toBeUndefined();
  });

  it("PRO 企業自身の名前は相手の基本版企業には見えない（片方向）", async () => {
    const free = await makeCompany("基本版株式会社");
    const pro = await setPlan(await makeCompany("PRO株式会社"), "PRO");
    await publishFixtures(pro);

    const projects = await listProjects(free, "public");
    expect(projects.items).toHaveLength(1);
    expect(projects.items[0].partnerCompanyName).toBeUndefined();
    expect(JSON.stringify(projects.items[0])).not.toContain("PRO株式会社");
  });

  it("期限切れの PRO は基本版として扱われ、お試し（TRIAL）は PRO と同じに扱われる", async () => {
    const lister = await makeCompany("掲載株式会社");
    await publishFixtures(lister);
    const expired = await setPlan(await makeCompany("期限切れ株式会社"), "PRO", new Date(Date.now() - 1000));
    expect(expired.plan).toBe("FREE");
    expect((await listProjects(expired, "public")).items[0].partnerCompanyName).toBeUndefined();

    const trial = await setPlan(await makeCompany("お試し株式会社"), "TRIAL", futureDate(30));
    expect(trial.plan).toBe("TRIAL");
    expect((await listProjects(trial, "public")).items[0].partnerCompanyName).toBe("掲載株式会社");
  });

  it("商談: PRO 側は承認前でも相手の掲載企業名を見られるが、基本版側は双方承認まで非開示", async () => {
    const demand = await setPlan(await makeCompany("需要PRO株式会社"), "PRO");
    const supply = await makeCompany("供給基本版株式会社");
    const { projectId } = await publishFixtures(demand);
    const { engineerId } = await publishFixtures(supply);
    const created = await createEntry(supply, { type: "PROPOSAL", projectId, engineerId });
    if (created.error) throw new Error(created.error.code);
    const entryId = created.entry!.id;

    const demandView = await getEntry(demand, entryId);
    expect(demandView?.counterpartCompanyName).toBe("供給基本版株式会社");
    expect(demandView?.disclosure).toBeNull(); // Level 2 は未開示のまま
    const supplyView = await getEntry(supply, entryId);
    expect(supplyView?.counterpartCompanyName).toBeNull();
    expect(JSON.stringify(supplyView)).not.toContain("需要PRO株式会社");
  });
});

describe("プラン管理（§2, §9）", () => {
  it("運営がプランを変更でき、認証コンテキストの実効プランに反映される。TRIAL は期限未指定なら30日", async () => {
    const owner = await makeCompany("変更株式会社");
    const before = await getOwnPlan(owner);
    expect(before.plan).toBe("FREE");
    expect(before.effectivePlan).toBe("FREE");

    const trial = await updateCompanyPlanByOperations(owner.companyId, { plan: "TRIAL" });
    if ("error" in trial) throw new Error(String(trial.error));
    const days = (trial.planExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);

    const pro = await updateCompanyPlanByOperations(owner.companyId, {
      plan: "PRO",
      planExpiresAt: null,
      planSeats: 8,
      planBillingCycle: "YEARLY",
    });
    if ("error" in pro) throw new Error(String(pro.error));
    expect(pro.planExpiresAt).toBeNull();
    const after = await getOwnPlan(owner);
    expect(after.effectivePlan).toBe("PRO");
    expect(after.planSeats).toBe(8);
    expect(after.planBillingCycle).toBe("YEARLY");

    // 認証コンテキスト（API トークン経由）にも実効プランが載る
    const issued = await issueApiToken({ ...owner, plan: "PRO" }, { name: "t", scope: "ingest", expiresInDays: null });
    if ("error" in issued) throw new Error("発行に失敗");
    expect((await resolveApiToken(issued.token))?.auth.plan).toBe("PRO");

    // 日付指定の期限はその日の終わり（JST）まで有効
    const dated = await updateCompanyPlanByOperations(owner.companyId, { plan: "PRO", planExpiresAt: "2030-01-31" });
    if ("error" in dated) throw new Error(String(dated.error));
    expect(dated.planExpiresAt!.toISOString()).toBe("2030-01-31T14:59:59.000Z");

    // FREE へ戻すと期限・開始日は消える。監査に記録される
    const back = await updateCompanyPlanByOperations(owner.companyId, { plan: "FREE" });
    if ("error" in back) throw new Error(String(back.error));
    expect(back.planExpiresAt).toBeNull();
    expect(back.planStartedAt).toBeNull();
    const audits = await prisma.auditEvent.findMany({ where: { action: "company.plan.update" } });
    expect(audits.length).toBe(4);
    expect(JSON.stringify(audits)).not.toContain("@test.example"); // 個人情報を含めない
  });

  it("席数が不正・企業が存在しない場合はエラー", async () => {
    const owner = await makeCompany("検証株式会社");
    const bad = await updateCompanyPlanByOperations(owner.companyId, { plan: "PRO", planSeats: 0 });
    expect("error" in bad && bad.error?.code).toBe("VALIDATION_ERROR");
    const missing = await updateCompanyPlanByOperations("nope", { plan: "PRO" });
    expect("error" in missing && missing.error?.code).toBe("NOT_FOUND");
  });
});
