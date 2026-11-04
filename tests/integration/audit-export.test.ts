// 監査ログのエクスポート（PRO版仕様書 §4.14, §13）の統合テスト。専用DB sesmatch_test
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { addMemberWithRoles, makeCompany, setPlan, truncateAll } from "./helpers";
import { audit } from "@/server/audit";
import { createSession } from "@/server/auth/session";
import { exportAuditEvents, monthlyExportToken, sendMonthlyAuditExportLinks } from "@/server/services/audit-export";
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

describe("監査ログのエクスポート", () => {
  it("自社分のみ CSV/JSON で出力し、出力自体を監査に記録する。基本版は PLAN_REQUIRED", async () => {
    const free = await makeCompany("監査株式会社");
    const other = await makeCompany("他社");
    await audit({ tenantCompanyId: free.companyId, actorUserId: free.userAccountId, action: "ProjectCreated", targetType: "Project", targetId: "p1" });
    await audit({ tenantCompanyId: other.companyId, action: "ProjectCreated", targetType: "Project", targetId: "p-other" });
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    expect(await exportAuditEvents(free, { ...range, format: "csv" })).toMatchObject({ error: { code: "PLAN_REQUIRED" } });

    const pro = await setPlan(free, "PRO");
    const csv = await exportAuditEvents(pro, { ...range, format: "csv" });
    if ("error" in csv) throw new Error("export failed");
    expect(csv.count).toBe(1);
    expect(csv.body).toContain("案件を作成");
    expect(csv.body).not.toContain("p-other");
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    const jsonOut = await exportAuditEvents(pro, { ...range, format: "json" });
    if ("error" in jsonOut) throw new Error("export failed");
    const parsed = JSON.parse(jsonOut.body);
    // 2回目は1回目のエクスポート記録も含まれる
    expect(parsed.items.map((i: { action: string }) => i.action)).toEqual(["ProjectCreated", "AuditLogExported"]);
    expect(await prisma.auditEvent.count({ where: { tenantCompanyId: pro.companyId, action: "AuditLogExported" } })).toBe(2);
    // 期間の検証
    expect(await exportAuditEvents(pro, { from: range.to, to: range.from, format: "csv" })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("API は audit.read 権限と PRO が必要。月次リンクはトークン検証付き", async () => {
    const owner = await setPlan(await makeCompany("監査株式会社"), "PRO");
    const sales = await addMemberWithRoles(owner, ["SALES"]);
    const cookie = async (a: { userAccountId: string }) => ({ Cookie: `sesmatch_session=${(await createSession(a.userAccountId)).token}` });
    const today = new Date().toISOString().slice(0, 10);
    const ok = await app.request(`/api/v1/audit/export?from=${today}&to=${today}&format=csv`, { headers: await cookie(owner) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Disposition")).toContain("audit_");
    expect((await app.request(`/api/v1/audit/export?from=${today}&to=${today}`, { headers: await cookie(sales) })).status).toBe(403);
    expect((await app.request(`/api/v1/audit/export?from=bad&to=${today}`, { headers: await cookie(owner) })).status).toBe(400);
    // 月次リンク
    const token = monthlyExportToken(owner.companyId, "2026-10");
    expect((await app.request(`/api/v1/audit/export?month=2026-10&token=${encodeURIComponent(token)}`, { headers: await cookie(owner) })).status).toBe(200);
    expect((await app.request(`/api/v1/audit/export?month=2026-10&token=bad`, { headers: await cookie(owner) })).status).toBe(403);
    // 他社のトークンでは取れない
    const other = await setPlan(await makeCompany("他社"), "PRO");
    expect((await app.request(`/api/v1/audit/export?month=2026-10&token=${encodeURIComponent(token)}`, { headers: await cookie(other) })).status).toBe(403);
  });

  it("月次送付は PRO 企業の代表へ1回だけ送る", async () => {
    const pro = await setPlan(await makeCompany("PRO株式会社"), "PRO");
    await makeCompany("基本版株式会社");
    const first = await sendMonthlyAuditExportLinks(new Date("2026-11-30T15:30:00Z")); // 12/1 0:30 JST → 2026-11 分
    expect(first).toMatchObject({ month: "2026-11", sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(pro.email);
    expect(sent[0].body).toContain("/audit?month=2026-11&token=");
    const second = await sendMonthlyAuditExportLinks(new Date("2026-12-01T03:00:00Z"));
    expect(second).toMatchObject({ month: "2026-11", sent: 0, skipped: 1 });
    expect(sent).toHaveLength(1);
  });
});
