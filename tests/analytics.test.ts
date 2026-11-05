// 分析の純粋ロジック（PRO版仕様書 §4.4, §13）: ファネル集計・反応状況・匿名統計の母数条件・CSV 生成
import { describe, expect, it } from "vitest";
import { aggregateMarketRates, funnelFromEntries, median, quantile, removeRateOutliers, responseRows } from "@/server/services/analytics";
import { toCsv, parseCsv } from "@/lib/csv";

describe("funnelFromEntries", () => {
  it("送信・受信・合計の件数と段階を数える", () => {
    const d = new Date();
    const f = funnelFromEntries([
      { createdByOwn: true, createdAt: d, status: "SUBMITTED", disclosed: false, interviewed: false, contracted: false },
      { createdByOwn: true, createdAt: d, status: "MUTUALLY_APPROVED", disclosed: true, interviewed: false, contracted: false },
      { createdByOwn: false, createdAt: d, status: "INTERVIEW", disclosed: true, interviewed: true, contracted: false },
      { createdByOwn: false, createdAt: d, status: "CONTRACTED", disclosed: true, interviewed: true, contracted: true },
      { createdByOwn: false, createdAt: d, status: "DECLINED", disclosed: false, interviewed: false, contracted: false },
    ]);
    expect(f.sent).toMatchObject({ submitted: 2, approved: 1, interviewed: 0, contracted: 0 });
    expect(f.received).toMatchObject({ submitted: 3, approved: 2, interviewed: 2, contracted: 1 });
    expect(f.total).toMatchObject({ submitted: 5, approved: 3, interviewed: 2, contracted: 1 });
  });
});

describe("responseRows", () => {
  it("対象ごとの申込数・承認率・平均日数を計算し、申込数の多い順に並べる", () => {
    const t0 = new Date("2026-11-01T00:00:00Z");
    const rows = responseRows(
      [
        { id: "a", code: "P1", name: "A" },
        { id: "b", code: "P2", name: "B" },
      ],
      [
        { targetId: "a", createdAt: t0, supplyApprovedAt: new Date("2026-11-02T00:00:00Z"), demandApprovedAt: new Date("2026-11-03T00:00:00Z") },
        { targetId: "a", createdAt: t0, supplyApprovedAt: null, demandApprovedAt: null },
        { targetId: "b", createdAt: t0, supplyApprovedAt: new Date("2026-11-01T12:00:00Z"), demandApprovedAt: new Date("2026-11-01T06:00:00Z") },
        { targetId: "b", createdAt: t0, supplyApprovedAt: new Date("2026-11-02T00:00:00Z"), demandApprovedAt: new Date("2026-11-02T00:00:00Z") },
        { targetId: "b", createdAt: t0, supplyApprovedAt: null, demandApprovedAt: new Date("2026-11-02T00:00:00Z") },
      ]
    );
    expect(rows[0]).toMatchObject({ code: "P2", entries: 3, approved: 2, avgDaysToApproval: 0.8 });
    expect(rows[0].approvalRate).toBeCloseTo(2 / 3);
    expect(rows[1]).toMatchObject({ code: "P1", entries: 2, approved: 1, approvalRate: 0.5, avgDaysToApproval: 2 });
  });
});

describe("aggregateMarketRates（匿名統計）", () => {
  const p = (skill: string, city: string | null, rate: number) => ({ requiredSkills: [skill], locationCity: city, rateMaxYen: rate });
  it("母数5件未満のセルは出さず、スキル×都道府県で下位25%・中央値・上位25%を返す", () => {
    const rows = aggregateMarketRates([
      ...[60, 70, 80, 90, 100].map((r) => p("Java", "東京都千代田区", r * 10_000)),
      ...[60, 70, 80, 90].map((r) => p("PHP", "東京都新宿区", r * 10_000)),
      ...[50, 60, 70, 80, 90].map((r) => p("Java", "大阪府大阪市", r * 10_000)),
      p("java", "大阪府堺市", 1_000_000), // 表記ゆれは名寄せして同じセルに数える
    ]);
    expect(rows.map((r) => `${r.skill}/${r.prefecture}`)).toEqual(["Java/大阪府", "Java/東京都"]);
    const tokyo = rows.find((r) => r.prefecture === "東京都")!;
    expect(tokyo).toMatchObject({ count: 5, excluded: 0, q1Yen: 700_000, medianYen: 800_000, q3Yen: 900_000 });
    const osaka = rows.find((r) => r.prefecture === "大阪府")!;
    expect(osaka).toMatchObject({ count: 6, medianYen: 750_000, q1Yen: 625_000, q3Yen: 875_000 }); // 偶数件は中央2件の平均、分位点は線形補間
    expect(JSON.stringify(rows)).not.toContain("千代田"); // 市区町村は出さない
  });
  it("都道府県不明は「全国・未指定」にまとめ、閾値は引数で変えられる", () => {
    const rows = aggregateMarketRates([p("AWS", null, 700_000), p("AWS", "リモート", 800_000)], 2);
    expect(rows).toEqual([{ skill: "AWS", prefecture: "全国・未指定", count: 2, excluded: 0, q1Yen: 725_000, medianYen: 750_000, q3Yen: 775_000 }]);
  });
  it("異常値の除外: 妥当範囲外（20万未満・300万超）と IQR 外れ値を除き、母数は除外後で判定する", () => {
    // 60〜100万の5件に、桁違い（5万・900万）と極端値（150万。Q3+1.5×IQR=135万 を超える）を混ぜる
    const rates = [600_000, 700_000, 800_000, 900_000, 1_000_000, 50_000, 9_000_000, 1_500_000];
    expect(removeRateOutliers(rates)).toEqual({ kept: [600_000, 700_000, 800_000, 900_000, 1_000_000], excluded: 3 });
    // 妥当範囲内が5件未満なら IQR 法は使わず、範囲外だけ除く
    expect(removeRateOutliers([400_000, 2_900_000, 10_000])).toEqual({ kept: [400_000, 2_900_000], excluded: 1 });

    const rows = aggregateMarketRates(rates.map((r) => p("Go", "東京都港区", r)));
    expect(rows).toEqual([{ skill: "Go", prefecture: "東京都", count: 5, excluded: 3, q1Yen: 700_000, medianYen: 800_000, q3Yen: 900_000 }]);
    // 異常値を除いた結果が5件未満になるセルは出さない
    expect(aggregateMarketRates([600_000, 700_000, 800_000, 900_000, 9_000_000].map((r) => p("Rust", "東京都", r)))).toEqual([]);
  });
  it("quantile は線形補間", () => {
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(quantile([10, 20, 30, 40], 0.75)).toBe(33); // 32.5 → 四捨五入
    expect(quantile([], 0.5)).toBe(0);
  });
  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(3); // (2+3)/2 → 四捨五入
  });
});

describe("toCsv", () => {
  it("BOM 付きで、カンマ・引用符・改行を含む値を引用符で囲む。parseCsv で往復できる", () => {
    const csv = toCsv([
      ["案件ID", "案件名"],
      ["P1", 'A, "B"\nC'],
      ["P2", null],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"A, ""B""\nC"');
    expect(parseCsv(csv)).toEqual([["案件ID", "案件名"], ["P1", 'A, "B"\nC'], ["P2", ""]]);
  });
});
