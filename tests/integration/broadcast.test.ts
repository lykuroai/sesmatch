// 運営コンソール: メール配信（営業PR・お知らせ）の統合テスト
// テスト環境は MAIL_FROM 未設定のため sendMail はモック動作（ログのみ）になる
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  deleteProspect,
  importCompanies,
  importProspects,
  listAllMembersByOperations,
  listProspects,
  sendBroadcastMailByOperations,
} from "@/server/services/companies";
import { truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

async function seedMembers() {
  const r = await importCompanies([
    {
      companyName: "配信A社",
      companyType: "CORPORATION",
      ownerName: "甲",
      email: "cast-a@test.example",
    },
    {
      companyName: "配信B社",
      companyType: "CORPORATION",
      ownerName: "乙",
      email: "cast-b@test.example",
    },
  ]);
  if ("error" in r) throw new Error("seed failed");
  const list = await listAllMembersByOperations();
  return list.items;
}

describe("sendBroadcastMailByOperations", () => {
  it("選択した担当者に配信し、監査ログには件名・件数のみ記録する", async () => {
    const members = await seedMembers();
    expect(members).toHaveLength(2);
    const r = await sendBroadcastMailByOperations({
      memberIds: members.map((m) => m.id),
      subject: "お知らせテスト",
      body: "テスト本文",
    });
    if ("error" in r) throw new Error("broadcast failed");
    expect(r.sent).toBe(2);
    expect(r.notFound).toBe(0);

    const event = await prisma.auditEvent.findFirst({
      where: { action: "OperationsBroadcastMailSent" },
    });
    expect(event).not.toBeNull();
    const meta = event!.metadata as { subject: string; sent: number };
    expect(meta.subject).toBe("お知らせテスト");
    expect(meta.sent).toBe(2);
    // 監査ログに宛先PII（メールアドレス）を含めない
    expect(JSON.stringify(event!.metadata)).not.toContain("@test.example");
  });

  it("存在しない宛先IDは notFound として数え、実在分のみ配信する", async () => {
    const members = await seedMembers();
    const r = await sendBroadcastMailByOperations({
      memberIds: [members[0].id, "nope-1", "nope-2"],
      subject: "件名",
      body: "本文",
    });
    if ("error" in r) throw new Error("broadcast failed");
    expect(r.sent).toBe(1);
    expect(r.notFound).toBe(2);
  });

  it("宛先が空・全員不在ならエラー", async () => {
    const empty = await sendBroadcastMailByOperations({
      memberIds: [],
      subject: "件名",
      body: "本文",
    });
    expect("error" in empty && empty.error?.code).toBe("VALIDATION_ERROR");
    const none = await sendBroadcastMailByOperations({
      memberIds: ["nope"],
      subject: "件名",
      body: "本文",
    });
    expect("error" in none && none.error?.code).toBe("NOT_FOUND");
  });

  it("宛先一覧に企業名・企業状態が含まれる", async () => {
    await seedMembers();
    const list = await listAllMembersByOperations();
    const a = list.items.find((m) => m.email === "cast-a@test.example");
    expect(a?.companyName).toBe("配信A社");
    expect(a?.companyStatus).toBe("APPLIED");
  });
});

describe("importProspects / 販促先への配信", () => {
  const rows = [
    {
      companyName: "見込みA社",
      companyType: "CORPORATION" as const,
      ownerName: "販促 太郎",
      email: "lead-a@test.example",
    },
    {
      companyName: "見込みB社",
      companyType: "CORPORATION" as const,
      ownerName: "販促 花子",
      email: "lead-b@test.example",
    },
  ];

  it("企業CSVと同じ形式の行を販促先として登録し、再取込はスキップする（冪等）", async () => {
    const r = await importProspects(rows);
    expect(r.created).toBe(2);
    expect(r.results.every((x) => x.ok)).toBe(true);
    // テナント（企業・アカウント）は作られない
    expect(await prisma.company.count()).toBe(0);
    expect(await prisma.userAccount.count()).toBe(0);

    const again = await importProspects(rows);
    expect(again.created).toBe(0);
    expect(again.results.every((x) => x.ok && x.skipped)).toBe(true);
    expect((await listProspects()).items).toHaveLength(2);
  });

  it("メール形式不正の行は失敗として返し、正常行のみ登録する", async () => {
    const r = await importProspects([
      rows[0],
      { companyName: "不正社", companyType: "CORPORATION", ownerName: "誰か", email: "bad" },
    ]);
    expect(r.created).toBe(1);
    expect(r.results.map((x) => x.ok)).toEqual([true, false]);
  });

  it("担当者と販促先を混在で配信でき、同一メールへは1通のみ", async () => {
    const members = await seedMembers();
    await importProspects([
      rows[0],
      // 既存担当者と同じメールアドレスの販促先（重複配信されないこと）
      {
        companyName: "重複社",
        companyType: "CORPORATION",
        ownerName: "甲",
        email: "cast-a@test.example",
      },
    ]);
    const prospects = (await listProspects()).items;
    const r = await sendBroadcastMailByOperations({
      memberIds: members.map((m) => m.id),
      prospectIds: prospects.map((p) => p.id),
      subject: "混在配信",
      body: "本文",
    });
    if ("error" in r) throw new Error("broadcast failed");
    // 担当者2 + 販促先2 のうち、メール重複1件を除いた3通
    expect(r.sent).toBe(3);
  });

  it("販促先を削除できる", async () => {
    await importProspects([rows[0]]);
    const [p] = (await listProspects()).items;
    expect(await deleteProspect(p.id)).toEqual({ ok: true });
    expect((await listProspects()).items).toHaveLength(0);
    expect("error" in (await deleteProspect("nope"))).toBe(true);
  });
});
