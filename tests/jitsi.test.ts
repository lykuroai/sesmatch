// Web 会議の純粋ロジック（PRO版仕様書 §4.8）: JWT・ゲスト有効期間・会議室名
import { describe, expect, it } from "vitest";
import { guestWindow, isWithinGuestWindow, meetingUrl, newRoomId, signMeetingJwt, verifyMeetingJwt } from "@/server/meeting/jitsi";
import jwt from "jsonwebtoken";

const cfg = { appId: "sesmatch", appSecret: "test-secret", domain: "meet.example.test" };

describe("jitsi", () => {
  it("参加 JWT は Jitsi の形式（aud/iss/sub/room/context.user）で、秘密鍵が違えば検証に失敗する", () => {
    const token = signMeetingJwt(cfg, { room: "ses-abc", displayName: "青山", moderator: true }); // 現在時刻で署名（exp は検証時刻で評価される）
    const p = jwt.decode(token) as Record<string, unknown>;
    expect(p).toMatchObject({ aud: "jitsi", iss: "sesmatch", sub: "meet.example.test", room: "ses-abc" });
    expect((p.context as { user: { name: string; moderator: string } }).user).toEqual({ name: "青山", moderator: "true" });
    expect(Number(p.exp) - Number(p.iat)).toBe(7200);
    expect(verifyMeetingJwt(cfg, token)).toEqual({ room: "ses-abc", name: "青山" });
    expect(verifyMeetingJwt({ ...cfg, appSecret: "other" }, token)).toBeNull();
    expect(meetingUrl(cfg.domain, "ses-abc", "t")).toBe("https://meet.example.test/ses-abc?jwt=t");
  });
  it("ゲスト URL は面談予定の前後1時間だけ有効。会議室名はランダムで案件名を含まない", () => {
    const at = new Date("2026-11-04T05:00:00Z");
    expect(guestWindow(at)).toEqual({ from: new Date("2026-11-04T04:00:00Z"), to: new Date("2026-11-04T06:00:00Z") });
    expect(isWithinGuestWindow(at, new Date("2026-11-04T04:30:00Z"))).toBe(true);
    expect(isWithinGuestWindow(at, new Date("2026-11-04T03:59:00Z"))).toBe(false);
    expect(isWithinGuestWindow(at, new Date("2026-11-04T06:01:00Z"))).toBe(false);
    expect(newRoomId()).toMatch(/^ses-[0-9a-f]{24}$/);
    expect(newRoomId()).not.toBe(newRoomId());
  });
});
