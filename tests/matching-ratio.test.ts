// 必須スキル充足率のしきい値（マッチング実行の「必須スキル適合」条件）のテスト
import { describe, expect, it } from "vitest";
import { score, type EngineerForMatch, type ProjectForMatch } from "@/server/matching/engine";

const engineer = (skills: string[]): EngineerForMatch => ({
  id: "e1",
  tenantCompanyId: "c1",
  status: "PUBLISHED",
  affiliationType: "EMPLOYEE",
  availableFrom: new Date("2026-08-01"),
  desiredRateYen: 700_000,
  maxOnsiteDaysPerWeek: 3,
  remotePreference: "R2",
  workAuthStatus: "NOT_REQUIRED",
  hasValidConsent: true,
  skills: skills.map((name) => ({ name, months: 60, lastUsedAt: new Date() })),
  processes: [],
  roles: [],
  industries: [],
});

const project = (required: string[]): ProjectForMatch => ({
  id: "p1",
  tenantCompanyId: "c2",
  status: "PUBLISHED",
  startDate: new Date("2026-09-01"),
  rateMaxYen: 800_000,
  onsiteDaysPerWeek: 2,
  remoteLevel: "R2",
  allowSubtier: false,
  acceptedTypes: ["EMPLOYEE"],
  industry: null as unknown as string,
  processes: [],
  requiredSkills: required.map((name) => ({ name, minMonths: null })),
  preferredSkills: [],
});

describe("必須スキル充足率のしきい値", () => {
  const p = project(["Java", "Spring Boot", "AWS", "Docker", "PostgreSQL"]);
  const e = engineer(["Java", "Spring Boot", "AWS", "Docker"]); // 4/5 = 80%充足

  it("既定（100%）では1つでも不足すると候補外", () => {
    const r = score(p, e);
    expect(r.passed).toBe(false);
    expect(r.missingConditions.some((m) => m.includes("PostgreSQL"))).toBe(true);
  });

  it("80%以上のしきい値なら4/5充足の候補が通過し、不足分は不足条件に表示", () => {
    const r = score(p, e, { minRequiredSkillRatio: 0.8 });
    expect(r.passed).toBe(true);
    expect(r.missingConditions.some((m) => m.includes("必須スキル不足") && m.includes("PostgreSQL"))).toBe(true);
    // 配点は充足率どおり（4/5 × 30 = 24）
    expect(r.breakdown["必須スキル"]).toBe(24);
  });

  it("90%のしきい値では4/5（80%）は候補外のまま", () => {
    const r = score(p, e, { minRequiredSkillRatio: 0.9 });
    expect(r.passed).toBe(false);
  });

  it("全て充足している候補はしきい値に関係なく通過する", () => {
    const full = engineer(["Java", "Spring Boot", "AWS", "Docker", "PostgreSQL"]);
    expect(score(p, full, { minRequiredSkillRatio: 0.8 }).passed).toBe(true);
    expect(score(p, full).passed).toBe(true);
  });

  it("経験月数不足も充足率の不足として数える", () => {
    const p2: ProjectForMatch = {
      ...project(["Java", "AWS"]),
      requiredSkills: [
        { name: "Java", minMonths: 120 }, // 60ヶ月しかないので不足
        { name: "AWS", minMonths: null },
      ],
    };
    expect(score(p2, e).passed).toBe(false);
    expect(score(p2, e, { minRequiredSkillRatio: 0.5 }).passed).toBe(true);
  });
});
