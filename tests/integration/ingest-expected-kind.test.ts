// 取込の期待種別チェック（案件取込=案件のみ / 人材取込=人材のみ）の統合テスト。
// - 期待種別とLLM分類の不一致はジョブを FAILED にし、誤った側への登録を防ぐ
// - 人材取込では複数案件分割を適用しない（職務経歴の「案件名」繰り返しで裁断しない）
// - 案件取込では従来どおり複数案件を分割する
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { prisma } from "@/server/db";
import { makeCompany, truncateAll } from "./helpers";
import type { AuthContext } from "@/server/auth/session";

// モックLLM（正規表現分類）とテスト専用ストレージを強制してから取込モジュールを読み込む
delete process.env.LLM_BASE_URL;
delete process.env.ANTHROPIC_API_KEY;
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "sesmatch-ingest-test-"));
const ingestModule = import("@/server/pipeline/ingest");

// 取込は非同期実行のため、ジョブが処理完了状態になるまでポーリングする
async function waitForJob(jobId: string) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const job = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: jobId } });
    if (["REVIEW_REQUIRED", "FAILED", "CONFIRMED"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`ジョブが完了しません: ${job.status}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// テナント内の全ジョブが処理完了（分割で増えた分も含む）するまで待つ
async function waitForAllJobs(tenantCompanyId: string) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const jobs = await prisma.ingestionJob.findMany({ where: { tenantCompanyId } });
    if (jobs.every((j) => ["REVIEW_REQUIRED", "FAILED", "CONFIRMED"].includes(j.status))) return jobs;
    if (Date.now() > deadline) throw new Error("ジョブが完了しません");
    await new Promise((r) => setTimeout(r, 100));
  }
}

// モック分類で ENGINEER_SHEET になるスキルシート（職務経歴に案件名・期間の繰り返しを含む）
const ENGINEER_SHEET_TEXT = [
  "スキルシート",
  "氏名: T.K（35歳）",
  "希望単価: 70万",
  "経歴:",
  "【案件名】ECサイト開発",
  "期間：2023/01〜2023/12",
  "業務内容：Java, Spring Boot による開発",
  "【案件名】物流システム保守",
  "期間：2024/01〜2024/12",
  "業務内容：PostgreSQL の運用・保守",
].join("\n");

// モック分類で PROJECT_DESCRIPTION になる案件票（2案件を含む）
const TWO_PROJECTS_TEXT = [
  "ご紹介案件です。",
  "【案件名】銀行系システム更改",
  "単価：80万",
  "面談：1回",
  "商流：エンド直",
  "【案件名】ECサイトリニューアル募集",
  "単価：75万",
  "面談：2回",
  "商流：元請直",
].join("\n");

let startIngestion: typeof import("@/server/pipeline/ingest").startIngestion;

function ingest(auth: AuthContext, text: string, expectedKind?: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION") {
  return startIngestion({
    tenantCompanyId: auth.companyId,
    memberId: auth.memberId,
    actorUserId: auth.userAccountId,
    filename: "取込テスト.txt",
    mimeType: "text/plain",
    content: Buffer.from(text, "utf-8"),
    expectedKind,
  });
}

beforeAll(async () => {
  startIngestion = (await ingestModule).startIngestion;
  await truncateAll();
});

describe("取込の期待種別チェック", () => {
  it("人材取込にスキルシート: 種別一致で人手確認待ちになり、案件分割は適用されない", async () => {
    const auth = await makeCompany("種別テストA社");
    await ingest(auth, ENGINEER_SHEET_TEXT, "ENGINEER_SHEET");
    const jobs = await waitForAllJobs(auth.companyId);
    // 「案件名」繰り返しがあっても人材取込では分割されず1ジョブのまま
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("REVIEW_REQUIRED");
    const doc = await prisma.sourceDocument.findUniqueOrThrow({
      where: { id: jobs[0].sourceDocumentId },
    });
    expect(doc.kind).toBe("ENGINEER_SHEET");
  });

  it("案件取込にスキルシート: 種別不一致で FAILED になり登録されない", async () => {
    const auth = await makeCompany("種別テストB社");
    const job = await ingest(auth, ENGINEER_SHEET_TEXT, "PROJECT_DESCRIPTION");
    const done = await waitForJob(job.id);
    expect(done.status).toBe("FAILED");
    expect(done.error).toContain("KIND_MISMATCH");
    // 種別は確定されず、確認待ちにも現れない
    const doc = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: job.sourceDocumentId } });
    expect(doc.kind).toBe("UNKNOWN");
    // 経歴の「案件名」繰り返しで分割され、断片が案件として登録されることもない
    const jobs = await prisma.ingestionJob.findMany({ where: { tenantCompanyId: auth.companyId } });
    expect(jobs).toHaveLength(1);
  });

  it("人材取込に案件票: 種別不一致で FAILED になる", async () => {
    const auth = await makeCompany("種別テストC社");
    const job = await ingest(auth, TWO_PROJECTS_TEXT, "ENGINEER_SHEET");
    const done = await waitForJob(job.id);
    expect(done.status).toBe("FAILED");
    expect(done.error).toContain("KIND_MISMATCH");
  });

  it("案件取込に複数案件: 従来どおり案件ごとに分割され、全件が期待種別チェックを通る", async () => {
    const auth = await makeCompany("種別テストD社");
    await ingest(auth, TWO_PROJECTS_TEXT, "PROJECT_DESCRIPTION");
    const jobs = await waitForAllJobs(auth.companyId);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.status === "REVIEW_REQUIRED")).toBe(true);
    expect(jobs.every((j) => j.expectedKind === "PROJECT_DESCRIPTION")).toBe(true);
  });

  it("期待種別なし（API直叩き等）: 自動判定で取り込まれ、スキルシートは分割されない", async () => {
    const auth = await makeCompany("種別テストE社");
    const job = await ingest(auth, ENGINEER_SHEET_TEXT);
    const done = await waitForJob(job.id);
    expect(done.status).toBe("REVIEW_REQUIRED");
    const doc = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: job.sourceDocumentId } });
    expect(doc.kind).toBe("ENGINEER_SHEET");
    // 文書全体がスキルシートと判定されるため、「案件名」繰り返しでも分割されない
    const jobs = await prisma.ingestionJob.findMany({ where: { tenantCompanyId: auth.companyId } });
    expect(jobs).toHaveLength(1);
  });
});
