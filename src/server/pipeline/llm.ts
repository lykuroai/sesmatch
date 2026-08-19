// LLMゲートウェイ（§25）
// LLM には匿名化済みテキストのみを渡す。実装差し替え可能なインターフェースとし、
// MVP では辞書・正規表現ベースのモック実装を提供する。
// 本番実装では Claude API 等（ゼロデータ保持・学習オプトアウト契約 §25.4）に置き換える。

import { z } from "zod";

export const engineerDraftSchema = z.object({
  kind: z.literal("ENGINEER_SHEET"),
  // 氏名（2026-08-19: LLM送信禁止の全面撤廃により抽出対象。確認画面で人手確定。
  // 過去の抽出結果には存在しないため default で後方互換）
  name: z.string().nullable().default(null),
  // 所属区分（§12）: 文書から判断できない場合は null（確定時は自社所属が既定）
  affiliationType: z.enum(["EMPLOYEE", "AFFILIATED", "FREELANCER", "SUBTIER1"]).nullable(),
  ageBand: z.number().int().min(20).max(70).nullable(),
  // 国籍（国名。例: 韓国）。記載がなければ null＝日本国籍とみなす。国名不明の「外国籍」記載は "外国籍"
  // （過去の抽出結果には存在しないため default で後方互換）
  nationality: z.string().nullable().default(null),
  residenceCity: z.string().nullable(),
  availableFrom: z.string().nullable(), // ISO date
  desiredRateYen: z.number().int().nullable(),
  maxOnsiteDaysPerWeek: z.number().int().min(0).max(5).nullable(),
  skills: z.array(
    z.object({
      // PROCESS/INDUSTRY は LLM の抽出対象ではないが、確認画面での人手入力を受け付ける
      category: z.enum([
        "LANGUAGE",
        "FRAMEWORK",
        "DATABASE",
        "CLOUD",
        "OS",
        "TOOL",
        "CERTIFICATION",
        "PROCESS",
        "INDUSTRY",
      ]),
      name: z.string(),
      // 明記があればその値。明記がなければ経歴欄（プロジェクト期間×使用技術）から合算推定し
      // monthsEstimated=true とする。経歴からも判断できない場合のみ null
      months: z.number().int().min(0).nullable(),
      monthsEstimated: z.boolean().optional().default(false), // true=経歴からの推定値（人手確認で修正対象）
    })
  ),
  processes: z.array(z.string()),
  // 役割・業種経験（過去の抽出結果には存在しないため default で後方互換）
  roles: z.array(z.string()).default([]), // PM/PMO/PL/テックリード等
  industries: z.array(z.string()).default([]), // 金融/製造/EC等
  summary: z.string(),
});

export const projectDraftSchema = z.object({
  kind: z.literal("PROJECT_DESCRIPTION"),
  name: z.string().nullable(),
  startDate: z.string().nullable(),
  rateMaxYen: z.number().int().nullable(),
  onsiteDaysPerWeek: z.number().int().min(0).max(5).nullable(),
  // 勤務地（都道府県から記載。例: 東京都中野区）。.default(null) は既存の抽出結果との互換のため
  locationCity: z.string().nullable().default(null),
  // 外国籍不可の受入条件（true=不可 / false=可と明記 / null=記載なし）。
  // .default(null) は既存の抽出結果（この項目が無い保存済みJSON）を確定できるようにするため
  noForeignNational: z.boolean().nullable().default(null),
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  summary: z.string(),
});

export type EngineerDraft = z.infer<typeof engineerDraftSchema>;
export type ProjectDraft = z.infer<typeof projectDraftSchema>;
export type ExtractionDraft = EngineerDraft | ProjectDraft;

// 用語辞書の候補提案（Phase 2 名寄せ）: 新語の正規形候補。判定には使わず辞書登録の材料のみ
export const termProposalSchema = z.object({
  proposals: z.array(z.object({ term: z.string(), canonical: z.string() })),
});

