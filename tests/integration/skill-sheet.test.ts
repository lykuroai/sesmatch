// スキルシート再生成（PRO版仕様書 §4.7, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
// - 基本版は PLAN_REQUIRED。自社テンプレートは3件まで
// - 他社人材の実名版は双方承認（Level 2 開示）がなければ 403、開示後は開示スナップショットの氏名を使う
// - 匿名版に氏名・実額を含めない。監査ログに氏名を書かない
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { addMemberWithRoles, makeCompany, setPlan, truncateAll, futureDate, iso } from "./helpers";
import { createProject, publishProject } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import { approveEntry, createEntry } from "@/server/services/entries";
import { buildSkillSheet, createSheetTemplate, listSheetTemplates, type SheetModel } from "@/server/services/skill-sheet";

vi.mock("@/server/mail", () => ({ appBaseUrl: () => "http://test.local", sendMail: async () => {} }));

beforeEach(async () => {
  await truncateAll();
});

describe("スキルシート再生成", () => {
  it("基本版は PLAN_REQUIRED。PRO の自社テンプレートは3件まで", async () => {
    const free = await makeCompany("書式基本版株式会社");
    const r = await buildSkillSheet(free, "x", { mode: "anonymous", templateId: "standard", format: "html" });
    expect("error" in r && r.error.code).toBe("PLAN_REQUIRED");
    const pro = await setPlan(await makeCompany("書式PRO株式会社"), "PRO");
    const input = { name: "t", title: "技術者経歴書", showCompanyName: true, footerNote: "", sections: {} };
    for (let i = 0; i < 3; i++) expect("ok" in (await createSheetTemplate(pro, input))).toBe(true);
    const over = await createSheetTemplate(pro, input);
    expect("error" in over && over.error?.code).toBe("PLAN_LIMIT_EXCEEDED");
    expect((await listSheetTemplates(pro)).filter((t) => !t.builtin)).toHaveLength(3);
  });

  it("匿名版と実名版の開示条件、監査ログ", async () => {
    const demand = await setPlan(await makeCompany("需要PRO株式会社"), "PRO");
    const supply = await setPlan(await makeCompany("供給PRO株式会社"), "PRO");
    const e = await createEngineer(supply, {
      name: "秘密 花子",
      ageBand: 30,
      affiliationType: "EMPLOYEE",
      desiredRateYen: 720_000,
      skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
    });
    await addConsent(supply, e.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
    await publishEngineer(supply, e.id);

    // 自社（供給側）: 匿名版に氏名なし、実名版（OWNER=PII権限）に氏名・実額
    const anon = (await buildSkillSheet(supply, e.id, { mode: "anonymous", templateId: "standard", format: "xlsx" })) as SheetModel;
    expect(JSON.stringify(anon)).not.toContain("秘密 花子");
    expect(anon.engineer.rate).toBe("70〜80万円");
    const named = (await buildSkillSheet(supply, e.id, { mode: "named", templateId: "simple", format: "html" })) as SheetModel;
    expect(named.engineer.name).toBe("秘密 花子");
    expect(named.engineer.rate).toBe("720,000円");
    // PII 権限のない担当者（経理）は実名版不可
    const acct = await addMemberWithRoles(supply, ["ACCOUNTING"]);
    const denied = await buildSkillSheet({ ...acct, plan: "PRO" }, e.id, { mode: "named", templateId: "standard", format: "html" });
    expect("error" in denied && denied.error.code).toBe("FORBIDDEN");

    // 他社（需要側）: 開示前は実名版不可、匿名版は可
    const r = await createProject(demand, { name: "案件", anonymousSummary: "x", startDate: iso(futureDate(30)), contractType: "準委任", rateMaxYen: 800_000, requiredSkills: [{ name: "Java" }] });
    if ("error" in r) throw new Error("project");
    await publishProject(demand, r.project.id);
    const before = await buildSkillSheet(demand, e.id, { mode: "named", templateId: "standard", format: "html" });
    expect("error" in before && before.error.code).toBe("FORBIDDEN");
    expect(((await buildSkillSheet(demand, e.id, { mode: "anonymous", templateId: "standard", format: "html" })) as SheetModel).engineer.name).toBeNull();

    // 双方承認後は開示スナップショットの氏名で実名版が出せる
    const entry = await createEntry(demand, { type: "SCOUT", projectId: r.project.id, engineerId: e.id });
    if (entry.error) throw new Error(entry.error.code);
    const approved = await approveEntry(supply, entry.entry!.id);
    if (approved.error) throw new Error(approved.error.code);
    const after = (await buildSkillSheet(demand, e.id, { mode: "named", templateId: "standard", format: "html" })) as SheetModel;
    expect(after.engineer.name).toBe("秘密 花子");

    const audits = await prisma.auditEvent.findMany({ where: { action: "SkillSheetRendered" } });
    expect(audits.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(audits)).not.toContain("秘密 花子");
  });
});
