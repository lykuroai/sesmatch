// スキルシート再生成（PRO版仕様書 §4.7）
//
// - 確定済みの人材データから、自社書式のスキルシートを生成する（印刷用 HTML ページ＝PDF 保存、Excel）
// - 匿名版: Level 1 情報（人材ID、年代、スキル、経験、単価帯、勤務可能エリア）のみ。自社・他社人材とも生成可
// - 実名版: 氏名・実額単価を含む。自社人材は engineer.read.pii 保持者、他社人材は双方承認（Level 2 開示）済みの
//   商談がある場合に限る（開示スナップショットの氏名・実額を使う）
// - 生成物に性別・顔写真・国籍を含めない。出力は保存せず都度生成し、監査ログに「誰が・どの人材・匿名／実名」を記録する
//   （人材本人の氏名は監査ログに書かない）
// - テンプレート: 既定2種（標準・簡易）＋自社テンプレート3件/社（見出し・自社名表示・注記・表示項目）

import * as XLSX from "xlsx";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/rbac";
import { assertFeature } from "@/server/plan/features";
import { assertLimit } from "@/server/plan/limits";
import { AFFILIATION_LABELS, REMOTE_LEVEL_LABELS, SKILL_CATEGORY_LABELS } from "@/lib/constants";
import { getEngineer } from "./engineers";

export type SheetSections = { summary: boolean; skills: boolean; processes: boolean; roles: boolean; industries: boolean; conditions: boolean };
export type SheetTemplate = { id: string; name: string; title: string; showCompanyName: boolean; footerNote: string; sections: SheetSections; builtin: boolean };

const ALL_SECTIONS: SheetSections = { summary: true, skills: true, processes: true, roles: true, industries: true, conditions: true };
export const BUILTIN_TEMPLATES: SheetTemplate[] = [
  { id: "standard", name: "標準", title: "技術者経歴書", showCompanyName: true, footerNote: "本書は商談目的でのみ使用し、第三者への再提供・転載を禁じます。", sections: ALL_SECTIONS, builtin: true },
  { id: "simple", name: "簡易", title: "技術者概要", showCompanyName: false, footerNote: "", sections: { ...ALL_SECTIONS, roles: false, industries: false }, builtin: true },
];

export type SheetModel = {
  template: SheetTemplate;
  mode: "anonymous" | "named";
  companyName: string | null; // showCompanyName のとき
  generatedAt: Date;
  engineer: {
    code: string;
    name: string | null; // 実名版のみ
    ageBand: string;
    affiliation: string;
    residenceCity: string | null;
    availableFrom: string | null;
    rate: string; // 匿名: 単価帯 / 実名: 実額
    remote: string;
    maxOnsiteDaysPerWeek: number | null;
    summary: string;
    skills: { category: string; name: string; months: number | null }[];
    processes: string[];
    roles: string[];
    industries: string[];
  };
};

// ---- テンプレート ----

export async function listSheetTemplates(auth: AuthContext): Promise<SheetTemplate[]> {
  const own = await prisma.skillSheetTemplate.findMany({ where: { tenantCompanyId: auth.companyId }, orderBy: { createdAt: "asc" } });
  return [
    ...BUILTIN_TEMPLATES,
    ...own.map((t) => ({
      id: t.id,
      name: t.name,
      title: t.title,
      showCompanyName: t.showCompanyName,
      footerNote: t.footerNote,
      sections: { ...ALL_SECTIONS, ...(t.sections as Partial<SheetSections>) },
      builtin: false,
    })),
  ];
}

export type TemplateInput = { name: string; title: string; showCompanyName: boolean; footerNote: string; sections: Partial<SheetSections> };

export async function createSheetTemplate(auth: AuthContext, input: TemplateInput) {
  const gate = assertFeature(auth, "skill_sheet_render");
  if (gate) return gate;
  const current = await prisma.skillSheetTemplate.count({ where: { tenantCompanyId: auth.companyId } });
  const limit = assertLimit(auth.plan, "skill_sheet_templates", current);
  if (limit) return limit;
  const t = await prisma.skillSheetTemplate.create({
    data: {
      tenantCompanyId: auth.companyId,
      name: input.name.trim().slice(0, 50) || "自社テンプレート",
      title: input.title.trim().slice(0, 50) || "技術者経歴書",
      showCompanyName: input.showCompanyName,
      footerNote: input.footerNote.slice(0, 500),
      sections: { ...ALL_SECTIONS, ...input.sections },
    },
  });
  return { ok: true, id: t.id };
}

export async function updateSheetTemplate(auth: AuthContext, id: string, input: Partial<TemplateInput>) {
  const t = await prisma.skillSheetTemplate.findFirst({ where: { id, tenantCompanyId: auth.companyId } });
  if (!t) return { error: { code: "NOT_FOUND" as const } };
  await prisma.skillSheetTemplate.update({
    where: { id },
    data: {
      ...(input.name != null ? { name: input.name.trim().slice(0, 50) || t.name } : {}),
      ...(input.title != null ? { title: input.title.trim().slice(0, 50) || t.title } : {}),
      ...(input.showCompanyName != null ? { showCompanyName: input.showCompanyName } : {}),
      ...(input.footerNote != null ? { footerNote: input.footerNote.slice(0, 500) } : {}),
      ...(input.sections ? { sections: { ...ALL_SECTIONS, ...(t.sections as object), ...input.sections } } : {}),
    },
  });
  return { ok: true };
}

export async function deleteSheetTemplate(auth: AuthContext, id: string) {
  const t = await prisma.skillSheetTemplate.findFirst({ where: { id, tenantCompanyId: auth.companyId } });
  if (!t) return { error: { code: "NOT_FOUND" as const } };
  await prisma.skillSheetTemplate.delete({ where: { id } });
  return { ok: true };
}

