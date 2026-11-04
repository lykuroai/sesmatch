// 保存検索と新着アラート（PRO版仕様書 §4.3, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
// - 基本版は 403 PLAN_REQUIRED、PRO は 10件/社まで
// - 評価: 保存後に公開された他社の対象だけを通知し、同一対象を二重通知しない。他社の非公開・自社のものは含めない
// - 通知本文に人材の氏名・実額単価（Level 2）を含めない
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll, futureDate, iso } from "./helpers";
import { createProject, publishProject } from "@/server/services/projects";
import { addConsent, createEngineer, publishEngineer } from "@/server/services/engineers";
import {
  createSavedSearch,
  evaluateOne,
  evaluateSavedSearches,
  listSavedSearches,
} from "@/server/services/saved-searches";
import { issueApiToken } from "@/server/auth/api-token";
import { app } from "@/server/api/app";

const sent: { to: string; subject: string; body: string }[] = [];
vi.mock("@/server/mail", () => ({
  appBaseUrl: () => "http://test.local",
  sendMail: async (m: { to: string; subject: string; body: string }) => {
    sent.push(m);
  },
}));

beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
});

async function publishProjectOf(owner: Awaited<ReturnType<typeof makeCompany>>, name: string, skill: string, rateMax = 800_000) {
  const r = await createProject(owner, {
    name,
    anonymousSummary: "匿名概要",
    startDate: iso(futureDate(30)),
    contractType: "準委任",
    rateMaxYen: rateMax,
    requiredSkills: [{ name: skill }],
  });
  if ("error" in r) throw new Error(String(r.error));
  await publishProject(owner, r.project.id);
  return r.project.id;
}

