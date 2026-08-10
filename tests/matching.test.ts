// マッチングエンジンのテスト（§19, §34）
import { describe, expect, it } from "vitest";
import {
  hardFilter,
  score,
  type EngineerForMatch,
  type ProjectForMatch,
} from "@/server/matching/engine";

const baseEngineer = (over: Partial<EngineerForMatch> = {}): EngineerForMatch => ({
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
  skills: [
    { name: "Java", months: 60, lastUsedAt: new Date() },
    { name: "Spring Boot", months: 36, lastUsedAt: new Date() },
  ],
  processes: ["基本設計", "開発"],
  roles: [],
  industries: ["金融"],
  ...over,
});

const baseProject = (over: Partial<ProjectForMatch> = {}): ProjectForMatch => ({
  id: "p1",
  tenantCompanyId: "c2",
  status: "PUBLISHED",
  startDate: new Date("2026-09-01"),
  rateMaxYen: 800_000,
  onsiteDaysPerWeek: 2,
  remoteLevel: "R2",
  allowSubtier: false,
  acceptedTypes: ["EMPLOYEE", "AFFILIATED", "FREELANCER"],
  industry: "金融",
  processes: ["基本設計", "開発"],
  requiredSkills: [
    { name: "Java", minMonths: 36 },
    { name: "Spring Boot", minMonths: 24 },
  ],
  preferredSkills: [{ name: "AWS" }],
  ...over,
});

describe("ハードフィルター（§19.1）", () => {
  it("全条件を満たす場合は通過する", () => {
    expect(hardFilter(baseProject(), baseEngineer())).toEqual([]);
  });

  it("有効な本人同意がない人材は候補外（§11.3）", () => {
    const failures = hardFilter(baseProject(), baseEngineer({ hasValidConsent: false }));
    expect(failures.some((f) => f.includes("同意"))).toBe(true);
  });

  it("外国籍不可の案件では外国籍の人材は候補外", () => {
    const failures = hardFilter(
      baseProject({ noForeignNational: true }),
      baseEngineer({ foreignNational: true })
    );
    expect(failures.some((f) => f.includes("外国籍不可"))).toBe(true);
    // 外国籍可の案件では通過する
    expect(hardFilter(baseProject(), baseEngineer({ foreignNational: true }))).toEqual([]);
    // 日本国籍（未指定）は外国籍不可の案件でも通過する
    expect(
      hardFilter(baseProject({ noForeignNational: true }), baseEngineer({ foreignNational: false }))
    ).toEqual([]);
  });

  it("必須スキル不足は候補外", () => {
    const failures = hardFilter(
      baseProject(),
      baseEngineer({ skills: [{ name: "PHP", months: 60, lastUsedAt: new Date() }] })
    );
    expect(failures.some((f) => f.includes("必須スキル不足"))).toBe(true);
  });

  it("必須スキルの経験月数不足は候補外", () => {
    const failures = hardFilter(
      baseProject(),
      baseEngineer({
        skills: [
          { name: "Java", months: 12, lastUsedAt: new Date() },
          { name: "Spring Boot", months: 36, lastUsedAt: new Date() },
        ],
      })
    );
    expect(failures.some((f) => f.includes("経験不足"))).toBe(true);
  });

  it("希望単価が案件上限を超える場合は候補外", () => {
    const failures = hardFilter(baseProject(), baseEngineer({ desiredRateYen: 900_000 }));
    expect(failures.some((f) => f.includes("単価"))).toBe(true);
  });

  it("稼働開始日が間に合わない場合は候補外", () => {
    const failures = hardFilter(
      baseProject(),
      baseEngineer({ availableFrom: new Date("2026-10-01") })
    );
    expect(failures.some((f) => f.includes("稼働開始日"))).toBe(true);
  });

  it("出社条件不一致は候補外（週出社日数 > 人材上限）", () => {
    const failures = hardFilter(
      baseProject({ onsiteDaysPerWeek: 5 }),
      baseEngineer({ maxOnsiteDaysPerWeek: 2 })
    );
    expect(failures.some((f) => f.includes("出社条件"))).toBe(true);
  });

  it("一社下人材は一社下不可の案件で候補外（§12.4）", () => {
    const failures = hardFilter(
      baseProject({ allowSubtier: false, acceptedTypes: ["EMPLOYEE", "AFFILIATED", "FREELANCER", "SUBTIER1"] }),
      baseEngineer({ affiliationType: "SUBTIER1" })
    );
    expect(failures.some((f) => f.includes("一社下不可"))).toBe(true);
  });

  it("受入所属区分の対象外は候補外（§12）", () => {
    const failures = hardFilter(
      baseProject({ acceptedTypes: ["EMPLOYEE"] }),
      baseEngineer({ affiliationType: "FREELANCER" })
    );
    expect(failures.some((f) => f.includes("受入所属区分"))).toBe(true);
  });

  it("就労資格の期限切れは候補外（§15）", () => {
    const failures = hardFilter(baseProject(), baseEngineer({ workAuthStatus: "EXPIRED" }));
    expect(failures.some((f) => f.includes("就労資格"))).toBe(true);
  });
});

