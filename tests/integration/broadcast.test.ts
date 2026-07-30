// 運営コンソール: メール配信（営業PR・お知らせ）の統合テスト
// テスト環境は MAIL_FROM 未設定のため sendMail はモック動作（ログのみ）になる
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  importCompanies,
  listAllMembersByOperations,
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
