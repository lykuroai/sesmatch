// 運営コンソール: 企業リスト一括取込の統合テスト
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { importCompanies } from "@/server/services/companies";
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
    expect(owner?.roles.map((x) => x.role)).toEqual(["OWNER"]);
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
