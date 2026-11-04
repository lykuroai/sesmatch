// IP アドレス制限の純粋ロジック（PRO版仕様書 §4.12）
import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, isIpAllowed, parseCidr, parseIp, validateIpAllowList } from "@/server/auth/ip";

describe("IP/CIDR の解釈", () => {
  it("IPv4・IPv6・IPv4 射影を解釈する", () => {
    expect(parseIp("203.0.113.10")?.family).toBe(4);
    expect(parseIp("2001:db8::1")?.family).toBe(6);
    expect(parseIp("::ffff:203.0.113.10")).toEqual(parseIp("203.0.113.10"));
    expect(parseIp("256.1.1.1")).toBeNull();
    expect(parseIp("abc")).toBeNull();
    expect(parseIp("2001:db8:::1")).toBeNull();
  });
  it("CIDR を解釈し不正を拒否する", () => {
    expect(parseCidr("203.0.113.0/24")).toMatchObject({ family: 4, prefix: 24 });
    expect(parseCidr("203.0.113.10")).toMatchObject({ family: 4, prefix: 32 });
    expect(parseCidr("2001:db8::/32")).toMatchObject({ family: 6, prefix: 32 });
    expect(parseCidr("203.0.113.0/33")).toBeNull();
    expect(parseCidr("203.0.113.0/x")).toBeNull();
  });
});

describe("許可判定", () => {
  const list = ["203.0.113.0/24", "198.51.100.7", "2001:db8::/32"];
  it("リストが空なら制限なし", () => {
    expect(isIpAllowed("1.2.3.4", [])).toBe(true);
    expect(isIpAllowed(null, [])).toBe(true);
  });
  it("CIDR・単一アドレス・IPv6 で判定する", () => {
    expect(isIpAllowed("203.0.113.200", list)).toBe(true);
    expect(isIpAllowed("203.0.114.1", list)).toBe(false);
    expect(isIpAllowed("198.51.100.7", list)).toBe(true);
    expect(isIpAllowed("198.51.100.8", list)).toBe(false);
    expect(isIpAllowed("2001:db8:1234::1", list)).toBe(true);
    expect(isIpAllowed("2001:db9::1", list)).toBe(false);
    expect(isIpAllowed("::ffff:198.51.100.7", list)).toBe(true);
    expect(isIpAllowed(null, list)).toBe(false);
  });
  it("不正な項目はマッチしない（例外にしない）", () => {
    expect(isIpAllowed("1.2.3.4", ["garbage"])).toBe(false);
  });
});

describe("入力検証", () => {
  it("正規化・重複除去・件数上限", () => {
    expect(validateIpAllowList([" 203.0.113.10 ", "203.0.113.10", ""])).toEqual({ list: ["203.0.113.10"] });
    expect(validateIpAllowList(["1.2.3"])).toMatchObject({ error: expect.stringContaining("不正") });
    expect(validateIpAllowList(Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`))).toMatchObject({ error: expect.stringContaining("20件") });
  });
});

describe("接続元 IP の決定（X-Forwarded-For）", () => {
  const h = (xff?: string) => (name: string) => (name === "x-forwarded-for" ? xff : undefined);
  it("ヘッダ無し・hops=0 は直接接続", () => {
    expect(clientIpFromHeaders(h(undefined), 1)).toBe("127.0.0.1");
    expect(clientIpFromHeaders(h("1.2.3.4"), 0)).toBe("127.0.0.1");
  });
  it("右端から信頼段数ぶん遡る（偽装された左側は無視）", () => {
    expect(clientIpFromHeaders(h("9.9.9.9, 203.0.113.10"), 1)).toBe("203.0.113.10");
    // ALB + nginx（hops=2）: "偽装, client, alb"
    expect(clientIpFromHeaders(h("9.9.9.9, 203.0.113.10, 10.0.0.5"), 2)).toBe("203.0.113.10");
    // 段数より少なければ先頭
    expect(clientIpFromHeaders(h("203.0.113.10"), 2)).toBe("203.0.113.10");
  });
  it("ポート付き表記を除く", () => {
    expect(clientIpFromHeaders(h("203.0.113.10:5555"), 1)).toBe("203.0.113.10");
    expect(clientIpFromHeaders(h("[2001:db8::1]:5555"), 1)).toBe("2001:db8::1");
  });
});
