import { describe, expect, it } from "vitest";
import { endOfMonthJst, isProSignupOpen, PRO_SIGNUP_OPEN_FROM } from "@/lib/plan-signup";

describe("PRO 版の自己申込の受付期間（JST）", () => {
  it("規約の適用開始日 2026-12-04 0:00 JST から受け付ける", () => {
    expect(PRO_SIGNUP_OPEN_FROM).toBe("2026-12-04");
    expect(isProSignupOpen(new Date("2026-12-03T14:59:59Z"))).toBe(false); // 12/3 23:59 JST
    expect(isProSignupOpen(new Date("2026-12-03T15:00:00Z"))).toBe(true); // 12/4 0:00 JST
    expect(isProSignupOpen(new Date("2027-06-01T00:00:00Z"))).toBe(true);
  });
});

describe("解約の効力発生日（当月末 JST）", () => {
  it("JST の暦月で末日を返す（月末・うるう年・月初 0:00 JST）", () => {
    expect(endOfMonthJst(new Date("2026-12-10T03:00:00Z"))).toBe("2026-12-31");
    expect(endOfMonthJst(new Date("2026-11-30T14:59:59Z"))).toBe("2026-11-30"); // 11/30 23:59 JST
    expect(endOfMonthJst(new Date("2026-11-30T15:00:00Z"))).toBe("2026-12-31"); // 12/1 0:00 JST
    expect(endOfMonthJst(new Date("2028-02-05T00:00:00Z"))).toBe("2028-02-29");
  });
});
