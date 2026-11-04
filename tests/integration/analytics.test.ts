// 分析・エクスポート（PRO版仕様書 §4.4, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
// - 基本版は 403 PLAN_REQUIRED
// - ファネルは自社が当事者の商談だけを数える
// - 市場単価レンジは母数5件未満を出さず、企業名・案件名を含まない
// - CSV は自社データのみ。他社の未開示情報（企業名・人材氏名）を含まない。監査に記録される
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll, futureDate, iso } from "./helpers";
import { createProject, publishProject } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { createEntry } from "@/server/services/entries";
import { exportCsv, getFunnel, getMarketRates, rangeOfMonths } from "@/server/services/analytics";
import { issueApiToken } from "@/server/auth/api-token";
import { app } from "@/server/api/app";
import { parseCsv } from "@/lib/csv";

beforeEach(async () => {
  await truncateAll();
});

async function publishProjectOf(owner: Awaited<ReturnType<typeof makeCompany>>, name: string, skill: string, rateMax: number, city = "東京都港区") {
  const r = await createProject(owner, {
    name,
    anonymousSummary: "匿名概要",
    startDate: iso(futureDate(30)),
    contractType: "準委任",
    rateMaxYen: rateMax,
    locationCity: city,
    requiredSkills: [{ name: skill }],
  });
  if ("error" in r) throw new Error(String(r.error));
  await publishProject(owner, r.project.id);
  return r.project.id;
}

async function publishEngineerOf(owner: Awaited<ReturnType<typeof makeCompany>>, name: string) {
  const e = await createEngineer(owner, {
    name,
    ageBand: 30,
    affiliationType: "EMPLOYEE",
    desiredRateYen: 650_000,
    availableFrom: iso(futureDate(10)),
    skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
  });
  await addConsent(owner, e.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
  await publishEngineer(owner, e.id);
  return e.id;
}

describe("分析・エクスポート", () => {
  it("基本版は API で 403 PLAN_REQUIRED", async () => {
    const free = await makeCompany("分析基本版株式会社");
    const issued = await issueApiToken(free, { name: "t", scope: "connector", expiresInDays: null });
    if ("error" in issued) throw new Error("token");
    for (const path of ["/api/v1/analytics/funnel", "/api/v1/analytics/market-rates", "/api/v1/analytics/export?kind=projects"]) {
      const res = await app.request(path, { headers: { Authorization: `Bearer ${issued.token}` } });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("PLAN_REQUIRED");
    }
  });

  it("ファネル・市場単価・CSV: 自社データのみ、他社の未開示情報と母数不足のセルを含まない", async () => {
    const pro = await setPlan(await makeCompany("分析PRO株式会社"), "PRO");
    const other = await makeCompany("他社株式会社");
    const third = await makeCompany("第三者株式会社");

    // 市場単価: 他社の Java 東京 5件 + 自社 1件（計6件）、PHP 2件（母数不足）
    for (const r of [60, 70, 80, 90, 100]) await publishProjectOf(other, `他社Java${r}`, "Java", r * 10_000);
    const ownProjectId = await publishProjectOf(pro, "自社Java案件", "Java", 750_000);
    await publishProjectOf(third, "PHP1", "PHP", 600_000);
    await publishProjectOf(third, "PHP2", "PHP", 650_000);

    // 商談: 自社案件へ他社から提案（受信）1件、第三者同士の商談（自社は当事者でない）1件
    const otherEngineer = await publishEngineerOf(other, "他社 太郎");
    const received = await createEntry(other, { type: "PROPOSAL", projectId: ownProjectId, engineerId: otherEngineer });
    if (received.error) throw new Error(received.error.code);
    const thirdProject = await publishProjectOf(third, "第三者案件", "Java", 700_000);
    const unrelated = await createEntry(other, { type: "PROPOSAL", projectId: thirdProject, engineerId: otherEngineer });
    if (unrelated.error) throw new Error(unrelated.error.code);

    const funnel = await getFunnel(pro, rangeOfMonths(3));
    expect(funnel.received.submitted).toBe(1);
    expect(funnel.sent.submitted).toBe(0);
    expect(funnel.total.submitted).toBe(1);

    const market = await getMarketRates();
    expect(market.rows).toHaveLength(1);
    // 他社5件 + 自社1件 + 第三者1件（第三者案件も Java・東京）= 7件
    expect(market.rows[0]).toMatchObject({ skill: "Java", prefecture: "東京都", count: 7, minYen: 600_000, maxYen: 1_000_000 });
    const marketJson = JSON.stringify(market);
    expect(marketJson).not.toContain("他社株式会社");
    expect(marketJson).not.toContain("他社Java");

    // CSV: 案件は自社のみ
    const projectsCsv = await exportCsv(pro, "projects");
    const projectRows = parseCsv(projectsCsv.csv);
    expect(projectRows).toHaveLength(2); // ヘッダ + 自社1件
    expect(projectRows[1][1]).toBe("自社Java案件");
    expect(projectsCsv.csv).not.toContain("他社Java");

    // CSV: 商談は自社が当事者のもののみ。PRO のため相手の掲載企業名は含むが、人材氏名は未開示のため含まない
    const entriesCsv = await exportCsv(pro, "entries");
    const entryRows = parseCsv(entriesCsv.csv);
    expect(entryRows).toHaveLength(2);
    expect(entriesCsv.csv).toContain("他社株式会社");
    expect(entriesCsv.csv).not.toContain("他社 太郎");
    expect(entriesCsv.csv).not.toContain("第三者案件");

    // 監査に記録される（個人情報なし）
    const audits = await prisma.auditEvent.findMany({ where: { action: "AnalyticsExported", tenantCompanyId: pro.companyId } });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("他社 太郎");

    // API 経由の CSV は text/csv で BOM 付き
    const issued = await issueApiToken(pro, { name: "t", scope: "connector", expiresInDays: null });
    if ("error" in issued) throw new Error("token");
    const res = await app.request("/api/v1/analytics/export?kind=projects", { headers: { Authorization: `Bearer ${issued.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // BOM（text() は BOM を除去するためバイトで確認）
  });

  it("人材 CSV は engineer.read.pii を持たないロール（経理）には氏名・実額を出さない", async () => {
    const pro = await setPlan(await makeCompany("人材CSV株式会社"), "PRO");
    await publishEngineerOf(pro, "自社 花子");
    const ownerCsv = await exportCsv(pro, "engineers");
    expect(ownerCsv.csv).toContain("自社 花子");
    const { addMemberWithRoles } = await import("./helpers");
    const viewer = await addMemberWithRoles(pro, ["ACCOUNTING"]); // engineer.read.pii を持たないロール
    const viewerCsv = await exportCsv({ ...viewer, plan: "PRO" }, "engineers");
    expect(viewerCsv.csv).not.toContain("自社 花子");
    expect(viewerCsv.csv).not.toContain("650000");
  });
});
