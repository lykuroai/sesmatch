import { describe, expect, it } from "vitest";
import {
  classifyEngineerImage,
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

  it("技術領域はスキルの一致数で決め、AWS や Docker が1つあるだけではクラウドにしない", () => {
    expect(
      classifyProjectImage({ name: "ポータル刷新", skills: ["React", "TypeScript", "Docker"] }),
    ).toBe("web");
    expect(
      classifyProjectImage({ name: "基幹システム改修", skills: ["Java", "Spring Boot", "Oracle", "AWS"] }),
    ).toBe("business");
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

describe("classifyEngineerImage（人材一覧のイメージ判定）", () => {
  it("スキルの技術領域を優先して判定する", () => {
    expect(
      classifyEngineerImage({
        skills: [
          { category: "LANGUAGE", name: "TypeScript" },
          { category: "FRAMEWORK", name: "React" },
          { category: "INDUSTRY", name: "金融" },
        ],
      }),
    ).toBe("web");
    expect(
      classifyEngineerImage({ skills: [{ category: "CLOUD", name: "AWS" }, { category: "TOOL", name: "Terraform" }] }),
    ).toBe("cloud");
    expect(classifyEngineerImage({ skills: [{ category: "LANGUAGE", name: "Swift" }] })).toBe("mobile");
    expect(classifyEngineerImage({ skills: [], summary: "機械学習モデルの構築と運用" })).toBe("data");
    // PHP/Web 中心で AWS を1つ持つ人材は Web、AWS+Linux+インフラ運用の人材はクラウド
    expect(
      classifyEngineerImage({
        skills: [
          { category: "LANGUAGE", name: "PHP" },
          { category: "FRAMEWORK", name: "WordPress" },
          { category: "CLOUD", name: "AWS" },
        ],
        summary: "Webシステム開発・運用保守に長期従事",
      }),
    ).toBe("web");
    expect(
      classifyEngineerImage({
        skills: [{ category: "CLOUD", name: "AWS" }, { category: "OS", name: "Linux" }],
        summary: "インフラ構築・運用の経験が長い",
      }),
    ).toBe("cloud");
  });

  it("技術領域が読み取れなければ業種経験で判定する", () => {
    expect(classifyEngineerImage({ skills: [{ category: "LANGUAGE", name: "Java" }], industries: ["金融"] })).toBe("finance");
    expect(classifyEngineerImage({ skills: [{ category: "INDUSTRY", name: "製造" }] })).toBe("manufacturing");
  });

  it("どれにも当たらなければ汎用の業務システム", () => {
    expect(classifyEngineerImage({ skills: [{ category: "LANGUAGE", name: "Java" }], roles: ["PM"] })).toBe("business");
    expect(classifyEngineerImage({})).toBe("business");
  });
});
