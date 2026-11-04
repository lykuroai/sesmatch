// 保存検索の条件判定と日次実行判定（PRO版仕様書 §4.3）の純粋ロジック
import { describe, expect, it } from "vitest";
import {
  criteriaToQuery,
  describeCriteria,
  isDailyDue,
  matchEngineerCriteria,
  matchProjectCriteria,
} from "@/server/services/saved-searches";

const terms = (q: string[] = [], skills: Record<string, string[]> = {}) => ({
  qTerms: q,
  skillTerms: new Map(Object.entries(skills)),
});
const now = new Date("2026-11-04T03:00:00Z");

const project = {
  code: "P000001",
  name: "金融 Java 開発",
  anonymousSummary: "大手金融機関向け",
  industry: "金融",
  processes: ["設計", "開発"],
  requiredSkills: [{ name: "Java", minMonths: 36 }],
  preferredSkills: [{ name: "AWS" }],
  rateMinYen: 600_000,
  rateMaxYen: 800_000,
  remoteLevel: "R2",
  locationCity: "東京都千代田区",
  startDate: new Date("2026-12-01"),
} as never;

const engineer = {
  code: "E000001",
  summary: "Java 歴10年",
  residenceCity: "東京都新宿区",
  skills: [{ name: "Java" }, { name: "PostgreSQL" }],
  processes: ["開発"],
  roles: ["PL"],
  industries: ["金融"],
  rateBand: "70〜80万円",
  remotePreference: "R2",
  availableFrom: new Date("2026-12-01"),
} as never;

describe("matchProjectCriteria", () => {
  it("条件なしは常に一致。スキル・単価・在宅・勤務地・開始時期・キーワードで絞れる", () => {
    expect(matchProjectCriteria(project, {}, terms(), now)).toBe(true);
    expect(matchProjectCriteria(project, { skills: ["Java"] }, terms([], { Java: ["java"] }), now)).toBe(true);
    expect(matchProjectCriteria(project, { skills: ["PHP"] }, terms([], { PHP: ["php"] }), now)).toBe(false);
    expect(matchProjectCriteria(project, { skills: ["金融"] }, terms([], { 金融: ["金融"] }), now)).toBe(true); // 業種も対象
    expect(matchProjectCriteria(project, { rateMin: 90 }, terms(), now)).toBe(false);
    expect(matchProjectCriteria(project, { rateMax: 50 }, terms(), now)).toBe(false);
    expect(matchProjectCriteria(project, { rateMin: 70, rateMax: 90 }, terms(), now)).toBe(true);
    expect(matchProjectCriteria(project, { remote: "R0" }, terms(), now)).toBe(false);
    expect(matchProjectCriteria(project, { location: "大阪府大阪市" }, terms(), now)).toBe(false);
    expect(matchProjectCriteria(project, { start: "1" }, terms(), now)).toBe(true); // 12/1 は1か月以内
    expect(matchProjectCriteria(project, { q: "金融" }, terms(["金融"]), now)).toBe(true);
    expect(matchProjectCriteria(project, { q: "製造" }, terms(["製造"]), now)).toBe(false);
  });
});

describe("matchEngineerCriteria", () => {
  it("単価帯（10万円幅）との重なり・スキル・役割・業種で判定し、氏名は対象にしない", () => {
    expect(matchEngineerCriteria(engineer, {}, terms(), now)).toBe(true);
    expect(matchEngineerCriteria(engineer, { rateMin: 85 }, terms(), now)).toBe(false);
    expect(matchEngineerCriteria(engineer, { rateMax: 60 }, terms(), now)).toBe(false);
    expect(matchEngineerCriteria(engineer, { rateMin: 75, rateMax: 75 }, terms(), now)).toBe(true);
    expect(matchEngineerCriteria(engineer, { skills: ["PL"] }, terms([], { PL: ["pl"] }), now)).toBe(true);
    expect(matchEngineerCriteria(engineer, { remote: "R5" }, terms(), now)).toBe(false);
    expect(matchEngineerCriteria(engineer, { start: "0" }, terms(), now)).toBe(false); // 12/1 は0か月以内でない
    expect(matchEngineerCriteria({ ...(engineer as object), availableFrom: null } as never, { start: "0" }, terms(), now)).toBe(true);
  });
});

describe("isDailyDue / criteria helpers", () => {
  it("DAILY は 9時台（JST）で、その日（JST）に未評価のときだけ実行する", () => {
    const nineJst = new Date("2026-11-04T00:10:00Z"); // 09:10 JST
    expect(isDailyDue(nineJst, null)).toBe(true);
    expect(isDailyDue(nineJst, new Date("2026-11-03T00:10:00Z"))).toBe(true); // 前日に評価済み
    expect(isDailyDue(nineJst, new Date("2026-11-04T00:05:00Z"))).toBe(false); // 当日評価済み
    expect(isDailyDue(new Date("2026-11-04T03:00:00Z"), null)).toBe(false); // 12:00 JST
  });
  it("URL クエリと説明文", () => {
    expect(criteriaToQuery({ q: "Java", skills: ["AWS", "Spring"], rateMax: 80, remote: "R2" })).toBe(
      "q=Java&skills=AWS%2CSpring&rateMax=80&remote=R2"
    );
    expect(criteriaToQuery({})).toBe("");
    expect(describeCriteria({})).toBe("条件なし（すべて）");
    expect(describeCriteria({ skills: ["Java"], rateMin: 60 })).toBe("スキル: Java / 単価: 60〜万円");
  });
});
