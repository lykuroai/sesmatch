// 新規企業30日間手数料無料の統合テスト。専用DB sesmatch_test に対して実行する。
// 需要側企業の承認（approvedAt）から30日以内に月初が来る稼働月の手数料は FREE・0円。
// 無料月は CHARGED に数えないため、12稼働月の課金枠を消費しない。
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { createProject, publishProject } from "@/server/services/projects";
import { approveEntry, createEntry } from "@/server/services/entries";
import { confirmWorkMonth, createContract, signContract, startWork } from "@/server/services/contracts";
import { futureDate, iso, makeCompany, truncateAll } from "./helpers";

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

async function makeActiveContract() {
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
  await publishEngineer(supply, engineer.id);
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
    startDate: "2026-08-01",
    commandChecklist: CHECKLIST,
  });
  if ("error" in contractResult) throw new Error(contractResult.error.message);
  const contractId = contractResult.contract.id;
  await signContract(demand, contractId, 1);
  await signContract(supply, contractId, 1);
  await startWork(demand, contractId, "2026-08-01");
  return { demand, supply, contractId };
}

describe("新規企業30日間手数料無料（§23 キャンペーン）", () => {
  it("承認から30日以内の稼働月は無料、以降は課金。無料月は課金枠を消費しない", async () => {
    const { demand, contractId } = await makeActiveContract();
    // 需要側企業を「2026-08-05 承認の新規企業」にする（無料期間: 〜2026-09-04）
    await prisma.company.update({
      where: { id: demand.companyId },
      data: { approvedAt: new Date("2026-08-05T00:00:00Z") },
    });

    // 8月（承認月）・9月（月初9/1が9/4以前）→ 無料
    const aug = await confirmWorkMonth(demand, contractId, { month: "2026-08", amountYen: 700_000 });
    const sep = await confirmWorkMonth(demand, contractId, { month: "2026-09", amountYen: 700_000 });
    // 10月（月初10/1は無料期間外）→ 課金
    const oct = await confirmWorkMonth(demand, contractId, { month: "2026-10", amountYen: 700_000 });
    if ("error" in aug || "error" in sep || "error" in oct) throw new Error("confirm failed");

    const fees = await prisma.platformFee.findMany({ where: { contractId }, orderBy: { month: "asc" } });
    expect(fees.map((f) => [f.month, f.status, f.feeExTaxYen])).toEqual([
      ["2026-08", "FREE", 0],
      ["2026-09", "FREE", 0],
      ["2026-10", "CHARGED", 21_000],
    ]);
    // 無料2か月は課金枠を消費しないため、10月が1稼働月目（課金1件目）
    expect(fees[2].chargeableMonthIndex).toBe(1);
  });

  it("承認から30日を超えた既存企業は初月から課金", async () => {
    const { demand, contractId } = await makeActiveContract(); // makeCompany は承認90日前
    const aug = await confirmWorkMonth(demand, contractId, { month: "2026-08", amountYen: 700_000 });
    if ("error" in aug) throw new Error("confirm failed");
    const fee = await prisma.platformFee.findFirstOrThrow({ where: { contractId, month: "2026-08" } });
    expect(fee.status).toBe("CHARGED");
    expect(fee.feeExTaxYen).toBe(21_000);
  });
});
