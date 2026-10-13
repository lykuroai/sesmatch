import { describe, expect, it } from "vitest";
import {
  classifyProjectImage,
  PROJECT_IMAGE_KINDS,
  PROJECT_IMAGE_LABELS,
} from "../src/lib/project-image";

describe("classifyProjectImage（案件一覧のイメージ判定）", () => {
  it("業種欄を最優先で判定する", () => {
    expect(
      classifyProjectImage({
        industry: "金融",
        name: "勘定系周辺システム更改",
      }),
    ).toBe("finance");
    expect(
      classifyProjectImage({
        industry: "通信",
        name: "Webフロント刷新",
        skills: ["React"],
      }),
    ).toBe("telecom");
  });

  it("業種欄が空なら案件名・概要から業種を判定する", () => {
    expect(
      classifyProjectImage({
        name: "製造業向け 生産管理システム保守開発",
        skills: ["Python"],
      }),
    ).toBe("manufacturing");
    expect(
      classifyProjectImage({
        name: "大手物流企業向け 配送管理システム刷新",
        summary: "必須: Python、AWS",
      }),
    ).toBe("logistics");
    expect(
      classifyProjectImage({
        name: "システム開発",
        summary: "自治体向け住民情報システムの改修",
      }),
    ).toBe("public");
    expect(classifyProjectImage({ name: "電子カルテ連携基盤の構築" })).toBe(
      "healthcare",
    );
  });

  it("業種が読み取れなければスキル・内容から技術領域を判定する", () => {
    expect(
      classifyProjectImage({
        name: "新規サービスのフロント開発",
        skills: ["React", "TypeScript"],
      }),
    ).toBe("web");
    expect(
      classifyProjectImage({ name: "基盤構築", skills: ["AWS", "Terraform"] }),
    ).toBe("cloud");
    expect(
      classifyProjectImage({ name: "データ基盤の整備", skills: ["BigQuery"] }),
    ).toBe("data");
    expect(
      classifyProjectImage({ name: "スマホアプリ開発", skills: ["Swift"] }),
    ).toBe("mobile");
    expect(
      classifyProjectImage({ name: "車載ECUの制御ソフト開発", skills: ["C"] }),
    ).toBe("embedded");
    expect(classifyProjectImage({ name: "SOC運用・脆弱性診断" })).toBe(
      "security",
    );
  });

  it("どれにも当たらなければ汎用の業務システム", () => {
    expect(
      classifyProjectImage({ name: "システム保守", skills: ["Java"] }),
    ).toBe("business");
    expect(classifyProjectImage({ name: "" })).toBe("business");
  });

  it("全種別に表示名がある", () => {
    for (const k of PROJECT_IMAGE_KINDS)
      expect(PROJECT_IMAGE_LABELS[k]).toBeTruthy();
  });
});
