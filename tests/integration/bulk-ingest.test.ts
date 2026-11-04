// 一括取込と人材書類の複数件分割（PRO版仕様書 §4.2, §13）の統合テスト。専用DB sesmatch_test に対して実行する。
// - 基本版は POST /ingestions/bulk を 403 PLAN_REQUIRED で拒否する
// - PRO はファイルごとに自テナントの取込ジョブが作られ、同じ batchId を持つ。21ファイル以上は拒否
// - PRO の人材取込では複数名の書類が人材ごとに分割され、基本版では分割されない
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { prisma } from "@/server/db";
import { makeCompany, setPlan, truncateAll } from "./helpers";
import { issueApiToken } from "@/server/auth/api-token";
import type { AuthContext } from "@/server/auth/session";

// モックLLM（正規表現分類・「氏名」行で人数判定）とテスト専用ストレージを強制してから読み込む
delete process.env.LLM_BASE_URL;
delete process.env.ANTHROPIC_API_KEY;
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "sesmatch-bulk-test-"));
const appModule = import("@/server/api/app");
const ingestModule = import("@/server/pipeline/ingest");

async function waitForAllJobs(tenantCompanyId: string) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const jobs = await prisma.ingestionJob.findMany({ where: { tenantCompanyId }, include: { sourceDocument: true } });
    if (jobs.length > 0 && jobs.every((j) => ["REVIEW_REQUIRED", "FAILED", "CONFIRMED"].includes(j.status)))
      return jobs;
    if (Date.now() > deadline) throw new Error("ジョブが完了しません");
    await new Promise((r) => setTimeout(r, 100));
  }
}

const TWO_ENGINEERS_TEXT = [
  "技術者ご紹介（スキルシート）",
  "氏名: A.B（30代）",
  "希望単価: 70万",
  "経歴:",
  "【案件名】ECサイト開発",
  "業務内容：Java, Spring Boot による開発",
  "氏名: C.D（40代）",
  "希望単価: 80万",
  "経歴:",
  "【案件名】物流システム保守",
  "業務内容：PostgreSQL の運用・保守",
].join("\n");

async function bearerFor(auth: AuthContext) {
  const issued = await issueApiToken(auth, { name: "bulk", scope: "ingest", expiresInDays: null });
  if ("error" in issued) throw new Error("トークン発行に失敗");
  return `Bearer ${issued.token}`;
}

function bulkForm(names: string[], expectedKind: string, text = "【案件名】テスト案件\n単価：80万\n面談：1回") {
  const form = new FormData();
  for (const n of names) form.append("file", new File([text], n, { type: "text/plain" }));
  form.append("expectedKind", expectedKind);
  return form;
}

describe("一括取込（§4.2）", () => {
  let free: AuthContext;
  let pro: AuthContext;
  beforeEach(async () => {
    await truncateAll();
    free = await makeCompany("一括基本版株式会社");
    pro = await setPlan(await makeCompany("一括PRO株式会社"), "PRO");
  });

  it("基本版は 403 PLAN_REQUIRED", async () => {
    const { app } = await appModule;
    const res = await app.request("/api/v1/ingestions/bulk", {
      method: "POST",
      headers: { Authorization: await bearerFor(free) },
      body: bulkForm(["a.txt", "b.txt"], "PROJECT_DESCRIPTION"),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PLAN_REQUIRED");
    expect(await prisma.ingestionJob.count({ where: { tenantCompanyId: free.companyId } })).toBe(0);
  });

  it("PRO はファイルごとに自テナントのジョブが作られ、同じ batchId を持つ", async () => {
    const { app } = await appModule;
    await ingestModule;
    const res = await app.request("/api/v1/ingestions/bulk", {
      method: "POST",
      headers: { Authorization: await bearerFor(pro) },
      body: bulkForm(["a.txt", "b.txt", "c.txt"], "PROJECT_DESCRIPTION"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { batchId: string; jobs: { id: string }[] };
    expect(body.jobs).toHaveLength(3);
    const jobs = await waitForAllJobs(pro.companyId);
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.batchId === body.batchId)).toBe(true);
    expect(jobs.every((j) => j.tenantCompanyId === pro.companyId)).toBe(true);
    expect(jobs.every((j) => j.status === "REVIEW_REQUIRED")).toBe(true);
    // 他テナントには混入しない
    expect(await prisma.ingestionJob.count({ where: { tenantCompanyId: free.companyId } })).toBe(0);
  });

  it("21ファイル以上は拒否する", async () => {
    const { app } = await appModule;
    const res = await app.request("/api/v1/ingestions/bulk", {
      method: "POST",
      headers: { Authorization: await bearerFor(pro) },
      body: bulkForm(Array.from({ length: 21 }, (_, i) => `f${i}.txt`), "PROJECT_DESCRIPTION"),
    });
    expect(res.status).toBe(400);
    expect(await prisma.ingestionJob.count({ where: { tenantCompanyId: pro.companyId } })).toBe(0);
  });
});

describe("人材書類の複数件分割（§4.2）", () => {
  it("PRO の人材取込では2名の書類が人材ごとに分割され、基本版では1件のまま", async () => {
    await truncateAll();
    const { startIngestion } = await ingestModule;
    const free = await makeCompany("分割基本版株式会社");
    const pro = await setPlan(await makeCompany("分割PRO株式会社"), "PRO");

    await startIngestion({
      tenantCompanyId: pro.companyId,
      memberId: pro.memberId,
      actorUserId: pro.userAccountId,
      filename: "two.txt",
      mimeType: "text/plain",
      content: Buffer.from(TWO_ENGINEERS_TEXT, "utf-8"),
      expectedKind: "ENGINEER_SHEET",
      splitEngineers: true,
    });
    const proJobs = await waitForAllJobs(pro.companyId);
    expect(proJobs).toHaveLength(2);
    expect(proJobs.map((j) => j.sourceDocument.filename).sort()).toEqual(["two（1/2）.txt", "two（2/2）.txt"]);
    expect(proJobs.every((j) => j.status === "REVIEW_REQUIRED")).toBe(true);
    const extractions = await prisma.extractionResult.findMany({
      where: { ingestionJobId: { in: proJobs.map((j) => j.id) } },
    });
    const texts = extractions.map((e) => e.maskedText);
    expect(texts.some((t) => t.includes("A.B") && !t.includes("C.D"))).toBe(true);
    expect(texts.some((t) => t.includes("C.D") && !t.includes("A.B"))).toBe(true);

    await startIngestion({
      tenantCompanyId: free.companyId,
      memberId: free.memberId,
      actorUserId: free.userAccountId,
      filename: "two.txt",
      mimeType: "text/plain",
      content: Buffer.from(TWO_ENGINEERS_TEXT, "utf-8"),
      expectedKind: "ENGINEER_SHEET",
      splitEngineers: false,
    });
    const freeJobs = await waitForAllJobs(free.companyId);
    expect(freeJobs).toHaveLength(1);
    expect(freeJobs[0].sourceDocument.filename).toBe("two.txt");
  });
});
