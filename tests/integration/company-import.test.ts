// 運営コンソール: 企業リスト一括取込の統合テスト
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { importCompanies, updateCompanyByOperations } from "@/server/services/companies";
import { truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

describe("importCompanies", () => {
  it("企業を ACTIVE で開通し、オーナーアカウントを作成する", async () => {
    const r = await importCompanies([
      {
        companyName: "取込A社",
        companyType: "CORPORATION",
        corporateNumber: "1234567890123",
        ownerName: "山田 太郎",
        email: "import-a@test.example",
      },
      {
        companyName: "取込B（個人）",
        companyType: "SOLE_PROPRIETOR",
        ownerName: "佐藤 花子",
        email: "import-b@test.example",
      },
    ]);
    expect(r.created).toBe(2);
    expect(r.results.every((x) => x.ok)).toBe(true);

    const company = await prisma.company.findFirst({ where: { name: "取込A社" } });
    expect(company?.status).toBe("ACTIVE");
    const owner = await prisma.companyMember.findFirst({
      where: { companyId: company!.id },
      include: { roles: true, userAccount: true },
    });
    expect(owner?.roles.map((x) => x.role).sort()).toEqual(["ADMIN", "OWNER"]);
    expect(owner?.userAccount.email).toBe("import-a@test.example");
  });

  it("不正行はスキップし、正常行だけ登録する", async () => {
    const r = await importCompanies([
      {
        // 法人番号が不正（12桁）
        companyName: "不正法人",
        companyType: "CORPORATION",
        corporateNumber: "123456789012",
        ownerName: "誰か",
        email: "bad-corp@test.example",
      },
      {
        // メール形式不正
        companyName: "メール不正社",
        companyType: "SOLE_PROPRIETOR",
        ownerName: "誰か",
        email: "not-an-email",
      },
      {
        companyName: "正常社",
        companyType: "CORPORATION",
        corporateNumber: "9999999999999",
        ownerName: "正常 太郎",
        email: "ok@test.example",
      },
    ]);
    expect(r.created).toBe(1);
    expect(r.results.map((x) => x.ok)).toEqual([false, false, true]);
    expect(await prisma.company.count()).toBe(1);
  });

  it("法人番号なしの不完全データ（3列形式相当）を取り込める", async () => {
    const r = await importCompanies([
      {
        companyName: "ラーニンギフト株式会社",
        companyType: "CORPORATION",
        ownerName: "B.K",
        email: "request04@learningift.example",
      },
    ]);
    expect(r.created).toBe(1);
    const company = await prisma.company.findFirst({ where: { name: "ラーニンギフト株式会社" } });
    expect(company?.status).toBe("ACTIVE");
    expect(company?.corporateNumber).toBeNull();
  });

  it("同名企業の2人目以降は新規作成せず既存企業へ追加する（全員オーナー・管理者権限）", async () => {
    const r = await importCompanies([
      {
        companyName: "株式会社キャリアビート",
        companyType: "CORPORATION",
        ownerName: "一戸美羽",
        email: "miu.ichinohe@careerbeat.example",
      },
      {
        companyName: "株式会社キャリアビート",
        companyType: "CORPORATION",
        ownerName: "亀山 蓮",
        email: "ren.kameyama@careerbeat.example",
      },
    ]);
    expect(r.created).toBe(1); // 新規企業は1社のみ
    expect(r.results.map((x) => x.ok)).toEqual([true, true]);
    expect(r.results[1].message).toContain("既存企業に担当者を追加");

    expect(await prisma.company.count({ where: { name: "株式会社キャリアビート" } })).toBe(1);
    const company = await prisma.company.findFirstOrThrow({
      where: { name: "株式会社キャリアビート" },
    });
    const members = await prisma.companyMember.findMany({
      where: { companyId: company.id },
      include: { roles: true, userAccount: true },
      orderBy: { createdAt: "asc" },
    });
    expect(members).toHaveLength(2);
    expect(members[0].roles.map((x) => x.role).sort()).toEqual(["ADMIN", "OWNER"]);
    expect(members[1].roles.map((x) => x.role).sort()).toEqual(["ADMIN", "OWNER"]);
    expect(members[1].userAccount.name).toBe("亀山 蓮");
  });

  it("登録済み・重複メールの行はエラーとして報告する", async () => {
    const first = await importCompanies([
      {
        companyName: "先行社",
        companyType: "SOLE_PROPRIETOR",
        ownerName: "先行",
        email: "dup@test.example",
      },
    ]);
    expect(first.created).toBe(1);
    const r = await importCompanies([
      {
        companyName: "重複社",
        companyType: "SOLE_PROPRIETOR",
        ownerName: "重複",
        email: "dup@test.example",
      },
    ]);
    expect(r.created).toBe(0);
    expect(r.results[0].ok).toBe(false);
    expect(await prisma.company.count()).toBe(1);
  });
});

describe("updateCompanyByOperations", () => {
  it("名称・種別・法人番号を修正できる（ハイフン等は除去して保存）", async () => {
    await importCompanies([
      {
        companyName: "修正前社",
        companyType: "CORPORATION",
        ownerName: "誰か",
        email: "fix-target@test.example",
      },
    ]);
    const company = await prisma.company.findFirstOrThrow({ where: { name: "修正前社" } });
    const r = await updateCompanyByOperations(company.id, {
      name: "修正後株式会社",
      companyType: "CORPORATION",
      corporateNumber: "1234-5678-90123",
    });
    expect(r).toEqual({ ok: true });
    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after.name).toBe("修正後株式会社");
    expect(after.corporateNumber).toBe("1234567890123");
  });

  it("法人番号が13桁でなければ拒否し、空なら未登録に戻せる", async () => {
    await importCompanies([
      {
        companyName: "検証社",
        companyType: "CORPORATION",
        corporateNumber: "1234567890123",
        ownerName: "誰か",
        email: "fix-target2@test.example",
      },
    ]);
    const company = await prisma.company.findFirstOrThrow({ where: { name: "検証社" } });
    const bad = await updateCompanyByOperations(company.id, {
      name: "検証社",
      companyType: "CORPORATION",
      corporateNumber: "123",
    });
    expect("error" in bad && bad.error.code).toBe("VALIDATION_ERROR");

    const clear = await updateCompanyByOperations(company.id, {
      name: "検証社",
      companyType: "SOLE_PROPRIETOR",
      corporateNumber: "",
    });
    expect(clear).toEqual({ ok: true });
    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after.corporateNumber).toBeNull();
    expect(after.companyType).toBe("SOLE_PROPRIETOR");
  });

  it("存在しない企業は 404", async () => {
    const r = await updateCompanyByOperations("does-not-exist", {
      name: "x",
      companyType: "CORPORATION",
    });
    expect("error" in r && r.error.code).toBe("NOT_FOUND");
  });
});
