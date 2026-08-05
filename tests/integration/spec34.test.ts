// 必須テスト（仕様書 §34）の統合テスト。専用DB sesmatch_test に対して実行する。
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  addConsent,
  createEngineer,
  getEngineer,
  listEngineers,
  publishEngineer,
} from "@/server/services/engineers";
import { createProject, publishProject } from "@/server/services/projects";
import { approveEntry, createEntry, getEntry, sendMessage } from "@/server/services/entries";
import {
  cancelContract,
  confirmWorkMonth,
  createContract,
  signContract,
  startWork,
  terminateContract,
} from "@/server/services/contracts";
import {
  createPrivacyRequest,
  decidePrivacyRequest,
  executePurge,
} from "@/server/services/privacy";
import { addMemberWithRoles, futureDate, iso, makeCompany, truncateAll } from "./helpers";
import type { AuthContext } from "@/server/auth/session";

beforeEach(async () => {
  await truncateAll();
});

// ---- フィクスチャ ----

async function makeEngineer(auth: AuthContext, opts: { consent?: boolean; publish?: boolean } = {}) {
  const e = await createEngineer(auth, {
    name: "テスト 太郎",
    ageBand: 30,
    affiliationType: "EMPLOYEE",
    desiredRateYen: 700_000,
    availableFrom: iso(futureDate(10)),
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
  });
  if (opts.consent !== false) {
    await addConsent(auth, e.id, {
      method: "メール",
      documentVersion: "v1",
      purposes: ["マッチング"],
    });
  }
  if (opts.publish !== false) {
    const r = await publishEngineer(auth, e.id);
    if ("error" in r) throw new Error(`publish failed: ${r.error}`);
  }
  return e;
}

