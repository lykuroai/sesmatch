// 分析・エクスポート（PRO版仕様書 §4.4）
//
// - 商談ファネル: 期間内の商談を送信側・受信側の別に、申込→承認→面談→契約の件数と転換率
// - 反応状況: 自社案件ごとの申込数・承認率・申込から承認までの平均日数、自社人材ごとの提案数・承認率
// - 市場単価レンジ（匿名統計）: 公開中案件の単価上限をスキル×都道府県で集計し、異常値（妥当範囲外・IQR 外れ値）を除いた上で母数5件未満のセルは出さない。
//   企業名・案件名・個別単価は出さない。人材側の希望単価は本人情報のため対象外
// - CSV エクスポート: 自社データのみ。相手側の情報は開示レベルに従う（未開示は匿名のまま）。
//   出力は保存せず都度生成し、監査ログに記録する

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/rbac";
import { normalizeSkillTerm, prefectureOf, REMOTE_LEVEL_LABELS } from "@/lib/constants";
import { toCsv } from "@/lib/csv";
import { listEntries } from "./entries";
import { listProjects } from "./projects";
import { listEngineers } from "./engineers";

// ---- 商談ファネル ----

export type FunnelEntry = {
  createdByOwn: boolean;
  createdAt: Date;
  status: string;
  disclosed: boolean;
  interviewed: boolean;
  contracted: boolean;
};
export type FunnelRow = { label: string; submitted: number; approved: number; interviewed: number; contracted: number };

const APPROVED_STATUSES = new Set(["MUTUALLY_APPROVED", "INTERVIEW", "CONDITIONS", "CONTRACTING", "CONTRACTED"]);
const INTERVIEWED_STATUSES = new Set(["INTERVIEW", "CONDITIONS", "CONTRACTING", "CONTRACTED"]);

// 純粋関数（テスト対象）
export function funnelFromEntries(entries: FunnelEntry[]): { sent: FunnelRow; received: FunnelRow; total: FunnelRow } {
  const row = (label: string, list: FunnelEntry[]): FunnelRow => ({
    label,
    submitted: list.length,
    approved: list.filter((e) => e.disclosed || APPROVED_STATUSES.has(e.status)).length,
    interviewed: list.filter((e) => e.interviewed || INTERVIEWED_STATUSES.has(e.status)).length,
    contracted: list.filter((e) => e.contracted || e.status === "CONTRACTED").length,
  });
  return {
    sent: row("自社から申込み", entries.filter((e) => e.createdByOwn)),
    received: row("他社から受信", entries.filter((e) => !e.createdByOwn)),
    total: row("合計", entries),
  };
}

export async function getFunnel(auth: AuthContext, range: { from: Date; to: Date }) {
  const entries = await prisma.entry.findMany({
    where: {
      OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }],
      createdAt: { gte: range.from, lt: range.to },
    },
    select: {
      createdByCompanyId: true,
      createdAt: true,
      status: true,
      disclosure: { select: { id: true } },
      interviews: { select: { id: true }, take: 1 },
      contract: { select: { status: true } },
    },
  });
  return funnelFromEntries(
    entries.map((e) => ({
      createdByOwn: e.createdByCompanyId === auth.companyId,
      createdAt: e.createdAt,
      status: e.status,
      disclosed: e.disclosure != null,
      interviewed: e.interviews.length > 0,
      contracted: e.contract != null && ["EXECUTED", "ACTIVE", "TERMINATED", "COMPLETED"].includes(e.contract.status),
    }))
  );
}

// ---- 反応状況（自社案件・自社人材ごと）----

export type ResponseRow = {
  id: string;
  code: string;
  name: string; // 案件名。人材は人材IDのみ（氏名は出さない）
  entries: number;
  approved: number;
  approvalRate: number | null; // 0〜1
  avgDaysToApproval: number | null; // 申込→双方承認の平均日数
};

function approvalDays(e: { createdAt: Date; supplyApprovedAt: Date | null; demandApprovedAt: Date | null }): number | null {
  if (!e.supplyApprovedAt || !e.demandApprovedAt) return null;
  const done = Math.max(e.supplyApprovedAt.getTime(), e.demandApprovedAt.getTime());
  return (done - e.createdAt.getTime()) / 86_400_000;
}

