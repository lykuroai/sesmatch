// 利用プランと機能ゲートの純粋ロジック（PRO版仕様書 §5, §7, §13）
import { describe, expect, it } from "vitest";
import { assertFeature, effectivePlan, hasFeature, isProPlan } from "@/server/plan/features";
import { assertLimit, limitFor } from "@/server/plan/limits";

const now = new Date("2026-11-04T00:00:00Z");
const future = new Date("2026-12-04T00:00:00Z");
const past = new Date("2026-10-04T00:00:00Z");

describe("effectivePlan", () => {
  it("FREE は常に FREE", () => {
    expect(effectivePlan({ plan: "FREE", planExpiresAt: future }, now)).toBe("FREE");
  });
  it("期限なしの PRO は PRO", () => {
    expect(effectivePlan({ plan: "PRO", planExpiresAt: null }, now)).toBe("PRO");
  });
  it("期限内の TRIAL/PRO はそのまま、期限切れは FREE 扱い", () => {
    expect(effectivePlan({ plan: "TRIAL", planExpiresAt: future }, now)).toBe("TRIAL");
    expect(effectivePlan({ plan: "TRIAL", planExpiresAt: past }, now)).toBe("FREE");
    expect(effectivePlan({ plan: "PRO", planExpiresAt: past }, now)).toBe("FREE");
  });
  it("期限は ISO 文字列でも判定できる（API 経由の値）", () => {
    expect(effectivePlan({ plan: "PRO", planExpiresAt: past.toISOString() }, now)).toBe("FREE");
    expect(effectivePlan({ plan: "PRO", planExpiresAt: future.toISOString() }, now)).toBe("PRO");
  });
  it("期限ちょうどは有効", () => {
    expect(effectivePlan({ plan: "PRO", planExpiresAt: now }, now)).toBe("PRO");
  });
});

describe("hasFeature / assertFeature", () => {
  it("TRIAL は PRO と同じ機能キーをすべて満たす", () => {
    expect(hasFeature({ plan: "TRIAL", planExpiresAt: future }, "company_name_display", now)).toBe(true);
    expect(hasFeature({ plan: "PRO" }, "bulk_ingest", now)).toBe(true);
    expect(isProPlan({ plan: "TRIAL", planExpiresAt: future }, now)).toBe(true);
  });
  it("FREE と期限切れは PRO 機能を使えず PLAN_REQUIRED を返す", () => {
    expect(hasFeature({ plan: "FREE" }, "company_name_display", now)).toBe(false);
    expect(hasFeature({ plan: "PRO", planExpiresAt: past }, "company_name_display", now)).toBe(false);
    expect(assertFeature({ plan: "FREE" }, "analytics_export")?.error.code).toBe("PLAN_REQUIRED");
    expect(assertFeature({ plan: "PRO" }, "analytics_export")).toBeNull();
  });
});

describe("limits（基本版の上限は予約・現時点は無制限）", () => {
  it("FREE の数量上限は保存検索・API トークン・Webhook・書式を除き無制限", () => {
    expect(limitFor("FREE", "ingestions_per_month")).toBeNull();
    expect(limitFor("FREE", "members")).toBeNull();
    expect(limitFor("FREE", "published_projects")).toBeNull();
    expect(assertLimit("FREE", "members", 100)).toBeNull();
    expect(limitFor("FREE", "api_tokens")).toBe(2);
    expect(limitFor("PRO", "api_tokens")).toBe(10);
    expect(assertLimit("FREE", "api_tokens", 2)?.error.code).toBe("PLAN_LIMIT_EXCEEDED");
    expect(assertLimit("FREE", "webhooks", 0)?.error.code).toBe("PLAN_LIMIT_EXCEEDED");
    expect(assertLimit("PRO", "webhooks", 4)).toBeNull();
  });
  it("保存検索は FREE 0件、PRO/TRIAL 10件", () => {
    expect(assertLimit("FREE", "saved_searches", 0)?.error.code).toBe("PLAN_LIMIT_EXCEEDED");
    expect(assertLimit("PRO", "saved_searches", 9)).toBeNull();
    expect(assertLimit("PRO", "saved_searches", 10)?.error.code).toBe("PLAN_LIMIT_EXCEEDED");
    expect(assertLimit("TRIAL", "saved_searches", 10)?.error.code).toBe("PLAN_LIMIT_EXCEEDED");
  });
});
