// 商談メッセージ送信時のメール通知（相手企業の担当者へ）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { createEngineer, publishEngineer } from "@/server/services/engineers";
import { createProject, publishProject } from "@/server/services/projects";
import { approveEntry, createEntry, sendMessage } from "@/server/services/entries";
import { addMemberWithRoles, futureDate, iso, makeCompany, truncateAll } from "./helpers";
import type { AuthContext } from "@/server/auth/session";

vi.mock("@/server/mail", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/mail")>();
  return { ...mod, sendMail: vi.fn(async () => {}) };
});
import { sendMail } from "@/server/mail";
const sent = sendMail as unknown as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await truncateAll();
  sent.mockClear();
});

async function setup() {
  const demand = await makeCompany("需要側企業");
  const supply = await makeCompany("供給側企業");
  const project = await createProject(demand, {
    name: "通知テスト案件",
    anonymousSummary: "通知テスト用",
    startDate: iso(futureDate(30)),
    contractType: "準委任",
    rateMaxYen: 800_000,
    requiredSkills: [{ name: "Java" }],
  });
  if ("error" in project) throw new Error(project.error);
  await publishProject(demand, project.project.id);
  const engineer = await createEngineer(supply, {
    name: "テスト 太郎",
    ageBand: 30,
    affiliationType: "EMPLOYEE",
    desiredRateYen: 700_000,
    availableFrom: iso(futureDate(10)),
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
  });
  await publishEngineer(supply, engineer.id);
  const created = await createEntry(supply, {
    type: "PROPOSAL",
    projectId: project.project.id,
    engineerId: engineer.id,
  });
  if (created.error) throw new Error(created.error.code);
  sent.mockClear(); // 受付通知は対象外
  return { demand, supply, project: project.project, engineer, entryId: created.entry!.id };
}

const mailsTo = (auth: AuthContext) =>
  sent.mock.calls.map((c) => c[0] as { to: string; subject: string; body: string }).filter((m) => m.to === auth.email);

describe("メッセージ受信通知", () => {
  it("供給側が送ると需要側（案件登録者）へ本文付きで届き、送信者本人へは届かない", async () => {
    const { demand, supply, project, entryId } = await setup();
    const r = await sendMessage(supply, entryId, "面談候補日を教えてください");
    expect("message" in r).toBe(true);

    const toDemand = mailsTo(demand);
    expect(toDemand).toHaveLength(1);
    expect(toDemand[0].subject).toContain("新しいメッセージ");
    expect(toDemand[0].body).toContain("面談候補日を教えてください");
    expect(toDemand[0].body).toContain(project.code);
    expect(toDemand[0].body).toContain(`/entries/${entryId}`);
    // 双方承認前: 送信者の企業名は載せない（担当者名のみ）
    expect(toDemand[0].body).not.toContain("供給側企業");
    expect(mailsTo(supply)).toHaveLength(0);
  });

  it("需要側が返信すると供給側（商談申込者）へ届く", async () => {
    const { demand, supply, entryId } = await setup();
    await sendMessage(demand, entryId, "来週火曜はいかがでしょうか");
    expect(mailsTo(supply)).toHaveLength(1);
    expect(mailsTo(demand)).toHaveLength(0);
  });

  it("相手側でメッセージを送った担当者も宛先に含まれる（登録者との和集合・重複なし）", async () => {
    const { demand, supply, entryId } = await setup();
    const demandStaff = await addMemberWithRoles(demand, ["SALES"]);
    await sendMessage(demandStaff, entryId, "担当の者です");
    sent.mockClear();

    await sendMessage(supply, entryId, "よろしくお願いします");
    expect(mailsTo(demandStaff)).toHaveLength(1);
    expect(mailsTo(demand)).toHaveLength(1);
    expect(sent.mock.calls).toHaveLength(2);
  });

  it("連絡先を含み拒否されたメッセージは通知しない", async () => {
    const { demand, supply, entryId } = await setup();
    const r = await sendMessage(supply, entryId, "連絡先は 090-1234-5678 です");
    expect(r.error?.code).toBe("PII_VALIDATION_FAILED");
    expect(mailsTo(demand)).toHaveLength(0);
  });

  it("双方承認後も通知される", async () => {
    const { demand, supply, entryId } = await setup();
    await approveEntry(demand, entryId);
    sent.mockClear();
    await sendMessage(supply, entryId, "承認ありがとうございます");
    expect(mailsTo(demand)).toHaveLength(1);
    expect(await prisma.entryMessage.count({ where: { entryId } })).toBe(1);
  });
});