export function responseRows<T extends { id: string; code: string; name: string }>(
  targets: T[],
  entries: { targetId: string; createdAt: Date; supplyApprovedAt: Date | null; demandApprovedAt: Date | null }[]
): ResponseRow[] {
  return targets
    .map((t) => {
      const list = entries.filter((e) => e.targetId === t.id);
      const days = list.map(approvalDays).filter((d): d is number => d != null);
      const approved = days.length;
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        entries: list.length,
        approved,
        approvalRate: list.length > 0 ? approved / list.length : null,
        avgDaysToApproval: days.length > 0 ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.entries - a.entries || a.code.localeCompare(b.code));
}

export async function getResponseStats(auth: AuthContext, range: { from: Date; to: Date }) {
  const [projects, engineers, entries] = await Promise.all([
    prisma.project.findMany({ where: { tenantCompanyId: auth.companyId }, select: { id: true, code: true, name: true } }),
    prisma.engineer.findMany({ where: { tenantCompanyId: auth.companyId, deletedAt: null }, select: { id: true, code: true } }),
    prisma.entry.findMany({
      where: {
        OR: [{ demandCompanyId: auth.companyId }, { supplyCompanyId: auth.companyId }],
        createdAt: { gte: range.from, lt: range.to },
      },
      select: { projectId: true, engineerId: true, createdAt: true, supplyApprovedAt: true, demandApprovedAt: true },
    }),
  ]);
  return {
    projects: responseRows(
      projects,
      entries.map((e) => ({ targetId: e.projectId, ...e }))
    ).slice(0, 50),
    engineers: responseRows(
      engineers.map((e) => ({ ...e, name: "" })),
      entries.map((e) => ({ targetId: e.engineerId, ...e }))
    ).slice(0, 50),
  };
}

// ---- 市場単価レンジ（匿名統計）----

export const MARKET_MIN_SAMPLE = 5;
// 異常値の除外（2026-11-05 郭指示: 既存データをそのまま信用せず、入力ミス等の異常数値を取り除く）
// ① 妥当範囲: SES の月額単価として 20万〜300万円の外は入力ミスとみなして除外（桁違い・時給/年収の混入など）
// ② 四分位範囲（IQR）: 母数5件以上のセルで Q1−1.5×IQR 〜 Q3+1.5×IQR の外を外れ値として除外
// 表示は最小・最大ではなく 下位25%（Q1）・中央値・上位25%（Q3）。母数・閾値判定は除外後の件数で行う
export const MARKET_RATE_BOUNDS = { min: 200_000, max: 3_000_000 } as const;
export type MarketRateRow = {
  skill: string;
  prefecture: string;
  count: number; // 除外後の件数
  excluded: number; // 異常値として除外した件数
  q1Yen: number;
  medianYen: number;
  q3Yen: number;
};

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// 分位点（線形補間）。p=0.25 で下位25%、0.75 で上位25%
export function quantile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}

// 異常値を除いた単価の配列を返す（純粋関数）。妥当範囲外を除き、5件以上なら IQR 法でさらに外れ値を除く
export function removeRateOutliers(rates: number[]): { kept: number[]; excluded: number } {
  const inRange = rates.filter((r) => Number.isFinite(r) && r >= MARKET_RATE_BOUNDS.min && r <= MARKET_RATE_BOUNDS.max);
  let kept = inRange;
  if (inRange.length >= MARKET_MIN_SAMPLE) {
    const q1 = quantile(inRange, 0.25);
    const q3 = quantile(inRange, 0.75);
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    kept = inRange.filter((r) => r >= lower && r <= upper);
  }
  return { kept, excluded: rates.length - kept.length };
}

// 純粋関数: 案件（必須スキル名・勤務地・単価上限）をスキル×都道府県で集計し、異常値を除いた上で母数が閾値未満のセルを除く
export function aggregateMarketRates(
  projects: { requiredSkills: string[]; locationCity: string | null; rateMaxYen: number }[],
  minSample = MARKET_MIN_SAMPLE
): MarketRateRow[] {
  // スキル名は用語の正規化（小文字化・接尾辞除去）で名寄せし、表示名は最初に現れた表記を使う
  const cells = new Map<string, { skill: string; prefecture: string; rates: number[] }>();
  for (const p of projects) {
    const prefecture = prefectureOf(p.locationCity) ?? "全国・未指定";
    const seen = new Map<string, string>();
    for (const raw of p.requiredSkills) {
      const key = normalizeSkillTerm(raw);
      if (key && !seen.has(key)) seen.set(key, raw.trim());
    }
    for (const [normalized, display] of seen) {
      const key = `${normalized}\t${prefecture}`;
      const cell = cells.get(key) ?? { skill: display, prefecture, rates: [] };
      cell.rates.push(p.rateMaxYen);
      cells.set(key, cell);
    }
  }
  return [...cells.values()]
    .map((c) => ({ ...c, ...removeRateOutliers(c.rates) }))
    .filter((c) => c.kept.length >= minSample)
    .map((c) => ({
      skill: c.skill,
      prefecture: c.prefecture,
      count: c.kept.length,
      excluded: c.excluded,
      q1Yen: quantile(c.kept, 0.25),
      medianYen: median(c.kept),
      q3Yen: quantile(c.kept, 0.75),
    }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill) || a.prefecture.localeCompare(b.prefecture))
    .slice(0, 200);
}

