// 相互取引先の掲載企業名表示（§10.1・2026-08-22）の統合テスト。専用DB sesmatch_test に対して実行する。
// 相互登録（双方がお互いを企業間関係に登録）した取引先の他社案件・人材にのみ掲載企業名を表示する。
// 片方向の登録では表示しない（名前を登録するだけで匿名掲載の保有企業を特定できてしまうため）。
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { mutualPartnerNames } from "@/server/services/partners";
import { createProject, publishProject, listProjects } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer, listEngineers } from "@/server/services/engineers";
import { futureDate, iso, makeCompany, truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

async function addRelationship(companyId: string, partnerName: string) {
  await prisma.companyRelationship.create({
    data: { companyId, partnerName, type: "PARTNER" },
  });
}

async function publishFixtures(owner: Awaited<ReturnType<typeof makeCompany>>) {
  const projectResult = await createProject(owner, {
    name: "取引先テスト案件",
    anonymousSummary: "大手金融機関向けの開発案件",
    startDate: iso(futureDate(30)),
    contractType: "準委任",
    rateMaxYen: 800_000,
    requiredSkills: [{ name: "Java" }],
  });
  if ("error" in projectResult) throw new Error(String(projectResult.error));
  await publishProject(owner, projectResult.project.id);
  const engineer = await createEngineer(owner, {
    name: "取引先 太郎",
    ageBand: 30,
    affiliationType: "EMPLOYEE",
    desiredRateYen: 700_000,
    availableFrom: iso(futureDate(10)),
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
  });
  await addConsent(owner, engineer.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
  await publishEngineer(owner, engineer.id);
}

describe("相互取引先の掲載企業名表示（§10.1）", () => {
  it("片方向の登録では企業名を表示しない", async () => {
    const alpha = await makeCompany("株式会社アルファ");
    const beta = await makeCompany("株式会社ベータ");
    await publishFixtures(beta);
    // アルファのみがベータを登録（ベータは未登録）
    await addRelationship(alpha.companyId, "株式会社ベータ");

    expect((await mutualPartnerNames(alpha.companyId)).size).toBe(0);
    const projects = await listProjects(alpha, "public");
    expect(projects.items[0].partnerCompanyName).toBeUndefined();
    const engineers = await listEngineers(alpha, "public");
    expect(engineers.items[0].partnerCompanyName).toBeUndefined();
  });

  it("相互登録した取引先の案件・人材に掲載企業名を表示する（法人格表記のゆれも照合）", async () => {
    const alpha = await makeCompany("株式会社アルファ");
    const beta = await makeCompany("株式会社ベータ");
    await publishFixtures(beta);
    // 相互登録（表記ゆれ: (株) と 株式会社）
    await addRelationship(alpha.companyId, "(株)ベータ");
    await addRelationship(beta.companyId, "株式会社アルファ");

    const map = await mutualPartnerNames(alpha.companyId);
    expect(map.get(beta.companyId)).toBe("株式会社ベータ");

    const projects = await listProjects(alpha, "public");
    expect(projects.items[0].partnerCompanyName).toBe("株式会社ベータ");
    const engineers = await listEngineers(alpha, "public");
    expect(engineers.items[0].partnerCompanyName).toBe("株式会社ベータ");

    // 相手側（ベータ）から見てもアルファの名前が引ける（相互）
    expect((await mutualPartnerNames(beta.companyId)).get(alpha.companyId)).toBe("株式会社アルファ");
  });

  it("無関係の第三者企業には表示しない", async () => {
    const alpha = await makeCompany("株式会社アルファ");
    const beta = await makeCompany("株式会社ベータ");
    const gamma = await makeCompany("株式会社ガンマ");
    await publishFixtures(beta);
    await addRelationship(alpha.companyId, "株式会社ベータ");
    await addRelationship(beta.companyId, "株式会社アルファ");

    // 相互登録はアルファ⇄ベータのみ。ガンマから見たベータの掲載は匿名のまま
    expect((await mutualPartnerNames(gamma.companyId)).size).toBe(0);
    const projects = await listProjects(gamma, "public");
    expect(projects.items[0].partnerCompanyName).toBeUndefined();
  });
});