export interface LlmGateway {
  classify(maskedText: string): Promise<"ENGINEER_SHEET" | "PROJECT_DESCRIPTION" | "UNKNOWN">;
  extract(maskedText: string, kind: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION"): Promise<ExtractionDraft>;
  // 新語（terms）の正規形候補を提案する。既存の正規形（canonicals）に同義があればそれへ寄せる
  proposeCanonicalTerms(terms: string[], canonicals: string[]): Promise<{ term: string; canonical: string }[]>;
}

// ---- モック実装 ----

const SKILL_DICT: { name: string; category: EngineerDraft["skills"][number]["category"]; aliases?: string[] }[] = [
  { name: "Java", category: "LANGUAGE" },
  { name: "TypeScript", category: "LANGUAGE", aliases: ["TS"] },
  { name: "JavaScript", category: "LANGUAGE", aliases: ["JS"] },
  { name: "Python", category: "LANGUAGE" },
  { name: "Go", category: "LANGUAGE", aliases: ["Golang"] },
  { name: "C#", category: "LANGUAGE" },
  { name: "PHP", category: "LANGUAGE" },
  { name: "Ruby", category: "LANGUAGE" },
  { name: "React", category: "FRAMEWORK" },
  { name: "Next.js", category: "FRAMEWORK" },
  { name: "Vue.js", category: "FRAMEWORK", aliases: ["Vue"] },
  { name: "Spring Boot", category: "FRAMEWORK", aliases: ["Spring"] },
  { name: "Rails", category: "FRAMEWORK", aliases: ["Ruby on Rails"] },
  { name: "Laravel", category: "FRAMEWORK" },
  { name: ".NET", category: "FRAMEWORK" },
  { name: "PostgreSQL", category: "DATABASE", aliases: ["Postgres"] },
  { name: "MySQL", category: "DATABASE" },
  { name: "Oracle", category: "DATABASE" },
  { name: "SQL Server", category: "DATABASE" },
  { name: "AWS", category: "CLOUD" },
  { name: "Azure", category: "CLOUD" },
  { name: "GCP", category: "CLOUD" },
  { name: "Linux", category: "OS" },
  { name: "Docker", category: "TOOL" },
  { name: "Kubernetes", category: "TOOL", aliases: ["k8s"] },
];

const PROCESSES = ["要件定義", "基本設計", "詳細設計", "開発", "テスト", "運用", "保守"];

function findSkills(text: string) {
  const found: {
    name: string;
    category: EngineerDraft["skills"][number]["category"];
    months: number;
    monthsEstimated: boolean;
  }[] = [];
  for (const s of SKILL_DICT) {
    const names = [s.name, ...(s.aliases ?? [])];
    const hit = names.find((n) => text.toLowerCase().includes(n.toLowerCase()));
    if (!hit) continue;
    // 「Java 5年」「Java（36ヶ月）」等から経験期間を推定
    const near = new RegExp(
      `${hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,20}?(?:(\\d+)\\s*年|(\\d+)\\s*ヶ?月)`,
      "i"
    );
    const m = text.match(near);
    const months = m ? (m[1] ? parseInt(m[1]) * 12 : parseInt(m[2])) : 12;
    found.push({ name: s.name, category: s.category, months, monthsEstimated: !m });
  }
  return found;
}

export class MockLlmGateway implements LlmGateway {
  async classify(maskedText: string) {
    const engineerHints = ["スキルシート", "経歴", "氏名", "稼働可能", "希望単価"];
    const projectHints = ["案件", "募集", "単価上限", "商流", "面談"];
    const eScore = engineerHints.filter((h) => maskedText.includes(h)).length;
    const pScore = projectHints.filter((h) => maskedText.includes(h)).length;
    if (eScore === 0 && pScore === 0) return "UNKNOWN" as const;
    return eScore >= pScore ? ("ENGINEER_SHEET" as const) : ("PROJECT_DESCRIPTION" as const);
  }

