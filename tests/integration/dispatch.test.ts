// 労働者派遣（基本契約第4条）の自動チェックの統合テスト:
// 案件登録の必須項目、一社下不可・直接雇用のみの強制、提案時・契約時の派遣事業許可検査
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { createProject, publishProject, type ProjectInput } from "@/server/services/projects";
import { approveEntry, createEntry } from "@/server/services/entries";
import { createContract } from "@/server/services/contracts";
import { futureDate, iso, makeCompany, truncateAll } from "./helpers";
import type { AuthContext } from "@/server/auth/session";

beforeEach(async () => {
  await truncateAll();
});

const dispatchProjectInput = (over: Partial<ProjectInput> = {}): ProjectInput => ({
  name: "派遣案件",
  anonymousSummary: "大手金融機関向けの開発案件",
  startDate: iso(futureDate(30)),
  contractType: "労働者派遣",
  rateMaxYen: 800_000,
  dispatchConflictDate: iso(futureDate(365)),
  dispatchDemandManager: "開発部長",
  dispatchProhibitedConfirmed: true,
  requiredSkills: [{ name: "Java" }],
  ...over,
});

async function makeEngineer(
  auth: AuthContext,
  affiliationType: "EMPLOYEE" | "SUBTIER1" | "FREELANCER" = "EMPLOYEE"
) {
  const e = await createEngineer(auth, {
    name: "テスト 太郎",
    ageBand: 30,
    affiliationType,
    desiredRateYen: 700_000,
    availableFrom: iso(futureDate(10)),
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
  });
  await addConsent(auth, e.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
  const r = await publishEngineer(auth, e.id);
  if ("error" in r) throw new Error(`publish failed: ${r.error}`);
  return e;
}

// 供給側企業に労働者派遣事業の許可情報を登録する
async function setDispatchLicense(
  companyId: string,
  over: { expiryDays?: number; managerName?: string | null } = {}
) {
  await prisma.company.update({
    where: { id: companyId },
    data: {
      dispatchLicenseNumber: "派13-123456",
      dispatchLicenseExpiry: futureDate(over.expiryDays ?? 365),
      dispatchManagerName: over.managerName === undefined ? "管理部長" : over.managerName,
    },
  });
}

async function makeDispatchProject(auth: AuthContext, over: Partial<ProjectInput> = {}) {
  const result = await createProject(auth, dispatchProjectInput(over));
  if ("error" in result) throw new Error(result.error);
  await publishProject(auth, result.project.id);
  return result.project;
}

describe("労働者派遣案件の登録（基本契約第4条）", () => {
  it("抵触日・派遣先責任者・派遣禁止業務の確認がないと登録できない", async () => {
    const demand = await makeCompany("需要側企業");
    for (const over of [
      { dispatchConflictDate: undefined },
      { dispatchDemandManager: undefined },
      { dispatchProhibitedConfirmed: false },
    ] satisfies Partial<ProjectInput>[]) {
      const result = await createProject(demand, dispatchProjectInput(over));
      expect(result).toHaveProperty("error");
    }
  });

  it("一社下不可・自社社員（直接雇用）のみ受入が自動適用される", async () => {
    const demand = await makeCompany("需要側企業");
    const result = await createProject(
      demand,
      dispatchProjectInput({
        allowSubtier: true,
        acceptedTypes: ["EMPLOYEE", "AFFILIATED", "SUBTIER1"],
      })
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.project.allowSubtier).toBe(false);
    expect(result.project.acceptedTypes).toEqual(["EMPLOYEE"]);
  });

  it("準委任では派遣項目なしで登録でき、派遣項目は保存されない", async () => {
    const demand = await makeCompany("需要側企業");
    const result = await createProject(
      demand,
      dispatchProjectInput({
        contractType: "準委任",
        dispatchConflictDate: iso(futureDate(365)),
        dispatchDemandManager: "誤入力",
      })
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.project.dispatchConflictDate).toBeNull();
    expect(result.project.dispatchDemandManager).toBeNull();
  });
});

describe("労働者派遣案件への提案（派遣事業許可の自動チェック）", () => {
  it("供給側企業に派遣事業許可が未登録だと提案できない", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const project = await makeDispatchProject(demand);
    const engineer = await makeEngineer(supply);
    const result = await createEntry(supply, {
      type: "PROPOSAL",
      projectId: project.id,
      engineerId: engineer.id,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: { message?: string } }).error.message).toContain("許可番号");
  });

  it("許可の有効期限が切れていると提案できない", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    await setDispatchLicense(supply.companyId, { expiryDays: -1 });
    const project = await makeDispatchProject(demand);
    const engineer = await makeEngineer(supply);
    const result = await createEntry(supply, {
      type: "PROPOSAL",
      projectId: project.id,
      engineerId: engineer.id,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: { message?: string } }).error.message).toContain("期限");
  });

  it("派遣元責任者が未登録だと提案できない", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    await setDispatchLicense(supply.companyId, { managerName: null });
    const project = await makeDispatchProject(demand);
    const engineer = await makeEngineer(supply);
    const result = await createEntry(supply, {
      type: "PROPOSAL",
      projectId: project.id,
      engineerId: engineer.id,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: { message?: string } }).error.message).toContain("派遣元責任者");
  });

  it("一社下・個人事業主の人材は提案できない（直接雇用のみ）", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    await setDispatchLicense(supply.companyId);
    const project = await makeDispatchProject(demand);
    for (const type of ["SUBTIER1", "FREELANCER"] as const) {
      const engineer = await makeEngineer(supply, type);
      const result = await createEntry(supply, {
        type: "PROPOSAL",
        projectId: project.id,
        engineerId: engineer.id,
      });
      expect(result).toHaveProperty("error");
    }
  });

  it("有効な許可＋自社社員（直接雇用）なら提案できる", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    await setDispatchLicense(supply.companyId);
    const project = await makeDispatchProject(demand);
    const engineer = await makeEngineer(supply);
    const result = await createEntry(supply, {
      type: "PROPOSAL",
      projectId: project.id,
      engineerId: engineer.id,
    });
    expect(result).not.toHaveProperty("error");
  });
});

