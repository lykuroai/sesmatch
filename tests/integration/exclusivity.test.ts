// 成約の排他ルールの統合テスト。専用DB sesmatch_test に対して実行する。
// - 1人材は同一期間に1案件のみ成約できる（期間重複する EXECUTED/ACTIVE 契約の排他）
// - 1案件は複数人材と成約できる
// - 終了（クローズ）した案件にはエントリーできない（クローズは手動設定）
import { beforeEach, describe, expect, it } from "vitest";
import {
  addConsent,
  createEngineer,
  publishEngineer,
} from "@/server/services/engineers";
import {
  createProject,
  publishProject,
  setProjectWorkflowStatus,
} from "@/server/services/projects";
import { approveEntry, createEntry, getEntry, getEntrySkillSheetFile } from "@/server/services/entries";
import { prisma } from "@/server/db";
import { createContract, signContract } from "@/server/services/contracts";
import { futureDate, iso, makeCompany, truncateAll } from "./helpers";
import type { AuthContext } from "@/server/auth/session";

beforeEach(async () => {
  await truncateAll();
});

const CHECKLIST = {
  instructionManager: "供給側PM経由",
  attendanceManager: "供給側企業",
  assignmentDecider: "供給側企業",
  acceptanceMethod: "月次報告書",
  resubcontractApproval: "再委託なし",
};

async function makeEngineer(auth: AuthContext, name: string) {
  const e = await createEngineer(auth, {
    name,
    ageBand: 30,
    affiliationType: "EMPLOYEE",
    desiredRateYen: 700_000,
    availableFrom: iso(futureDate(10)),
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
  });
  await addConsent(auth, e.id, {
    method: "メール",
    documentVersion: "v1",
    purposes: ["マッチング"],
  });
  const r = await publishEngineer(auth, e.id);
  if ("error" in r) throw new Error(`publish failed: ${r.error}`);
  return e;
}

async function makeProject(auth: AuthContext, name: string) {
  const result = await createProject(auth, {
    name,
    anonymousSummary: "大手金融機関向けの開発案件",
    startDate: iso(futureDate(30)),
    contractType: "準委任",
    rateMaxYen: 800_000,
    requiredSkills: [{ name: "Java" }],
  });
  if ("error" in result) throw new Error(result.error);
  await publishProject(auth, result.project.id);
  return result.project;
}

// 提案 → 需要側承認まで済ませ、契約可能なエントリーを作る
async function makeApprovedEntry(
  demand: AuthContext,
  supply: AuthContext,
  projectId: string,
  engineerId: string
) {
  const created = await createEntry(supply, { type: "PROPOSAL", projectId, engineerId });
  if (created.error) throw new Error(created.error.code);
  const approved = await approveEntry(demand, created.entry!.id);
  if (approved.error) throw new Error(approved.error.code);
  return created.entry!.id;
}

// 契約作成 → 双方署名で成約（EXECUTED）まで進める
async function executeContract(
  demand: AuthContext,
  supply: AuthContext,
  entryId: string,
  period: { startDate: string; endDate?: string }
) {
  const created = await createContract(demand, {
    entryId,
    contractType: "準委任",
    monthlyRateYen: 700_000,
    startDate: period.startDate,
    endDate: period.endDate,
    commandChecklist: CHECKLIST,
  });
  if ("error" in created) throw new Error(created.error.message ?? created.error.code);
  const contractId = created.contract.id;
  const s1 = await signContract(demand, contractId, 1);
  if ("error" in s1) throw new Error(JSON.stringify(s1.error));
  const s2 = await signContract(supply, contractId, 1);
  if ("error" in s2) throw new Error(JSON.stringify(s2.error));
  return contractId;
}

