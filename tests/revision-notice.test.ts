import { describe, expect, it } from "vitest";
import { isRevisionNoticeActive, jstDateString, REVISION_EFFECTIVE_DATE } from "@/lib/revision-notice";

describe("規約改定の告知期間", () => {
  it("JST の暦日で判定する", () => {
    expect(jstDateString(new Date("2026-12-03T15:00:00Z"))).toBe("2026-12-04");
    expect(jstDateString(new Date("2026-12-03T14:59:59Z"))).toBe("2026-12-03");
  });
  it("告知日から適用開始日の前日まで表示し、適用開始日（JST 0:00）以降は消える", () => {
    expect(REVISION_EFFECTIVE_DATE).toBe("2026-12-04");
    expect(isRevisionNoticeActive(new Date("2026-11-03T14:59:59Z"))).toBe(false); // 11/3 23:59 JST
    expect(isRevisionNoticeActive(new Date("2026-11-03T15:00:00Z"))).toBe(true); // 11/4 0:00 JST
    expect(isRevisionNoticeActive(new Date("2026-12-03T14:59:59Z"))).toBe(true); // 12/3 23:59 JST
    expect(isRevisionNoticeActive(new Date("2026-12-03T15:00:00Z"))).toBe(false); // 12/4 0:00 JST
  });
});
