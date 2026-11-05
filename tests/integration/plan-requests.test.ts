// PRO 版の申込・解約申請（2026-11-05 郭指示）の統合テスト。専用DB sesmatch_test に対して実行する。
// - 申込だけではプランは変わらない。運営の承認で PRO 開始（請求書払い・月払い・無期限）
// - 解約申請の承認は当月末（JST）を期限に設定し、期限までは PRO のまま
// - 受付は 2026-12-04（JST）から。重複申請は不可。取り下げは自社の申請中のものだけ（他社は 404）
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getOwnPlan } from "@/server/services/companies";
import {
  approvePlanRequest,
  createPlanRequest,
  createPlanRequestInternal,
  listOwnPlanRequests,
  listPlanRequestsByOperations,
  rejectPlanRequest,
  withdrawPlanRequest,
} from "@/server/services/plan-requests";
import { makeCompany, setPlan, truncateAll } from "./helpers";

const OPEN = new Date("2026-12-10T01:00:00Z"); // 受付開始後（12/10 10:00 JST）
const BEFORE = new Date("2026-12-03T14:00:00Z"); // 12/3 23:00 JST（受付前）

beforeEach(async () => {
  await truncateAll();
});

describe("PRO 版の申込", () => {
  it("受付開始前は拒否し、開始後は申請中として登録される（プランは変わらない）", async () => {
    const owner = await makeCompany("申込株式会社");
    const early = await createPlanRequest(owner, { kind: "UPGRADE" }, BEFORE);
    expect("error" in early && early.error.code).toBe("VALIDATION_ERROR");

    const r = await createPlanRequest(owner, { kind: "UPGRADE", note: "よろしくお願いします" }, OPEN);
    if ("error" in r) throw new Error(r.error.message);
    const own = await listOwnPlanRequests(owner);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ kind: "UPGRADE", status: "PENDING", source: "CONSOLE", note: "よろしくお願いします" });
    expect((await getOwnPlan(owner)).effectivePlan).toBe("FREE");

    // 申請中は重複不可
    const dup = await createPlanRequest(owner, { kind: "UPGRADE" }, OPEN);
    expect("error" in dup && dup.error.code).toBe("DUPLICATE_ENTRY");
  });

  it("承認すると PRO（請求書払い・月払い・無期限）になり、運営一覧に企業名が付く", async () => {
    const owner = await makeCompany("承認株式会社");
    const r = await createPlanRequest(owner, { kind: "UPGRADE" }, OPEN);
    if ("error" in r) throw new Error(r.error.message);
    const ops = await listPlanRequestsByOperations("PENDING");
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ companyName: "承認株式会社", companyPlan: "FREE", kind: "UPGRADE" });

    const ok = await approvePlanRequest(r.id, null, OPEN);
    if ("error" in ok) throw new Error(ok.error.message);
    const plan = await getOwnPlan(owner);
    expect(plan).toMatchObject({ plan: "PRO", effectivePlan: "PRO", planExpiresAt: null, paymentMethod: "INVOICE", planBillingCycle: "MONTHLY" });
    expect(plan.planStartedAt).not.toBeNull();
    expect((await listOwnPlanRequests(owner))[0].status).toBe("APPROVED");

    // 処理済みは再承認・却下できない
    expect("error" in (await approvePlanRequest(r.id, null, OPEN))).toBe(true);
    expect("error" in (await rejectPlanRequest(r.id, "理由", OPEN))).toBe(true);
    // PRO 利用中の再申込は不可
    const again = await createPlanRequest(owner, { kind: "UPGRADE" }, OPEN);
    expect("error" in again && again.error.code).toBe("VALIDATION_ERROR");
  });

  it("却下は理由必須で、申請は REJECTED になる", async () => {
    const owner = await makeCompany("却下株式会社");
    const r = await createPlanRequest(owner, { kind: "UPGRADE" }, OPEN);
    if ("error" in r) throw new Error(r.error.message);
    expect("error" in (await rejectPlanRequest(r.id, "   ", OPEN))).toBe(true);
    const ok = await rejectPlanRequest(r.id, "法人確認ができませんでした", OPEN);
    if ("error" in ok) throw new Error(ok.error.message);
    expect((await listOwnPlanRequests(owner))[0]).toMatchObject({ status: "REJECTED", processedNote: "法人確認ができませんでした" });
    expect((await getOwnPlan(owner)).effectivePlan).toBe("FREE");
  });

  it("新規登録画面からの申込（source=REGISTER）も同じ申請として扱う", async () => {
    const owner = await makeCompany("登録時申込株式会社");
    const r = await createPlanRequestInternal({ companyId: owner.companyId, memberId: owner.memberId, kind: "UPGRADE", source: "REGISTER", now: OPEN });
    if ("error" in r) throw new Error(r.error.message);
    expect((await listOwnPlanRequests(owner))[0]).toMatchObject({ source: "REGISTER", status: "PENDING" });
  });
});

describe("PRO 版の解約申請", () => {
  it("基本版は解約を申請できない。PRO は申請でき、承認で当月末（JST）が期限になる", async () => {
    const free = await makeCompany("基本版株式会社");
    const bad = await createPlanRequest(free, { kind: "CANCEL" }, OPEN);
    expect("error" in bad && bad.error.code).toBe("VALIDATION_ERROR");

    const pro = await setPlan(await makeCompany("解約株式会社"), "PRO");
    const r = await createPlanRequest(pro, { kind: "CANCEL" }, OPEN);
    if ("error" in r) throw new Error(r.error.message);
    const ok = await approvePlanRequest(r.id, null, OPEN);
    if ("error" in ok) throw new Error(ok.error.message);
    const plan = await getOwnPlan(pro);
    expect(plan.plan).toBe("PRO");
    expect(plan.planExpiresAt?.toISOString()).toBe("2026-12-31T14:59:59.000Z"); // 12/31 23:59:59 JST
    // 期限までは PRO のまま、翌月 0:00 JST 以降は基本版
    expect(plan.planExpiresAt!.getTime()).toBeGreaterThan(OPEN.getTime());

    // 期限が設定済みの企業は再度の解約申請を受けない
    const again = await createPlanRequest(pro, { kind: "CANCEL" }, OPEN);
    expect("error" in again && again.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("取り下げとテナント分離", () => {
  it("自社の申請中のものだけ取り下げられ、他社の申請は 404", async () => {
    const a = await makeCompany("A社");
    const b = await makeCompany("B社");
    const r = await createPlanRequest(a, { kind: "UPGRADE" }, OPEN);
    if ("error" in r) throw new Error(r.error.message);
    const other = await withdrawPlanRequest(b, r.id);
    expect("error" in other && other.error.code).toBe("NOT_FOUND");
    expect((await listOwnPlanRequests(b))).toHaveLength(0);

    const ok = await withdrawPlanRequest(a, r.id);
    expect("error" in ok).toBe(false);
    expect((await listOwnPlanRequests(a))[0].status).toBe("WITHDRAWN");
    // 取り下げ後は再申込できる
    const again = await createPlanRequest(a, { kind: "UPGRADE" }, OPEN);
    expect("error" in again).toBe(false);
    expect(await prisma.planRequest.count({ where: { tenantCompanyId: a.companyId } })).toBe(2);
  });
});
