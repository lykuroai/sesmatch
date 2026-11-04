// 一斉スカウトの純粋ロジック（PRO版仕様書 §4.6）: テンプレート展開・日次境界・反応率・モック下書き
import { describe, expect, it } from "vitest";
import { renderScoutTemplate, scoutBatchStats, startOfTodayJst } from "@/server/services/scouts";
import { MockLlmGateway } from "@/server/pipeline/llm";
import { detectContactInfo } from "@/server/pipeline/pii";

describe("renderScoutTemplate", () => {
  it("変数を案件の内容に置き換える", () => {
    const out = renderScoutTemplate("「{案件名}」{勤務地}/{在宅}/{開始時期}/{単価上限}", {
      name: "金融系基盤更改",
      rateMaxYen: 850_000,
      locationCity: "東京都千代田区",
      remoteLevel: "R2",
      startDate: new Date("2026-12-01T00:00:00Z"),
    });
    expect(out).toBe("「金融系基盤更改」東京都千代田区/週2〜3出社/2026-12-01/85万円");
    expect(renderScoutTemplate("{勤務地}", { name: "x", rateMaxYen: 1, locationCity: null, remoteLevel: "R0", startDate: new Date() })).toBe("応相談");
  });
});

describe("startOfTodayJst / scoutBatchStats", () => {
  it("当日の開始は JST 0:00（UTC 前日 15:00）", () => {
    expect(startOfTodayJst(new Date("2026-11-04T03:00:00Z")).toISOString()).toBe("2026-11-03T15:00:00.000Z");
    expect(startOfTodayJst(new Date("2026-11-04T16:00:00Z")).toISOString()).toBe("2026-11-04T15:00:00.000Z"); // JST 11/5 1:00
  });
  it("承認・辞退・無反応を数える", () => {
    const s = scoutBatchStats([
      { status: "DEMAND_APPROVED", disclosed: false },
      { status: "MUTUALLY_APPROVED", disclosed: true },
      { status: "DECLINED", disclosed: false },
      { status: "CONTRACTED", disclosed: true },
    ]);
    expect(s).toEqual({ sent: 4, approved: 2, declined: 1, pending: 1, approvalRate: 0.5 });
    expect(scoutBatchStats([]).approvalRate).toBeNull();
  });
});

describe("モック LLM のスカウト下書き", () => {
  it("変数を残し、連絡先を含まない", async () => {
    const body = await new MockLlmGateway().draftScoutMessage({
      project: { name: "A", summary: "概要", requiredSkills: ["Java"], preferredSkills: [], rateMaxYen: 800_000, locationCity: "東京都", remoteLabel: "週2〜3出社", startDate: "2026-12-01" },
      engineers: [{ code: "E1", ageBand: "30代", rateBand: "70〜80万円", skills: ["Java"], processes: ["開発"] }],
    });
    expect(body).toContain("{案件名}");
    expect(detectContactInfo(body)).toEqual([]);
  });
});
