// 取引先の掲載企業名表示（§10.1・2026-08-22）の統合テスト。専用DB sesmatch_test に対して実行する。
// 企業間関係に登録した取引先の他社案件・人材に掲載企業名を表示する（片方向。
// 当初は相互登録を条件としていたが2026-08-22の郭判断で片方向へ変更）。
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { registeredPartnerNames } from "@/server/services/partners";
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

describe("取引先の掲載企業名表示（§10.1・片方向）", () => {
  it("自社が登録した取引先の案件・人材に掲載企業名を表示する（法人格表記のゆれも照合）", async () => {
    const alpha = await makeCompany("株式会社アルファ");
    const beta = await makeCompany("株式会社ベータ");
    await publishFixtures(beta);
    // アルファのみがベータを登録（表記ゆれ: (株) と 株式会社）。相手側の登録は不要
    await addRelationship(alpha.companyId, "(株)ベータ");

    const map = await registeredPartnerNames(alpha.companyId);
    expect(map.get(beta.companyId)).toBe("株式会社ベータ");

    const projects = await listProjects(alpha, "public");
    expect(projects.items[0].partnerCompanyName).toBe("株式会社ベータ");
    const engineers = await listEngineers(alpha, "public");
    expect(engineers.items[0].partnerCompanyName).toBe("株式会社ベータ");

    // 片方向のため、未登録のベータ側から見たアルファは引けない
    expect((await registeredPartnerNames(beta.companyId)).size).toBe(0);
  });

  it("未登録の企業には表示しない", async () => {
    const alpha = await makeCompany("株式会社アルファ");
    const beta = await makeCompany("株式会社ベータ");
    const gamma = await makeCompany("株式会社ガンマ");
    await publishFixtures(beta);
    await addRelationship(alpha.companyId, "株式会社ベータ");

    // 登録していないガンマから見たベータの掲載は匿名のまま
    expect((await registeredPartnerNames(gamma.companyId)).size).toBe(0);
    const projects = await listProjects(gamma, "public");
    expect(projects.items[0].partnerCompanyName).toBeUndefined();
  });

  it("テナント未登録の企業名を登録しても何も表示されない", async () => {
    const alpha = await makeCompany("株式会社アルファ");
    const beta = await makeCompany("株式会社ベータ");
    await publishFixtures(beta);
    await addRelationship(alpha.companyId, "存在しない商事株式会社");

    expect((await registeredPartnerNames(alpha.companyId)).size).toBe(0);
    const projects = await listProjects(alpha, "public");
    expect(projects.items[0].partnerCompanyName).toBeUndefined();
  });
});