describe("終了案件へのエントリー禁止", () => {
  it("手動で終了にした案件にはエントリーできない", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const project = await makeProject(demand, "終了予定案件");
    const engineer = await makeEngineer(supply, "テスト 太郎");

    const closed = await setProjectWorkflowStatus(demand, project.id, "ENDED");
    expect("ok" in closed).toBe(true);

    const result = await createEntry(supply, {
      type: "PROPOSAL",
      projectId: project.id,
      engineerId: engineer.id,
    });
    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("終了した案件");
  });

  it("終了から応募中に戻せば再びエントリーできる", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const project = await makeProject(demand, "再開案件");
    const engineer = await makeEngineer(supply, "テスト 太郎");

    await setProjectWorkflowStatus(demand, project.id, "ENDED");
    await setProjectWorkflowStatus(demand, project.id, "RECRUITING");

    const result = await createEntry(supply, {
      type: "PROPOSAL",
      projectId: project.id,
      engineerId: engineer.id,
    });
    expect(result.error).toBeUndefined();
  });
});

describe("1案件は複数人材と成約できる", () => {
  it("1人目の成約後（進行状態=成約）も2人目のエントリー・成約ができる", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const project = await makeProject(demand, "複数名募集案件");
    const e1 = await makeEngineer(supply, "テスト 一郎");
    const e2 = await makeEngineer(supply, "テスト 二郎");

    const entry1 = await makeApprovedEntry(demand, supply, project.id, e1.id);
    await executeContract(demand, supply, entry1, {
      startDate: "2026-09-01",
      endDate: "2027-02-28",
    });

    // 成約後も同一案件へ別人材がエントリーできる
    const entry2 = await makeApprovedEntry(demand, supply, project.id, e2.id);
    const contract2 = await executeContract(demand, supply, entry2, {
      startDate: "2026-09-01",
      endDate: "2027-02-28",
    });
    expect(contract2).toBeTruthy();
  });
});

describe("Level 2 開示後の原文・添付ファイル開示", () => {
  it("双方承認前は原文を開示せず、承認後は匿名化済み原文が相互に見える", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const project = await makeProject(demand, "原文つき案件");
    const engineer = await makeEngineer(supply, "テスト 太郎");
    await prisma.project.update({ where: { id: project.id }, data: { maskedSourceText: "案件の匿名化済み原文" } });
    await prisma.engineer.update({ where: { id: engineer.id }, data: { maskedSourceText: "人材の匿名化済み原文" } });

    const created = await createEntry(supply, { type: "PROPOSAL", projectId: project.id, engineerId: engineer.id });
    if (created.error) throw new Error(created.error.code);
    const entryId = created.entry!.id;

    // 片側承認のみ: 開示なし（原文・添付も取得不可）
    const before = await getEntry(demand, entryId);
    expect(before!.disclosure).toBeNull();
    expect(await getEntrySkillSheetFile(demand, entryId)).toBeNull();

    const approved = await approveEntry(demand, entryId);
    if (approved.error) throw new Error(approved.error.code);

    // 双方承認後: 相手側（需要側）からも人材原文が見える
    const after = await getEntry(demand, entryId);
    expect(after!.disclosure?.projectSourceText).toBe("案件の匿名化済み原文");
    expect(after!.disclosure?.engineerSourceText).toBe("人材の匿名化済み原文");

    // 当事者以外は取得不可（テナント分離）
    const other = await makeCompany("第三者企業");
    expect(await getEntrySkillSheetFile(other, entryId)).toBeNull();
  });
});

describe("条件確認書の作成は案件提供側（需要側）のみ", () => {
  it("供給側企業は条件確認書を作成できない", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const project = await makeProject(demand, "案件");
    const engineer = await makeEngineer(supply, "テスト 太郎");
    const entryId = await makeApprovedEntry(demand, supply, project.id, engineer.id);

    const result = await createContract(supply, {
      entryId,
      contractType: "準委任",
      monthlyRateYen: 700_000,
      startDate: "2026-09-01",
      commandChecklist: CHECKLIST,
    });
    expect("error" in result && result.error.code).toBe("FORBIDDEN");
  });
});

