// 自社案件・人材の削除の統合テスト（テナント分離・エントリー有時のブロックを含む）
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createEngineer, deleteEngineer, listEngineers } from "@/server/services/engineers";
import { createProject, deleteProject } from "@/server/services/projects";
import { makeCompany } from "./helpers";
import type { AuthContext } from "@/server/auth/session";

beforeEach(async () => {
  await truncate();
});

async function truncate() {
  const { truncateAll } = await import("./helpers");
  await truncateAll();
}

async function seedEngineer(auth: AuthContext) {
  const e = await createEngineer(auth, {
    name: "削除 太郎",
    ageBand: 30,
    affiliationType: "EMPLOYEE",
    desiredRateYen: 700000,
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
    processes: [],
  } as never);
  return e as unknown as { id: string };
}

async function seedProject(auth: AuthContext) {
  const r = await createProject(auth, {
    name: "削除対象案件",
    anonymousSummary: "テスト用",
    startDate: "2026-09-01",
    rateMaxYen: 800000,
    requiredSkills: [{ name: "Java" }],
    preferredSkills: [],
  } as never);
  if ("error" in r) throw new Error(String(r.error));
  return r.project;
}

async function makeEntry(projectId: string, engineerId: string, auth: AuthContext, status = "SUBMITTED") {
  return prisma.entry.create({
    data: {
      type: "PROPOSAL",
      status: status as never,
      projectId,
      engineerId,
      demandCompanyId: auth.companyId,
      supplyCompanyId: auth.companyId,
      createdByCompanyId: auth.companyId,
      createdByMemberId: auth.memberId,
    },
  });
}

describe("deleteEngineer", () => {
  it("論理削除され一覧から除外される。再削除は404", async () => {
    const auth = await makeCompany("削除テスト社A");
    const engineer = await seedEngineer(auth);
    const r = await deleteEngineer(auth, engineer.id);
    expect(r).toEqual({ ok: true });
    const row = await prisma.engineer.findUnique({ where: { id: engineer.id } });
    expect(row?.deletedAt).not.toBeNull();
    expect((await listEngineers(auth, "own")).items.find((e) => e.id === engineer.id)).toBeUndefined();
    expect("error" in (await deleteEngineer(auth, engineer.id))).toBe(true);
  });

  it("進行中エントリーがあると削除できず、辞退後なら削除できる", async () => {
    const auth = await makeCompany("削除テスト社B");
    const engineer = await seedEngineer(auth);
    const project = await seedProject(auth);
    const entry = await makeEntry(project.id, engineer.id, auth, "SUBMITTED");
    const blocked = await deleteEngineer(auth, engineer.id);
    expect("error" in blocked && blocked.error?.code).toBe("VERSION_CONFLICT");

    await prisma.entry.update({ where: { id: entry.id }, data: { status: "WITHDRAWN" } });
    expect(await deleteEngineer(auth, engineer.id)).toEqual({ ok: true });
  });

  it("他テナントの人材は削除できない（404）", async () => {
    const owner = await makeCompany("持ち主社");
    const other = await makeCompany("他社");
    const engineer = await seedEngineer(owner);
    const r = await deleteEngineer(other, engineer.id);
    expect("error" in r && r.error?.code).toBe("NOT_FOUND");
    expect((await prisma.engineer.findUnique({ where: { id: engineer.id } }))?.deletedAt).toBeNull();
  });
});

describe("deleteProject", () => {
  it("スキルごと物理削除される", async () => {
    const auth = await makeCompany("案件削除社A");
    const project = await seedProject(auth);
    expect(await deleteProject(auth, project.id)).toEqual({ ok: true });
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await prisma.projectSkill.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("エントリーがある案件は削除できない", async () => {
    const auth = await makeCompany("案件削除社B");
    const engineer = await seedEngineer(auth);
    const project = await seedProject(auth);
    await makeEntry(project.id, engineer.id, auth, "WITHDRAWN");
    const r = await deleteProject(auth, project.id);
    expect("error" in r && r.error).toContain("エントリー");
    expect(await prisma.project.findUnique({ where: { id: project.id } })).not.toBeNull();
  });

  it("他テナントの案件は削除できない（404）", async () => {
    const owner = await makeCompany("案件持ち主社");
    const other = await makeCompany("案件他社");
    const project = await seedProject(owner);
    const r = await deleteProject(other, project.id);
    expect("error" in r && r.error).toBe("NOT_FOUND");
    expect(await prisma.project.findUnique({ where: { id: project.id } })).not.toBeNull();
  });
});
