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

  it("OCRで括弧が半角に化けた見出し（[ 案件名】）でも分割する", () => {
    const text = [
      "現在急ぎ募集している案件情報をお送りいたします。",
      "[ 案件名】外資生保向けペーパレスシステム開発支援",
      "【概要】要件定義からの上流工程",
      "[ 案件名】生保向けコールセンターシステム基盤更改",
      "【概要】クラウドリフト",
    ].join("\n");
    const segs = splitProjectItems(text);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toContain("ペーパレスシステム");
    expect(segs[1]).toContain("コールセンターシステム");
  });

  it("括弧ゆれの類似見出し（[案件概要] 等）では分割しない", () => {
    const text = "[案件名] A\n[案件概要] 説明\n〔案件詳細〕detail";
    expect(splitProjectItems(text)).toHaveLength(1);
  });

  it("■案件名: のような括弧なし書式でも分割する", () => {
    const text = [
      "ご紹介です。",
      "■案件名: 物流システム更改",
      "■場所: 東京",
      "■単価: 80万",
      "■案件名: 会計システム保守",
      "■場所: 大阪",
      "■単価: 70万",
    ].join("\n");
    const segs = splitProjectItems(text);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toContain("物流システム");
    expect(segs[1]).toContain("会計システム");
  });

  it("提案手順の「①案件名 ②経歴書」のような本文中の語では分割しない", () => {
    // 実ファイル（804.pdf）の構造: 冒頭の提案手順に「案件名」の語が現れるが、
    // 要素ラベルが続かないため境界にならず、実際の2案件だけに分割される
    const text = [
      "ご提案の際は、本メールに下記4点を添え、ご返信ください。",
      "1案件名",
      "8経歴書",
      "3希望単価",
      "4必須・尚可スキルを満たしているかどうか",
      "下記、急募中の案件になります。",
      "[ 案件名】ペーパレスシステム開発支援",
      "【概要】上流工程および受入テスト",
      "【スキル】 * 必須 Java",
      "[ 案件】基盤更改 SE",
      "【概要】クラウドリフト",
      "【場所】新川崎",
    ].join("\n");
    const segs = splitProjectItems(text);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toContain("ご提案の際は"); // 冒頭は1件目に含める
    expect(segs[0]).toContain("ペーパレスシステム");
    expect(segs[1]).toContain("基盤更改");
  });

  it("タイトル見出しが無くても要素ラベルの繰り返しで分割する（フォールバック）", () => {
    const text = [
      "■概要: A社向け開発",
      "■場所: 東京",
      "■概要: B社向け保守",
      "■場所: 大阪",
    ].join("\n");
    const segs = splitProjectItems(text);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toContain("A社向け");
    expect(segs[1]).toContain("B社向け");
  });

  it("タイトルの直後に要素ラベルが無い孤立見出しは境界にしない", () => {
    const text = "【案件名】単独\n本文のみで要素ラベルなし\n【案件名】もう一つ\nこちらも本文のみ";
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