describe("1人材は同一期間に1案件のみ成約できる", () => {
  it("期間が重複する2件目の契約は作成できない", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const p1 = await makeProject(demand, "案件1");
    const p2 = await makeProject(demand, "案件2");
    const engineer = await makeEngineer(supply, "テスト 太郎");

    const entry1 = await makeApprovedEntry(demand, supply, p1.id, engineer.id);
    await executeContract(demand, supply, entry1, {
      startDate: "2026-09-01",
      endDate: "2027-02-28",
    });

    const entry2 = await makeApprovedEntry(demand, supply, p2.id, engineer.id);
    const result = await createContract(demand, {
      entryId: entry2,
      contractType: "準委任",
      monthlyRateYen: 700_000,
      startDate: "2026-12-01", // 案件1の期間内
      commandChecklist: CHECKLIST,
    });
    expect("error" in result && result.error.code).toBe("VALIDATION_ERROR");
  });

  it("先に契約書を作っていても、他方が先に成約したら署名（締結）できない", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const p1 = await makeProject(demand, "案件1");
    const p2 = await makeProject(demand, "案件2");
    const engineer = await makeEngineer(supply, "テスト 太郎");

    const entry1 = await makeApprovedEntry(demand, supply, p1.id, engineer.id);
    const entry2 = await makeApprovedEntry(demand, supply, p2.id, engineer.id);

    // 期間の重複する契約書を両方とも先に作成（この時点ではどちらも成約前なので許容）
    const c1 = await createContract(demand, {
      entryId: entry1,
      contractType: "準委任",
      monthlyRateYen: 700_000,
      startDate: "2026-09-01",
      endDate: "2027-02-28",
      commandChecklist: CHECKLIST,
    });
    const c2 = await createContract(demand, {
      entryId: entry2,
      contractType: "準委任",
      monthlyRateYen: 700_000,
      startDate: "2026-10-01",
      endDate: "2027-03-31",
      commandChecklist: CHECKLIST,
    });
    if ("error" in c1 || "error" in c2) throw new Error("contract creation failed");

    // 契約1が先に成約
    await signContract(demand, c1.contract.id, 1);
    await signContract(supply, c1.contract.id, 1);

    // 契約2は締結（2人目の署名で成約確定）できない
    const s1 = await signContract(demand, c2.contract.id, 1);
    expect("error" in s1).toBe(false); // 片側署名のみは可
    const s2 = await signContract(supply, c2.contract.id, 1);
    expect("error" in s2 && s2.error?.code).toBe("VERSION_CONFLICT");
  });

  it("期間が重複しなければ同一人材が別案件と成約できる", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const p1 = await makeProject(demand, "案件1");
    const p2 = await makeProject(demand, "案件2");
    const engineer = await makeEngineer(supply, "テスト 太郎");

    const entry1 = await makeApprovedEntry(demand, supply, p1.id, engineer.id);
    await executeContract(demand, supply, entry1, {
      startDate: "2026-09-01",
      endDate: "2026-12-31",
    });

    const entry2 = await makeApprovedEntry(demand, supply, p2.id, engineer.id);
    const contract2 = await executeContract(demand, supply, entry2, {
      startDate: "2027-01-01",
      endDate: "2027-06-30",
    });
    expect(contract2).toBeTruthy();
  });

  it("無期限（終了日未定）の成約済み契約とは常に期間重複とみなす", async () => {
    const demand = await makeCompany("需要側企業");
    const supply = await makeCompany("供給側企業");
    const p1 = await makeProject(demand, "案件1");
    const p2 = await makeProject(demand, "案件2");
    const engineer = await makeEngineer(supply, "テスト 太郎");

    const entry1 = await makeApprovedEntry(demand, supply, p1.id, engineer.id);
    await executeContract(demand, supply, entry1, { startDate: "2026-09-01" }); // endDate なし

    const entry2 = await makeApprovedEntry(demand, supply, p2.id, engineer.id);
    const result = await createContract(demand, {
      entryId: entry2,
      contractType: "準委任",
      monthlyRateYen: 700_000,
      startDate: "2028-01-01",
      endDate: "2028-06-30",
      commandChecklist: CHECKLIST,
    });
    expect("error" in result && result.error.code).toBe("VALIDATION_ERROR");
  });
});