describe("スコアリング（§19.2）", () => {
  it("満点構成で 100 + 所属加点5 を超えない", () => {
    const r = score(baseProject(), baseEngineer());
    expect(r.passed).toBe(true);
    expect(r.score).toBeLessThanOrEqual(105);
  });

  it("所属信頼加点: 自社社員5 / 一社下2（§19.2）", () => {
    const emp = score(baseProject(), baseEngineer());
    expect(emp.breakdown["所属信頼"]).toBe(5);
    const sub = score(
      baseProject({ allowSubtier: true, acceptedTypes: ["SUBTIER1"] }),
      baseEngineer({ affiliationType: "SUBTIER1" })
    );
    expect(sub.breakdown["所属信頼"]).toBe(2);
  });

  it("所属加点は能力評価を逆転させない（配点上限5点）", () => {
    // スキル充足度の差（必須30点満点 vs 半分）は所属加点5点では逆転しない
    const strong = score(
      baseProject(),
      baseEngineer({ affiliationType: "SUBTIER1" }) // 加点2
    );
    const weak = score(
      baseProject(),
      baseEngineer({
        affiliationType: "EMPLOYEE", // 加点5
        skills: [
          { name: "Java", months: 36, lastUsedAt: null },
          { name: "Spring Boot", months: 24, lastUsedAt: null },
        ],
        industries: [],
      })
    );
    // strong は SUBTIER1 のためハードフィルターで落ちる設定なので比較用に補正
    const strongOk = score(
      baseProject({ allowSubtier: true, acceptedTypes: ["EMPLOYEE", "SUBTIER1"] }),
      baseEngineer({ affiliationType: "SUBTIER1" })
    );
    expect(strongOk.score).toBeGreaterThan(weak.score);
  });

  it("必須スキルの直近利用がない場合は警告が出る", () => {
    const r = score(
      baseProject(),
      baseEngineer({
        skills: [
          { name: "Java", months: 60, lastUsedAt: new Date("2020-01-01") },
          { name: "Spring Boot", months: 36, lastUsedAt: new Date() },
        ],
      })
    );
    expect(r.warnings.some((w) => w.includes("2年以上前"))).toBe(true);
  });
});

describe("必須スキルの工程・役割名指定", () => {
  it("必須スキル「基本設計」は人材の工程欄でも充足と判定する", () => {
    const failures = hardFilter(
      baseProject({
        requiredSkills: [
          { name: "Java", minMonths: null },
          { name: "基本設計", minMonths: null },
        ],
      }),
      baseEngineer() // skills: Java/Spring Boot、processes: 基本設計, 開発
    );
    expect(failures).toEqual([]);
  });

  it("役割欄（PL等）でも充足と判定する", () => {
    const failures = hardFilter(
      baseProject({ requiredSkills: [{ name: "PL", minMonths: null }] }),
      baseEngineer({ roles: ["PL"] })
    );
    expect(failures).toEqual([]);
  });

  it("工程での充足に経験月数条件が付いている場合は不足扱い", () => {
    const failures = hardFilter(
      baseProject({ requiredSkills: [{ name: "基本設計", minMonths: 24 }] }),
      baseEngineer()
    );
    expect(failures.some((f) => f.includes("必須スキル経験不足: 基本設計"))).toBe(true);
  });

  it("スキル・工程・役割のいずれにも無ければ従来どおり不足", () => {
    const failures = hardFilter(
      baseProject({ requiredSkills: [{ name: "要件定義", minMonths: null }] }),
      baseEngineer({ processes: ["開発"] })
    );
    expect(failures.some((f) => f.includes("必須スキル不足: 要件定義"))).toBe(true);
  });
});

describe("通勤圏の参考警告（居住都道府県 × 勤務地都道府県）", () => {
  it("出社がある案件で都道府県が異なる場合は警告（足切りはしない）", () => {
    const r = score(
      baseProject({ locationCity: "大阪府大阪市" }),
      baseEngineer({ residenceCity: "神奈川県川崎市" })
    );
    expect(r.passed).toBe(true);
    expect(r.warnings.some((w) => w.includes("通勤圏の確認が必要"))).toBe(true);
  });

  it("同一都道府県なら警告しない", () => {
    const r = score(
      baseProject({ locationCity: "東京都千代田区" }),
      baseEngineer({ residenceCity: "東京都八王子市" })
    );
    expect(r.warnings.some((w) => w.includes("通勤圏"))).toBe(false);
  });

  it("フルリモート（出社0日）の案件では警告しない", () => {
    const r = score(
      baseProject({ locationCity: "大阪府大阪市", onsiteDaysPerWeek: 0, remoteLevel: "R4" }),
      baseEngineer({ residenceCity: "神奈川県川崎市" })
    );
    expect(r.warnings.some((w) => w.includes("通勤圏"))).toBe(false);
  });

  it("都道府県が読み取れない旧データ（市区町村のみ）では警告しない", () => {
    const r = score(
      baseProject({ locationCity: "千代田区" }),
      baseEngineer({ residenceCity: "川崎市" })
    );
    expect(r.warnings.some((w) => w.includes("通勤圏"))).toBe(false);
  });
});
