import { describe, expect, it } from "vitest";
import { splitFilename, splitProjectItems } from "../src/server/pipeline/split";

describe("splitProjectItems", () => {
  it("【案件名】が複数あれば案件ごとに分割する", () => {
    const text = [
      "お世話になっております。下記案件のご紹介です。",
      "【案件名】共通基盤デリバリサービス",
      "【概要】基盤刷新",
      "【案件】生保会社向けリプレイス",
      "【スキル】Windows Server",
      "【案件名】クラウドリフト (AWS)",
      "【予算】スキル見合い",
    ].join("\n");
    const segs = splitProjectItems(text);
    expect(segs).toHaveLength(3);
    // 冒頭の挨拶文は1件目に含める
    expect(segs[0]).toContain("お世話になっております");
    expect(segs[0]).toContain("共通基盤デリバリサービス");
    expect(segs[1]).toContain("生保会社向けリプレイス");
    expect(segs[1]).toContain("Windows Server");
    expect(segs[2]).toContain("クラウドリフト");
  });

  it("見出しが1つ以下ならそのまま1件", () => {
    expect(splitProjectItems("【案件名】単一案件\n【概要】...")).toHaveLength(1);
    expect(splitProjectItems("案件のご紹介です")).toHaveLength(1);
  });

  it("【案件概要】などの類似見出しでは分割しない", () => {
    const text = "【案件名】A\n【案件概要】説明\n【案件詳細】detail";
    expect(splitProjectItems(text)).toHaveLength(1);
  });
});

describe("splitFilename", () => {
  it("拡張子の前に番号を挿入する", () => {
    expect(splitFilename("貼り付け取込.txt", 2, 3)).toBe("貼り付け取込（2/3）.txt");
  });
  it("拡張子がなくても付与できる", () => {
    expect(splitFilename("案件紹介", 1, 2)).toBe("案件紹介（1/2）");
  });
});
