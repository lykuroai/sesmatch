// 運営コンソール: 企業リスト一括取込・企業修正・担当者管理の統合テスト
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  deleteMemberByOperations,
  importCompanies,
  listCompanyMembersByOperations,
  reinviteMemberByOperations,
  updateCompanyByOperations,
  updateMemberByOperations,
} from "@/server/services/companies";
import type { CompanyImportRow } from "@/server/services/companies";
import { verifyPassword } from "@/server/auth/password";
import { truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

// 統一パスワードのバリデーションエラー以外を扱うテスト用ヘルパー
async function doImport(rows: CompanyImportRow[], password?: string) {
  const r = await importCompanies(rows, password);
  if ("error" in r) throw new Error(`import failed: ${r.error?.message}`);
  return r;
}

describe("importCompanies", () => {
  it("企業を ACTIVE で開通し、全員に統一初期パスワードを設定する", async () => {
    const r = await doImport(
      [
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
      ],
      "unified-pass-123"
    );
    expect(r.created).toBe(2);
    expect(r.initialPassword).toBe("unified-pass-123");
    expect(r.results.every((x) => x.ok)).toBe(true);

    const company = await prisma.company.findFirst({ where: { name: "取込A社" } });
    expect(company?.status).toBe("ACTIVE");
    const owner = await prisma.companyMember.findFirst({
      where: { companyId: company!.id },
      include: { roles: true, userAccount: true },
    });
    expect(owner?.roles.map((x) => x.role).sort()).toEqual(["ADMIN", "OWNER"]);
    expect(owner?.userAccount.email).toBe("import-a@test.example");
    // 全員が同じ統一初期パスワードでログイン可能
    const accounts = await prisma.userAccount.findMany({
      where: { email: { in: ["import-a@test.example", "import-b@test.example"] } },
    });
    for (const a of accounts) {
      expect(await verifyPassword("unified-pass-123", a.passwordHash)).toBe(true);
    }
  });

  it("統一パスワード未指定なら自動生成して返す", async () => {
    const r = await doImport([
      {
        companyName: "自動生成社",
        companyType: "CORPORATION",
        ownerName: "三郎",
        email: "auto-gen@test.example",
      },
    ]);
    expect(r.initialPassword.length).toBeGreaterThanOrEqual(8);
    const account = await prisma.userAccount.findUniqueOrThrow({
      where: { email: "auto-gen@test.example" },
    });
    expect(await verifyPassword(r.initialPassword, account.passwordHash)).toBe(true);
  });

  it("8文字未満の統一パスワードは拒否する", async () => {
    const r = await importCompanies(
      [
        {
          companyName: "拒否社",
          companyType: "CORPORATION",
          ownerName: "誰か",
          email: "reject@test.example",
        },
      ],
      "short"
    );
    expect("error" in r && r.error?.code).toBe("VALIDATION_ERROR");
    expect(await prisma.company.count()).toBe(0);
  });

  it("不正行はスキップし、正常行だけ登録する", async () => {
    const r = await doImport([
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
    const r = await doImport([
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
    const r = await doImport([
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

  it("登録済み・重複メールの行はエラーにせずスキップする", async () => {
    const first = await doImport([
      {
        companyName: "先行社",
        companyType: "SOLE_PROPRIETOR",
        ownerName: "先行",
        email: "dup@test.example",
      },
    ]);
    expect(first.created).toBe(1);
    const r = await doImport([
      {
        companyName: "重複社",
        companyType: "SOLE_PROPRIETOR",
        ownerName: "重複",
        email: "dup@test.example",
      },
    ]);
    expect(r.created).toBe(0);
    expect(r.results[0].ok).toBe(true); // エラーではなくスキップ
    expect(r.results[0].skipped).toBe(true);
    expect(await prisma.company.count()).toBe(1);
  });

  it("同じリストを再取込しても全行スキップで正常終了する（冪等）", async () => {
    const list: CompanyImportRow[] = [
      {
        companyName: "再取込社",
        companyType: "CORPORATION",
        ownerName: "一郎",
        email: "reimport-1@test.example",
      },
      {
        companyName: "再取込社",
        companyType: "CORPORATION",
        ownerName: "二郎",
        email: "reimport-2@test.example",
      },
    ];
    const first = await doImport(list);
    expect(first.created).toBe(1);
    const second = await doImport(list);
    expect(second.created).toBe(0);
    expect(second.results.every((x) => x.ok && x.skipped)).toBe(true);
    expect(await prisma.company.count({ where: { name: "再取込社" } })).toBe(1);
    expect(await prisma.userAccount.count({ where: { email: { startsWith: "reimport-" } } })).toBe(2);
  });
});

describe("updateCompanyByOperations", () => {
  it("名称・種別・法人番号を修正できる（ハイフン等は除去して保存）", async () => {
    await doImport([
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
    await doImport([
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
    expect("error" in bad && bad.error?.code).toBe("VALIDATION_ERROR");

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
    expect("error" in r && r.error?.code).toBe("NOT_FOUND");
  });
});

describe("運営の担当者管理", () => {
  it("オーナーであっても修正・再招待・削除ができる", async () => {
    await doImport([
      {
        companyName: "運営管理社",
        companyType: "CORPORATION",
        ownerName: "取込 太郎",
        email: "ops-member@test.example",
      },
    ]);
    const company = await prisma.company.findFirstOrThrow({ where: { name: "運営管理社" } });
    const list = await listCompanyMembersByOperations(company.id);
    if ("error" in list) throw new Error("list failed");
    expect(list.items).toHaveLength(1);
    const member = list.items[0];
    expect(member.roles.sort()).toEqual(["ADMIN", "OWNER"]);
    expect(member.passwordIssued).toBe(true); // 取込時に統一パスワード設定済み

    // 修正（オーナーでも可）
    const up = await updateMemberByOperations(member.id, {
      name: "修正 次郎",
      email: "ops-member-new@test.example",
    });
    expect(up).toEqual({ ok: true });

    // 再招待（個別パスワード再発行）
    const re = await reinviteMemberByOperations(member.id);
    if ("error" in re) throw new Error("reinvite failed");
    const account = await prisma.userAccount.findUniqueOrThrow({
      where: { email: "ops-member-new@test.example" },
    });
    expect(await verifyPassword(re.initialPassword, account.passwordHash)).toBe(true);

    // 削除（オーナーでも可、アカウントごと消える）
    const del = await deleteMemberByOperations(member.id);
    expect(del).toEqual({ ok: true });
    expect(await prisma.companyMember.findUnique({ where: { id: member.id } })).toBeNull();
    expect(
      await prisma.userAccount.findUnique({ where: { email: "ops-member-new@test.example" } })
    ).toBeNull();
  });

  it("重複メールへの修正は拒否する", async () => {
    await doImport([
      {
        companyName: "重複修正社",
        companyType: "CORPORATION",
        ownerName: "甲",
        email: "dup-a@test.example",
      },
      {
        companyName: "重複修正社",
        companyType: "CORPORATION",
        ownerName: "乙",
        email: "dup-b@test.example",
      },
    ]);
    const company = await prisma.company.findFirstOrThrow({ where: { name: "重複修正社" } });
    const list = await listCompanyMembersByOperations(company.id);
    if ("error" in list) throw new Error("list failed");
    const r = await updateMemberByOperations(list.items[1].id, {
      name: "乙",
      email: "dup-a@test.example",
    });
    expect("error" in r && r.error?.code).toBe("DUPLICATE_ENTRY");
  });

  it("存在しない担当者・企業は 404", async () => {
    expect("error" in (await updateMemberByOperations("nope", { name: "x", email: "x@y.example" }))).toBe(true);
    expect("error" in (await deleteMemberByOperations("nope"))).toBe(true);
    expect("error" in (await reinviteMemberByOperations("nope"))).toBe(true);
    expect("error" in (await listCompanyMembersByOperations("nope"))).toBe(true);
  });
});