describe("保存検索の管理", () => {
  it("基本版は API で 403 PLAN_REQUIRED。PRO は 10件まで保存できる", async () => {
    const free = await makeCompany("保存基本版株式会社");
    const issued = await issueApiToken(free, { name: "t", scope: "connector", expiresInDays: null });
    if ("error" in issued) throw new Error("token");
    const res = await app.request("/api/v1/saved-searches", {
      method: "POST",
      headers: { Authorization: `Bearer ${issued.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "PROJECT", name: "x", criteria: {} }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PLAN_REQUIRED");

    const pro = await setPlan(await makeCompany("保存PRO株式会社"), "PRO");
    for (let i = 0; i < 10; i++) {
      const r = await createSavedSearch(pro, { kind: "PROJECT", name: `条件${i}`, criteria: { skills: ["Java"] } });
      expect("ok" in r && r.ok).toBe(true);
    }
    const over = await createSavedSearch(pro, { kind: "ENGINEER", name: "11件目", criteria: {} });
    expect("error" in over && over.error?.code).toBe("PLAN_LIMIT_EXCEEDED");
    expect(await listSavedSearches(pro, "PROJECT")).toHaveLength(10);
  });
});

describe("新着アラートの評価", () => {
  it("保存後に公開された他社案件のうち条件に合うものだけを通知し、二重通知しない", async () => {
    const pro = await setPlan(await makeCompany("アラートPRO株式会社"), "PRO");
    const other = await makeCompany("掲載株式会社");
    await publishProjectOf(other, "保存前の案件", "Java"); // 保存前に公開済み → 通知しない
    const created = await createSavedSearch(pro, { kind: "PROJECT", name: "Java案件", criteria: { skills: ["Java"] } });
    if (!("ok" in created)) throw new Error("create");
    // 評価カーソルより後に公開されるよう少し待つ
    await new Promise((r) => setTimeout(r, 20));
    const javaId = await publishProjectOf(other, "新着Java案件", "Java");
    await publishProjectOf(other, "新着PHP案件", "PHP"); // 条件外
    await publishProjectOf(pro, "自社Java案件", "Java"); // 自社 → 対象外
    const draft = await createProject(other, {
      name: "非公開Java案件",
      anonymousSummary: "x",
      startDate: iso(futureDate(30)),
      contractType: "準委任",
      rateMaxYen: 700_000,
      requiredSkills: [{ name: "Java" }],
    });
    if ("error" in draft) throw new Error("draft");

    const first = await evaluateOne(created.id);
    expect(first).toEqual({ notified: true, items: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(pro.email);
    expect(sent[0].subject).toContain("新着案件 1件");
    expect(sent[0].body).toContain("新着Java案件");
    expect(sent[0].body).toContain("掲載株式会社"); // PRO は掲載企業名を含む
    expect(sent[0].body).not.toContain("新着PHP案件");
    expect(sent[0].body).not.toContain("自社Java案件");
    expect(sent[0].body).not.toContain("非公開Java案件");
    expect(sent[0].body).toContain(`/projects/${javaId}`);

    // 2回目: 新着なし → 通知しない（二重通知防止）
    const second = await evaluateOne(created.id);
    expect(second.notified).toBe(false);
    expect(sent).toHaveLength(1);

    // 既通知の案件を更新しても再通知しない（hits で抑止）
    await prisma.project.update({ where: { id: javaId }, data: { headcount: 2 } });
    const third = await evaluateOne(created.id);
    expect(third.notified).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("人材の通知は匿名情報のみ（氏名・実額単価を含めない）。企業が FREE に戻ると通知しない", async () => {
    const pro = await setPlan(await makeCompany("人材アラートPRO株式会社"), "PRO");
    const other = await makeCompany("供給株式会社");
    const created = await createSavedSearch(pro, { kind: "ENGINEER", name: "Java人材", criteria: { skills: ["Java"], rateMax: 80 } });
    if (!("ok" in created)) throw new Error("create");
    await new Promise((r) => setTimeout(r, 20));
    const e = await createEngineer(other, {
      name: "秘密 太郎",
      ageBand: 30,
      affiliationType: "EMPLOYEE",
      desiredRateYen: 750_000,
      availableFrom: iso(futureDate(10)),
      skills: [{ category: "LANGUAGE", name: "Java", months: 60 }],
    });
    await addConsent(other, e.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
    await publishEngineer(other, e.id);

    const summary = await evaluateSavedSearches({ force: true });
    expect(summary.notified).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("供給株式会社");
    expect(sent[0].body).toContain("70〜80万円");
    expect(sent[0].body).not.toContain("秘密 太郎");
    expect(sent[0].body).not.toContain("750000");
    expect(sent[0].body).not.toContain("750,000");

    // FREE に戻った後の新着は通知しない
    await setPlan(pro, "FREE");
    await new Promise((r) => setTimeout(r, 20));
    const e2 = await createEngineer(other, {
      name: "二人目",
      ageBand: 40,
      affiliationType: "EMPLOYEE",
      desiredRateYen: 700_000,
      skills: [{ category: "LANGUAGE", name: "Java", months: 24 }],
    });
    await addConsent(other, e2.id, { method: "メール", documentVersion: "v1", purposes: ["マッチング"] });
    await publishEngineer(other, e2.id);
    const after = await evaluateSavedSearches({ force: true });
    expect(after.notified).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("DAILY は 9時台（JST）以外では評価されず、force で評価できる", async () => {
    const pro = await setPlan(await makeCompany("日次PRO株式会社"), "PRO");
    const other = await makeCompany("掲載株式会社");
    const created = await createSavedSearch(pro, { kind: "PROJECT", name: "日次", criteria: {}, notify: "DAILY" });
    if (!("ok" in created)) throw new Error("create");
    await new Promise((r) => setTimeout(r, 20));
    await publishProjectOf(other, "日次案件", "Java");
    const noon = new Date();
    noon.setUTCHours(3, 0, 0, 0); // 12:00 JST
    if (noon < new Date()) noon.setUTCDate(noon.getUTCDate() + 1);
    const skipped = await evaluateSavedSearches({ now: noon });
    expect(skipped.skipped).toBe(1);
    expect(sent).toHaveLength(0);
    const forced = await evaluateSavedSearches({ force: true });
    expect(forced.notified).toBe(1);
  });
});