async function makeProject(auth: AuthContext) {
  const result = await createProject(auth, {
    name: "テスト案件",
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

async function makeApprovedEntry() {
  const demand = await makeCompany("需要側企業");
  const supply = await makeCompany("供給側企業");
  const project = await makeProject(demand);
  const engineer = await makeEngineer(supply);
  const created = await createEntry(supply, {
    type: "PROPOSAL",
    projectId: project.id,
    engineerId: engineer.id,
  });
  if (created.error) throw new Error(created.error.code);
  const approved = await approveEntry(demand, created.entry!.id);
  if (approved.error) throw new Error(approved.error.code);
  return { demand, supply, project, engineer, entryId: created.entry!.id };
}

// ---- テナント間データ分離 ----

describe("テナント間データ分離", () => {
  it("他社の非公開人材は取得できない（404相当・存在推測防止 §29）", async () => {
    const a = await makeCompany("A社");
    const b = await makeCompany("B社");
    const draft = await makeEngineer(a, { publish: false });
    expect(await getEngineer(b, draft.id)).toBeNull();
    expect(await getEngineer(a, draft.id)).not.toBeNull(); // 自社は参照可
  });

  it("公開人材検索に他社の下書き・同意なし人材は含まれない", async () => {
    const a = await makeCompany("A社");
    const b = await makeCompany("B社");
    await makeEngineer(a, { publish: false }); // 下書き
    await makeEngineer(a); // 公開+同意あり
    const visible = (await listEngineers(b, "public")).items;
    expect(visible).toHaveLength(1);
  });
});

// ---- ロール別PII閲覧制御 ----

describe("ロール別PII閲覧制御（§7.3, §10）", () => {
  it("engineer.read.pii を持たないロールには氏名・実額を返さない", async () => {
    const owner = await makeCompany("A社");
    const engineer = await makeEngineer(owner);
    const viewer = await addMemberWithRoles(owner, ["VIEWER"]);
    const hr = await addMemberWithRoles(owner, ["HR_MANAGER"]);

    const forViewer = await getEngineer(viewer, engineer.id);
    expect(forViewer!.name).toBeUndefined();
    expect(forViewer!.desiredRateYen).toBeUndefined();

    const forHr = await getEngineer(hr, engineer.id);
    expect(forHr!.name).toBe("テスト 太郎");
    expect(forHr!.desiredRateYen).toBe(700_000);
  });

  it("他社からは Level 1（匿名）のみ", async () => {
    const a = await makeCompany("A社");
    const b = await makeCompany("B社");
    const engineer = await makeEngineer(a);
    const view = await getEngineer(b, engineer.id);
    expect(view!.name).toBeUndefined();
    expect(view!.desiredRateYen).toBeUndefined();
    expect(view!.rateBand).toBe("70〜80万円"); // 10万円幅の帯のみ
  });
});

// ---- 同意・公開制御 ----

describe("本人同意（§11.3, §34）", () => {
  it("有効な同意がない人材は公開できない", async () => {
    const a = await makeCompany("A社");
    const e = await createEngineer(a, {
      name: "同意なし",
      ageBand: 30,
      affiliationType: "EMPLOYEE",
      desiredRateYen: 600_000,
    });
    const result = await publishEngineer(a, e.id);
    expect(result).toEqual({ error: "CONSENT_REQUIRED" });
  });
});

// ---- 案件内容の記載制限（2026-08-04 撤廃）----

describe("案件内容の記載制限（撤廃済み）", () => {
  it("国籍等に言及する記載があっても案件は登録できる（キーワード拒否は行わない）", async () => {
    const a = await makeCompany("A社");
    const result = await createProject(a, {
      name: "外国籍可の案件",
      anonymousSummary: "概要",
      startDate: iso(futureDate(30)),
      contractType: "準委任",
      rateMaxYen: 800_000,
    });
    expect("error" in result).toBe(false);
  });
});

// ---- エントリー・双方承認 ----

describe("エントリー（§20, §34）", () => {
  it("重複応募をブロックする（§18）", async () => {
    const demand = await makeCompany("需要側");
    const supply = await makeCompany("供給側");
    const project = await makeProject(demand);
    const engineer = await makeEngineer(supply);
    const first = await createEntry(supply, { type: "PROPOSAL", projectId: project.id, engineerId: engineer.id });
    expect("entry" in first).toBe(true);
    const second = await createEntry(supply, { type: "PROPOSAL", projectId: project.id, engineerId: engineer.id });
    expect(second.error?.code).toBe("DUPLICATE_ENTRY");
  });

  it("片側承認では開示レコードを作成しない（§20.3, §34）", async () => {
    const demand = await makeCompany("需要側");
    const supply = await makeCompany("供給側");
    const project = await makeProject(demand);
    const engineer = await makeEngineer(supply);
    const created = await createEntry(supply, { type: "PROPOSAL", projectId: project.id, engineerId: engineer.id });
    const entryId = ("entry" in created && created.entry!.id) as string;

    // 提案時点 = 供給側承認のみ
    expect(await prisma.disclosure.findUnique({ where: { entryId } })).toBeNull();
    const view = await getEntry(demand, entryId);
    expect(view!.disclosure).toBeNull();
    expect(view!.counterpartCompanyName).toBeNull();
    expect(view!.engineer.name).toBeUndefined(); // 匿名のまま
  });

  it("双方承認と Level 2 開示は原子的に成立する（§20.3, §34）", async () => {
    const { demand, supply, entryId } = await makeApprovedEntry();
    const disclosure = await prisma.disclosure.findUnique({ where: { entryId } });
    expect(disclosure).not.toBeNull();
    expect(disclosure!.level).toBe(2);

    // 相互・同時開示: 双方から相手企業名と氏名・実額が見える
    const demandView = await getEntry(demand, entryId);
    expect(demandView!.status).toBe("MUTUALLY_APPROVED");
    expect(demandView!.counterpartCompanyName).toBe("供給側企業");
    expect(demandView!.disclosure!.engineerName).toBe("テスト 太郎");
    expect(demandView!.disclosure!.engineerRateYen).toBe(700_000);
    const supplyView = await getEntry(supply, entryId);
    expect(supplyView!.counterpartCompanyName).toBe("需要側企業");
  });

  it("承認の並行実行は一方だけ成功し、開示レコードは1件のみ（冪等性 §34）", async () => {
    const demand = await makeCompany("需要側");
    const supply = await makeCompany("供給側");
    const project = await makeProject(demand);
    const engineer = await makeEngineer(supply);
    const created = await createEntry(supply, { type: "PROPOSAL", projectId: project.id, engineerId: engineer.id });
    const entryId = ("entry" in created && created.entry!.id) as string;

    // 需要側の承認を同時に2回実行
    const results = await Promise.all([
      approveEntry(demand, entryId),
      approveEntry(demand, entryId),
    ]);
    const successes = results.filter((r) => !("error" in r));
    expect(successes).toHaveLength(1);
    expect(await prisma.disclosure.count({ where: { entryId } })).toBe(1);
  });

  it("相互承認前のメッセージは連絡先を拒否し、承認後は許可する（§21）", async () => {
    const demand = await makeCompany("需要側");
    const supply = await makeCompany("供給側");
    const project = await makeProject(demand);
    const engineer = await makeEngineer(supply);
    const created = await createEntry(supply, { type: "PROPOSAL", projectId: project.id, engineerId: engineer.id });
    const entryId = ("entry" in created && created.entry!.id) as string;

    const blocked = await sendMessage(supply, entryId, "連絡先は 090-1234-5678 です");
    expect(blocked.error?.code).toBe("PII_VALIDATION_FAILED");

    await approveEntry(demand, entryId);
    const allowed = await sendMessage(supply, entryId, "連絡先は 090-1234-5678 です");
    expect("message" in allowed).toBe(true);
  });
});

// ---- 契約・手数料 ----

const CHECKLIST = {
  instructionManager: "供給側PM経由",
  attendanceManager: "供給側企業",
  assignmentDecider: "供給側企業",
  acceptanceMethod: "月次報告書",
  resubcontractApproval: "再委託なし",
};

async function makeActiveContract() {
  const ctx = await makeApprovedEntry();
  const created = await createContract(ctx.demand, {
    entryId: ctx.entryId,
    contractType: "準委任",
    monthlyRateYen: 700_000,
    startDate: "2026-08-01",
    commandChecklist: CHECKLIST,
  });
  if ("error" in created) throw new Error(created.error.code);
  const contractId = created.contract.id;
  await signContract(ctx.demand, contractId, 1);
  await signContract(ctx.supply, contractId, 1);
  await startWork(ctx.demand, contractId, "2026-08-01");
  return { ...ctx, contractId };
}

describe("契約・手数料（§22, §23, §34）", () => {
  it("稼働前キャンセルは手数料0円（§23）", async () => {
    const ctx = await makeApprovedEntry();
    const created = await createContract(ctx.demand, {
      entryId: ctx.entryId,
      contractType: "準委任",
      monthlyRateYen: 700_000,
      startDate: "2026-08-01",
      commandChecklist: CHECKLIST,
    });
    const contractId = ("contract" in created && created.contract.id) as string;
    await signContract(ctx.demand, contractId, 1);
    await signContract(ctx.supply, contractId, 1);
    const cancelled = await cancelContract(ctx.demand, contractId);
    expect("ok" in cancelled).toBe(true);
    expect(await prisma.platformFee.count({ where: { contractId } })).toBe(0);
  });

  it("開始後14日以内の離脱は手数料をキャンセル（0円）にする（§23, §34）", async () => {
    const { demand, contractId } = await makeActiveContract();
    await confirmWorkMonth(demand, contractId, { month: "2026-08", amountYen: 700_000 });
    const result = await terminateContract(demand, contractId, { date: "2026-08-10" });
    expect("ok" in result && result.refund).toBe(true);
    const fees = await prisma.platformFee.findMany({ where: { contractId } });
    expect(fees.every((f) => f.status === "CANCELLED" && f.feeExTaxYen === 0)).toBe(true);
  });

  it("15日以降の終了は返金しない", async () => {
    const { demand, contractId } = await makeActiveContract();
    await confirmWorkMonth(demand, contractId, { month: "2026-08", amountYen: 700_000 });
    const result = await terminateContract(demand, contractId, { date: "2026-09-15" });
    expect("ok" in result && result.refund).toBe(false);
    const fees = await prisma.platformFee.findMany({ where: { contractId } });
    expect(fees.every((f) => f.status === "CHARGED")).toBe(true);
  });

  it("13稼働月目以降は無料（12か月上限 §23, §34）", async () => {
    const { demand, contractId } = await makeActiveContract();
    // 2026-08 から 13ヶ月分の月次確認
    const months: string[] = [];
    for (let i = 0; i < 13; i++) {
      const d = new Date(Date.UTC(2026, 7 + i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    for (const month of months) {
      const r = await confirmWorkMonth(demand, contractId, { month, amountYen: 700_000 });
      expect("fee" in r).toBe(true);
    }
    const fees = await prisma.platformFee.findMany({
      where: { contractId },
      orderBy: { chargeableMonthIndex: "asc" },
    });
    expect(fees).toHaveLength(13);
    expect(fees[11].status).toBe("CHARGED"); // 12稼働月目
    expect(fees[11].feeExTaxYen).toBe(21_000);
    expect(fees[12].status).toBe("FREE"); // 13稼働月目
    expect(fees[12].feeExTaxYen).toBe(0);
  });

  it("月次確認は需要側のみ・同月重複は拒否", async () => {
    const { demand, supply, contractId } = await makeActiveContract();
    const bySupply = await confirmWorkMonth(supply, contractId, { month: "2026-08", amountYen: 700_000 });
    expect(bySupply.error?.code).toBe("FORBIDDEN");
    await confirmWorkMonth(demand, contractId, { month: "2026-08", amountYen: 700_000 });
    const dup = await confirmWorkMonth(demand, contractId, { month: "2026-08", amountYen: 700_000 });
    expect(dup.error?.code).toBe("DUPLICATE_ENTRY");
  });
});

// ---- 本人削除請求 ----

describe("本人削除・物理削除（§26, §34）", () => {
  it("受付で即時非公開 → 承認で論理削除 → 30日後に物理削除", async () => {
    const a = await makeCompany("A社");
    const b = await makeCompany("B社");
    const engineer = await makeEngineer(a);

    // 受付 → 即時非公開（他社の公開検索から消える）
    const created = await createPrivacyRequest(a, { engineerId: engineer.id, kind: "DELETION" });
    const requestId = created.request?.id as string;
    expect((await listEngineers(b, "public")).items).toHaveLength(0);

    // 承認 → 論理削除
    await decidePrivacyRequest(a, requestId, true);
    const row = await prisma.engineer.findUnique({ where: { id: engineer.id } });
    expect(row!.deletedAt).not.toBeNull();
    expect(await getEngineer(b, engineer.id)).toBeNull();

    // 30日経過前の物理削除は拒否
    const early = await executePurge(a, requestId);
    expect("error" in early).toBe(true);

    // 30日経過後は物理削除できる（スケジュールを過去に設定して再実行）
    await prisma.privacyRequest.update({
      where: { id: requestId },
      data: { scheduledPurgeAt: new Date(Date.now() - 1000) },
    });
    const purged = await executePurge(a, requestId);
    expect("ok" in purged).toBe(true);
    const after = await prisma.engineer.findUnique({ where: { id: engineer.id } });
    expect(after!.name).toBe("（削除済み）"); // PII不可逆除去
    expect(await prisma.personConsent.count({ where: { engineerId: engineer.id } })).toBe(0);
  });
});