describe("労働者派遣契約の作成（契約時の再チェック）", () => {
  it("提案後に許可情報が失われた場合、労働者派遣契約は作成できない", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    await setDispatchLicense(supply.companyId);
    const project = await makeDispatchProject(demand);
    const engineer = await makeEngineer(supply);
    const created = await createEntry(supply, {
      type: "PROPOSAL",
      projectId: project.id,
      engineerId: engineer.id,
    });
    if (!("entry" in created) || !created.entry) throw new Error("entry creation failed");
    await approveEntry(demand, created.entry.id);

    // 許可情報を削除（期限切れ等の状況変化を模擬）
    await prisma.company.update({
      where: { id: supply.companyId },
      data: { dispatchLicenseNumber: null, dispatchLicenseExpiry: null },
    });

    const checklist = {
      instructionManager: "派遣先責任者を通じて指示",
      attendanceManager: "供給側企業",
      assignmentDecider: "供給側企業",
      acceptanceMethod: "月次作業報告書の確認",
      resubcontractApproval: "再委託なし",
    };
    const result = await createContract(demand, {
      entryId: created.entry.id,
      contractType: "労働者派遣",
      monthlyRateYen: 700_000,
      startDate: iso(futureDate(30)),
      commandChecklist: checklist,
    });
    expect(result).toHaveProperty("error");

    // 許可を再登録すれば作成できる
    await setDispatchLicense(supply.companyId);
    const retry = await createContract(demand, {
      entryId: created.entry.id,
      contractType: "労働者派遣",
      monthlyRateYen: 700_000,
      startDate: iso(futureDate(30)),
      commandChecklist: checklist,
    });
    expect(retry).not.toHaveProperty("error");
  });
});