// ---- 生成 ----

// 他社人材の実名版: 自社が当事者で Level 2 開示済みの商談があれば、その開示スナップショットの氏名・実額を使う
async function disclosedIdentity(auth: AuthContext, engineerId: string): Promise<{ name: string; rateYen: number | null } | null> {
  const entry = await prisma.entry.findFirst({
    where: {
      engineerId,
      OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }],
      disclosure: { isNot: null },
    },
    include: { disclosure: true },
    orderBy: { updatedAt: "desc" },
  });
  const payload = entry?.disclosure?.payload as { engineerName?: string; engineerRateYen?: number } | null | undefined;
  if (!payload?.engineerName) return null;
  return { name: payload.engineerName, rateYen: payload.engineerRateYen ?? null };
}

export async function buildSkillSheet(
  auth: AuthContext,
  engineerId: string,
  opts: { mode: "anonymous" | "named"; templateId: string; format: "html" | "xlsx" }
): Promise<SheetModel | { error: { code: string; message?: string } }> {
  const gate = assertFeature(auth, "skill_sheet_render");
  if (gate) return gate;
  const e = await getEngineer(auth, engineerId);
  if (!e) return { error: { code: "NOT_FOUND" } };
  const template = (await listSheetTemplates(auth)).find((t) => t.id === opts.templateId);
  if (!template) return { error: { code: "NOT_FOUND", message: "テンプレートが見つかりません" } };

  let name: string | null = null;
  let rate = e.rateBand;
  if (opts.mode === "named") {
    const r = e as typeof e & { name?: string; desiredRateYen?: number };
    if (e.own) {
      if (!hasPermission(auth.roles, "engineer.read.pii"))
        return { error: { code: "FORBIDDEN", message: "実名版の出力には engineer.read.pii 権限が必要です" } };
      name = r.name ?? null;
      if (r.desiredRateYen != null) rate = `${r.desiredRateYen.toLocaleString()}円`;
    } else {
      const d = await disclosedIdentity(auth, engineerId);
      if (!d) return { error: { code: "FORBIDDEN", message: "他社人材の実名版は双方承認（Level 2 開示）済みの商談がある場合のみ出力できます" } };
      name = d.name;
      if (d.rateYen != null) rate = `${d.rateYen.toLocaleString()}円`;
    }
  }
  const company = template.showCompanyName ? await prisma.company.findUnique({ where: { id: auth.companyId }, select: { name: true } }) : null;
  const model: SheetModel = {
    template,
    mode: opts.mode,
    companyName: company?.name ?? null,
    generatedAt: new Date(),
    engineer: {
      code: e.code,
      name,
      ageBand: e.ageBand,
      affiliation: AFFILIATION_LABELS[e.affiliationType] ?? e.affiliationType,
      residenceCity: e.residenceCity,
      availableFrom: e.availableFrom ? new Date(e.availableFrom).toISOString().slice(0, 10) : null,
      rate,
      remote: REMOTE_LEVEL_LABELS[e.remotePreference] ?? e.remotePreference,
      maxOnsiteDaysPerWeek: e.maxOnsiteDaysPerWeek,
      summary: e.summary ?? "",
      skills: e.skills.map((s) => ({ category: SKILL_CATEGORY_LABELS[s.category] ?? s.category, name: s.name, months: s.months })),
      processes: e.processes,
      roles: e.roles,
      industries: e.industries,
    },
  };
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "SkillSheetRendered",
    targetType: "Engineer",
    targetId: engineerId,
    metadata: { mode: opts.mode, format: opts.format, template: template.builtin ? template.id : "custom" },
  });
  return model;
}

// Excel 出力（1シート）。純粋関数（テスト対象）
export function sheetToWorkbookRows(m: SheetModel): (string | number | null)[][] {
  const s = m.template.sections;
  const en = m.engineer;
  const rows: (string | number | null)[][] = [];
  rows.push([m.template.title]);
  if (m.companyName) rows.push(["提出元", m.companyName]);
  rows.push(["作成日", m.generatedAt.toISOString().slice(0, 10)]);
  rows.push([]);
  rows.push(["人材ID", en.code]);
  if (en.name) rows.push(["氏名", en.name]);
  rows.push(["年代", en.ageBand]);
  rows.push(["所属区分", en.affiliation]);
  if (s.conditions) {
    rows.push([m.mode === "named" ? "希望単価" : "単価帯", en.rate]);
    rows.push(["居住エリア", en.residenceCity ?? ""]);
    rows.push(["稼働可能日", en.availableFrom ?? "即日"]);
    rows.push(["在宅希望", en.remote]);
    rows.push(["週出社上限", en.maxOnsiteDaysPerWeek != null ? `${en.maxOnsiteDaysPerWeek}日` : ""]);
  }
  if (s.summary) {
    rows.push([]);
    rows.push(["概要"]);
    rows.push([en.summary]);
  }
  if (s.skills) {
    rows.push([]);
    rows.push(["スキル", "分類", "経験月数"]);
    for (const sk of en.skills) rows.push([sk.name, sk.category, sk.months]);
  }
  if (s.processes) rows.push([], ["工程", en.processes.join(" / ")]);
  if (s.roles) rows.push(["役割", en.roles.join(" / ")]);
  if (s.industries) rows.push(["業種経験", en.industries.join(" / ")]);
  if (m.template.footerNote) rows.push([], [m.template.footerNote]);
  return rows;
}

export function renderXlsx(m: SheetModel): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(sheetToWorkbookRows(m));
  ws["!cols"] = [{ wch: 28 }, { wch: 40 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "スキルシート");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