  async extract(maskedText: string, kind: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION") {
    const rateM = maskedText.match(/(\d{2,3})\s*万/);
    const rateYen = rateM ? parseInt(rateM[1]) * 10_000 : null;
    const onsiteM = maskedText.match(/週\s*(\d)\s*日?\s*出社/);
    const dateM = maskedText.match(/(\d{4})[年/\-](\d{1,2})[月/\-]?(\d{1,2})?/);
    const isoDate = dateM
      ? `${dateM[1]}-${String(dateM[2]).padStart(2, "0")}-${String(dateM[3] ?? "1").padStart(2, "0")}`
      : null;
    const skills = findSkills(maskedText);
    const processes = PROCESSES.filter((p) => maskedText.includes(p));

    if (kind === "ENGINEER_SHEET") {
      const ageM = maskedText.match(/(\d{2})\s*[歳代]/);
      const age = ageM ? Math.floor(parseInt(ageM[1]) / 5) * 5 : null;
      const cityM = maskedText.match(/(?:居住|住まい|在住)[^\n]*?([^\s　、。]+?[市区町村])/);
      // 国籍: 「国籍：ベトナム」「韓国籍」等から国名を抽出。「外国籍」のみで国名不明なら "外国籍"
      const natLabeled = maskedText.match(/国籍[:：][\s　]*([一-龥ァ-ヶーA-Za-z]{1,15})/);
      const natSuffix = maskedText.match(/([一-龥]{1,3}国|[ァ-ヶーA-Za-z]{2,15})籍/);
      const nationality = natLabeled
        ? natLabeled[1]
        : natSuffix
          ? natSuffix[1] === "外国"
            ? "外国籍"
            : natSuffix[1]
          : null;
      // 氏名: ラベル付き記載（同一行・表レイアウトの単独行の両方）から抽出（§25.2 撤廃後は原文が入力）
      const nameSame = maskedText.match(
        /(?:氏[ 　]{0,2}名|名[ 　]{0,2}前)\s*[:：,，\t 　]+\s*([一-龥ぁ-んァ-ヶーA-Za-z]{1,12}(?:[ 　][一-龥ぁ-んァ-ヶーA-Za-z]{1,12})?)/
      );
      const nameLine = maskedText.match(
        /(?:^|\n)(?:氏[ 　]{0,2}名|名[ 　]{0,2}前)[ 　]*\n{1,3}[ 　]*([一-龥ぁ-んァ-ヶーA-Za-z]{1,12}(?:[ 　][一-龥ぁ-んァ-ヶーA-Za-z]{1,12})?)(?=[ 　]*(?:\n|$))/
      );
      const draft: EngineerDraft = {
        kind: "ENGINEER_SHEET",
        name: nameSame?.[1] ?? nameLine?.[1] ?? null,
        affiliationType: /個人事業主|フリーランス/.test(maskedText)
          ? "FREELANCER"
          : /正社員|自社社員/.test(maskedText)
            ? "EMPLOYEE"
            : null,
        ageBand: age,
        nationality,
        residenceCity: cityM ? cityM[1] : null,
        availableFrom: isoDate,
        desiredRateYen: rateYen,
        maxOnsiteDaysPerWeek: onsiteM ? parseInt(onsiteM[1]) : null,
        skills,
        processes,
        roles: [],
        industries: [],
        summary: maskedText.slice(0, 200),
      };
      return engineerDraftSchema.parse(draft);
    }

    const nameM = maskedText.match(/(?:案件名|件名)[:：]\s*([^\n]+)/);
    const locM = maskedText.match(/(?:勤務地|勤務場所|作業場所|場所)[:：]?[\s　]*([^\n（(]+)/);
    // 外国籍の受入条件: 「外国籍：不可」「外国人NG」「日本国籍のみ」等 → 不可。
    // 「不可」が「可」を含むため、不可の判定を先に行う
    const noForeignNational = /外国[籍人][^\n]{0,10}(不可|NG|ＮＧ|×|✕|ご遠慮)|日本国籍(の方)?のみ|日本人のみ/.test(maskedText)
      ? true
      : /外国[籍人][^\n]{0,10}(可|OK|ＯＫ|歓迎)/.test(maskedText)
        ? false
        : null;
    const draft: ProjectDraft = {
      kind: "PROJECT_DESCRIPTION",
      name: nameM ? nameM[1].trim() : null,
      startDate: isoDate,
      rateMaxYen: rateYen,
      onsiteDaysPerWeek: onsiteM ? parseInt(onsiteM[1]) : null,
      locationCity: locM ? locM[1].trim() : null,
      noForeignNational,
      requiredSkills: skills.map((s) => s.name),
      preferredSkills: [],
      summary: maskedText.slice(0, 200),
    };
    return projectDraftSchema.parse(draft);
  }

  // モックは辞書候補を提案しない（接尾辞正規化のみで運用）
  async proposeCanonicalTerms(): Promise<{ term: string; canonical: string }[]> {
    return [];
  }
}

// 実装の選択（優先順）:
// 1. LLM_BASE_URL — OpenAI 互換 API（chat/completions。LLM_MODEL / LLM_API_KEY と併用）
// 2. ANTHROPIC_API_KEY — Claude API（構造化出力）
// 3. どちらもなければ正規表現ベースのモック
// 循環参照を避けるため動的 import + 遅延初期化とする。
let gateway: LlmGateway | null = null;

export function getLlmGateway(): LlmGateway {
  if (!gateway) {
    if (process.env.LLM_BASE_URL) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { OpenAiCompatGateway } = require("./llm-openai") as typeof import("./llm-openai");
      gateway = new OpenAiCompatGateway();
    } else if (process.env.ANTHROPIC_API_KEY) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ClaudeLlmGateway } = require("./llm-claude") as typeof import("./llm-claude");
      gateway = new ClaudeLlmGateway();
    } else {
      gateway = new MockLlmGateway();
    }
  }
  return gateway;
}

export const llmGateway: LlmGateway = {
  classify: (text) => getLlmGateway().classify(text),
  extract: (text, kind) => getLlmGateway().extract(text, kind),
  proposeCanonicalTerms: (terms, canonicals) =>
    getLlmGateway().proposeCanonicalTerms(terms, canonicals),
};