export async function getMarketRates() {
  // プラットフォーム全体の公開中案件（自社・他社を問わない）。企業名・案件名は取得しない
  const projects = await prisma.project.findMany({
    where: { status: "PUBLISHED" },
    select: { locationCity: true, rateMaxYen: true, skills: { where: { required: true }, select: { name: true } } },
  });
  return {
    rows: aggregateMarketRates(
      projects.map((p) => ({ requiredSkills: p.skills.map((s) => s.name), locationCity: p.locationCity, rateMaxYen: p.rateMaxYen }))
    ),
    totalProjects: projects.length,
    minSample: MARKET_MIN_SAMPLE,
  };
}

// ---- CSV エクスポート ----

export type ExportKind = "projects" | "engineers" | "entries";

const fmtDate = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export async function exportCsv(auth: AuthContext, kind: ExportKind): Promise<{ filename: string; csv: string }> {
  let rows: (string | number | null | undefined)[][] = [];
  if (kind === "projects") {
    const { items } = await listProjects(auth, "own");
    rows = [
      ["案件ID", "案件名", "公開状態", "進行状態", "開始日", "終了日", "勤務地", "在宅区分", "週出社日数", "単価下限", "単価上限", "契約形態", "必須スキル", "尚可スキル", "工程", "業種", "登録日"],
      ...items.map((p) => [
        p.code, p.name, p.status, p.workflowStatus, fmtDate(p.startDate), fmtDate(p.endDate), p.locationCity,
        REMOTE_LEVEL_LABELS[p.remoteLevel] ?? p.remoteLevel, p.onsiteDaysPerWeek, p.rateMinYen, p.rateMaxYen, p.contractType,
        p.requiredSkills.map((s) => s.name).join(" / "), p.preferredSkills.map((s) => s.name).join(" / "),
        p.processes.join(" / "), p.industry, fmtDate(p.createdAt),
      ]),
    ];
  } else if (kind === "engineers") {
    // 氏名・実額単価は自社かつ engineer.read.pii 権限保持者にのみ出力（serializer が null にする）
    const { items } = await listEngineers(auth, "own");
    const pii = hasPermission(auth.roles, "engineer.read.pii");
    rows = [
      ["人材ID", ...(pii ? ["氏名", "希望単価"] : []), "年代", "所属区分", "公開状態", "稼働状況", "居住エリア", "稼働可能日", "単価帯", "在宅希望", "週出社上限", "スキル", "工程", "役割", "業種", "登録日"],
      ...items.map((e) => {
        const r = e as typeof e & { name?: string | null; desiredRateYen?: number | null };
        return [
          e.code, ...(pii ? [r.name ?? "", r.desiredRateYen ?? ""] : []), e.ageBand, e.affiliationType, e.status, e.workStatus,
          e.residenceCity, fmtDate(e.availableFrom), e.rateBand, REMOTE_LEVEL_LABELS[e.remotePreference] ?? e.remotePreference,
          e.maxOnsiteDaysPerWeek, e.skills.map((s) => `${s.name}${s.months != null ? `(${s.months}ヶ月)` : ""}`).join(" / "),
          e.processes.join(" / "), e.roles.join(" / "), e.industries.join(" / "), fmtDate(e.createdAt),
        ];
      }),
    ];
  } else {
    // 相手企業名は開示後（または PRO の掲載企業名表示）に限り serializer が返す。人材氏名は開示後のみ
    const items = (await listEntries(auth)).filter((e): e is NonNullable<typeof e> => e != null);
    rows = [
      ["商談ID", "種別", "立場", "状況", "案件ID", "案件名", "人材ID", "相手企業", "人材氏名（開示後）", "申込日", "更新日", "面談数", "契約状況"],
      ...items.map((e) => [
        e.id, e.type, e.side, e.status, e.project.code, e.project.name, e.engineer.code,
        e.counterpartCompanyName ?? "", e.disclosure?.engineerName ?? "", fmtDate(e.createdAt), fmtDate(e.updatedAt),
        e.interviews.length, e.contract?.status ?? "",
      ]),
    ];
  }
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "AnalyticsExported",
    targetType: "Export",
    targetId: kind,
    metadata: { rows: rows.length - 1 },
  });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return { filename: `${kind}_${stamp}.csv`, csv: toCsv(rows) };
}

// 期間指定（月数）→ from/to
export function rangeOfMonths(months: number, now = new Date()): { from: Date; to: Date } {
  const to = new Date(now.getTime() + 86_400_000);
  const from = new Date(now);
  from.setMonth(from.getMonth() - months);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}
