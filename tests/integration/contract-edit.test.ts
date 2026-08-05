// 署名完了前の契約修正（§22）の統合テスト:
// 修正すると既存署名が取り消され双方の再署名が必要になること、成約（EXECUTED）後は修正できないこと
import { beforeEach, describe, expect, it } from "vitest";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { createProject, publishProject } from "@/server/services/projects";
import { approveEntry, createEntry } from "@/server/services/entries";
import { createContract, signContract, updateContract } from "@/server/services/contracts";
import { futureDate, iso, makeCompany, truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

const CHECKLIST = {
  instructionManager: "供給側PMを通じて指示",
  attendanceManager: "供給側企業",
  assignmentDecider: "供給側企業",
  acceptanceMethod: "月次作業報告書の確認",
  resubcontractApproval: "再委託なし",
};

async function makeDraftContract() {
  const demand = await makeCompany("需要側企業");
  const supply = await makeCompany("供給側企業");
  const projectResult = await createProject(demand, {
    name: "テスト案件",
    anonymousSummary: "大手金融機関向けの開発案件",
    startDate: iso(futureDate(30)),
    contractType: "準委任",
    rateMaxYen: 800_000,
    requiredSkills: [{ name: "Java" }],
  });
  if ("error" in projectResult) throw new Error(projectResult.error);
  await publishProject(demand, projectResult.project.id);
  const engineer = await createEngineer(supply, {
    name: "テスト 太郎",
    ageBand: 30,
    affiliationType: "EMPLOYEE",
    desiredRateYen: 700_000,
    availableFrom: iso(futureDate(10)),
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
  });
  await addConsent(supply, engineer.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
  const pub = await publishEngineer(supply, engineer.id);
  if ("error" in pub) throw new Error(`publish failed: ${pub.error}`);
  const created = await createEntry(supply, {
    type: "PROPOSAL",
    projectId: projectResult.project.id,
    engineerId: engineer.id,
  });
  if (!("entry" in created) || !created.entry) throw new Error("entry creation failed");
  await approveEntry(demand, created.entry.id);
  const contractResult = await createContract(demand, {
    entryId: created.entry.id,
    contractType: "準委任",
    monthlyRateYen: 700_000,
    startDate: iso(futureDate(30)),
    commandChecklist: CHECKLIST,
  });
  if ("error" in contractResult) throw new Error(contractResult.error.message);
  return { demand, supply, contract: contractResult.contract };
}

describe("署名完了前の契約修正（§22）", () => {
  it("片側署名後に修正すると署名が取り消され、双方の再署名で成約する", async () => {
    const { demand, supply, contract } = await makeDraftContract();
    const signed = await signContract(supply, contract.id, contract.version);
    expect(signed).not.toHaveProperty("error");

    const updated = await updateContract(demand, contract.id, {
      contractType: "準委任",
      monthlyRateYen: 750_000,
      startDate: iso(futureDate(30)),
      commandChecklist: CHECKLIST,
      notes: "単価を修正",
      version: contract.version,
    });
    if ("error" in updated) throw new Error(updated.error.message);
    expect(updated.contract.status).toBe("DRAFT");
    expect(updated.contract.supplySigned).toBe(false);
    expect(updated.contract.demandSigned).toBe(false);
    expect(updated.contract.monthlyRateYen).toBe(750_000);
    expect(updated.contract.version).toBe(contract.version + 1);

    // 再署名で成約できる
    expect(await signContract(supply, contract.id, updated.contract.version)).not.toHaveProperty("error");
    const executed = await signContract(demand, contract.id, updated.contract.version);
    expect(executed).toMatchObject({ ok: true, executed: true });
  });

  it("相手方の修正後は、修正前の版数では署名できない（版数照合）", async () => {
    const { demand, supply, contract } = await makeDraftContract();

    // 供給側が第1版を閲覧している間に、需要側が契約を修正（第2版になる）
    const updated = await updateContract(demand, contract.id, {
      contractType: "準委任",
      monthlyRateYen: 650_000,
      startDate: iso(futureDate(30)),
      commandChecklist: CHECKLIST,
      version: contract.version,
    });
    if ("error" in updated) throw new Error(updated.error.message);

    // 修正前の版数（第1版）での署名は拒否される
    const staleSign = await signContract(supply, contract.id, contract.version);
    expect(staleSign).toHaveProperty("error");
    expect((staleSign as { error: { code: string } }).error.code).toBe("VERSION_CONFLICT");

    // 最新版を確認したうえでの署名は成功する
    const freshSign = await signContract(supply, contract.id, updated.contract.version);
    expect(freshSign).not.toHaveProperty("error");
  });

  it("相手方の修正後は、修正前の版数のままでは修正を保存できない（上書き防止）", async () => {
    const { demand, supply, contract } = await makeDraftContract();

    // 需要側が先に修正（第1版 → 第2版）
    const first = await updateContract(demand, contract.id, {
      contractType: "準委任",
      monthlyRateYen: 680_000,
      startDate: iso(futureDate(30)),
      commandChecklist: CHECKLIST,
      version: contract.version,
    });
    if ("error" in first) throw new Error(first.error.message);

    // 供給側が第1版の内容を見たまま保存しようとすると拒否される
    const stale = await updateContract(supply, contract.id, {
      contractType: "準委任",
      monthlyRateYen: 720_000,
      startDate: iso(futureDate(30)),
      commandChecklist: CHECKLIST,
      version: contract.version,
    });
    expect(stale).toHaveProperty("error");
    expect((stale as { error: { code: string } }).error.code).toBe("VERSION_CONFLICT");

    // 最新版（第2版）を読み込み直してからの修正は成功する（第3版になる）
    const fresh = await updateContract(supply, contract.id, {
      contractType: "準委任",
      monthlyRateYen: 720_000,
      startDate: iso(futureDate(30)),
      commandChecklist: CHECKLIST,
      version: first.contract.version,
    });
    if ("error" in fresh) throw new Error(fresh.error.message);
    expect(fresh.contract.version).toBe(first.contract.version + 1);
  });

  it("成約（EXECUTED）後は修正できない", async () => {
    const { demand, supply, contract } = await makeDraftContract();
    await signContract(supply, contract.id, contract.version);
    await signContract(demand, contract.id, contract.version);

    const result = await updateContract(demand, contract.id, {
      contractType: "準委任",
      monthlyRateYen: 900_000,
      startDate: iso(futureDate(30)),
      commandChecklist: CHECKLIST,
      version: contract.version,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: { code: string } }).error.code).toBe("VERSION_CONFLICT");
  });

  it("確認事項が欠けている修正は拒否される", async () => {
    const { demand, contract } = await makeDraftContract();
    const result = await updateContract(demand, contract.id, {
      contractType: "準委任",
      monthlyRateYen: 700_000,
      startDate: iso(futureDate(30)),
      commandChecklist: { ...CHECKLIST, acceptanceMethod: "" },
      version: contract.version,
    });
    expect(result).toHaveProperty("error");
  });
});
