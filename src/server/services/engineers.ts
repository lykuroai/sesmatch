import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/rbac";
import { ageBandLabel, rateBand, remoteLevelToOnsiteDays, LIST_PAGE_SIZE } from "@/lib/constants";
import { expandSearchTerms, registerNewTermAliases } from "./skill-aliases";
import { STORAGE_DIR, truncateFilenameBytes } from "@/server/pipeline/ingest";
import { extractDocumentText, isSkillSheetFile } from "@/server/pipeline/extract-text";
import { maskPii, verifyMasked } from "@/server/pipeline/pii";
import { llmGateway } from "@/server/pipeline/llm";
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import type { Engineer, EngineerSkill, PersonConsent } from "@prisma/client";

// 外国籍か（国名の明記があり日本以外なら外国籍。未指定は日本国籍とみなす）
export function isForeignNationality(nationality: string | null | undefined): boolean {
  const n = (nationality ?? "").trim().toLowerCase();
  return n !== "" && !["日本", "日本国", "japan", "jp"].includes(n);
}

export function hasValidConsent(consents: PersonConsent[]): boolean {
  const now = new Date();
  return consents.some(
    (c) => !c.revokedAt && (!c.validUntil || c.validUntil >= now)
  );
}

type EngineerWithRels = Engineer & { skills: EngineerSkill[]; consents: PersonConsent[] };

// 開示レベルに応じたシリアライズ（§10）
// Level 1: 人材ID・年代・技術・経験・稼働日・10万円幅単価帯・エリア
// 自社かつ engineer.read.pii を持つ場合のみ氏名・実額単価を返す
export function serializeEngineer(e: EngineerWithRels, auth: AuthContext) {
  const own = e.tenantCompanyId === auth.companyId;
  const canPii = own && hasPermission(auth.roles, "engineer.read.pii");
  return {
    id: e.id,
    code: e.code,
    own,
    ageBand: ageBandLabel(e.ageBand),
    affiliationType: e.affiliationType,
    residenceCity: e.residenceCity,
    nearestStation: own ? e.nearestStation : null,
    availableFrom: e.availableFrom,
    availabilityRate: e.availabilityRate,
    rateBand: rateBand(e.desiredRateYen),
    maxOnsiteDaysPerWeek: e.maxOnsiteDaysPerWeek,
    remotePreference: e.remotePreference,
    travelOk: e.travelOk,
    status: e.status,
    workStatus: e.workStatus,
    summary: e.summary,
    processes: e.processes,
    roles: e.roles,
    industries: e.industries,
    skills: e.skills.map((s) => ({
      category: s.category,
      name: s.name,
      months: s.months,
      lastUsedAt: s.lastUsedAt,
    })),
    hasValidConsent: hasValidConsent(e.consents),
    workAuthStatus: own ? e.workAuthStatus : undefined,
    nationality: own ? e.nationality : undefined, // 国籍は自社のみ表示（未指定=日本国籍）
    foreignNational: isForeignNationality(e.nationality), // マッチ条件表示用
    maskedSourceText: own ? e.maskedSourceText : undefined, // 取込時の匿名化済み原文（自社のみ）
    // ---- Level 2 相当（自社 + PII権限のみ）----
    name: canPii ? e.name : undefined,
    desiredRateYen: canPii ? e.desiredRateYen : undefined,
  };
}

// page 指定時は 50件/ページでページングし、未指定時は全件を返す（詳細画面の候補選択用）
export async function listEngineers(
  auth: AuthContext,
  scope: "own" | "public",
  query?: string,
  page?: number
) {
  const base =
    scope === "own"
      ? { tenantCompanyId: auth.companyId, deletedAt: null }
      : // 公開人材検索: 他社の公開済み人材（Level 1 匿名表示）
        { status: "PUBLISHED" as const, deletedAt: null, NOT: { tenantCompanyId: auth.companyId } };
  // キーワード検索: コード・概要・スキル名・居住エリア・工程/役割/業種。
  // 氏名（PII）は自社スコープのみ対象（他社の匿名人材を氏名で探索できないようにする）。
  // スキル・工程/役割/業種は用語辞書で検索語を同義語群に展開して照合する（名寄せ検索）
  const q = query?.trim();
  const terms = q ? await expandSearchTerms(q) : [];
  const search = q
    ? {
        OR: [
          { code: { contains: q, mode: "insensitive" as const } },
          { summary: { contains: q, mode: "insensitive" as const } },
          { residenceCity: { contains: q, mode: "insensitive" as const } },
          ...terms.map((t) => ({
            skills: { some: { name: { contains: t, mode: "insensitive" as const } } },
          })),
          { processes: { hasSome: terms } },
          { roles: { hasSome: terms } },
          { industries: { hasSome: terms } },
          ...(scope === "own" ? [{ name: { contains: q, mode: "insensitive" as const } }] : []),
        ],
      }
    : {};
  // 同意なしは公開検索に出さない（hasValidConsent と同じ条件を where で表現し、件数と整合させる）
  const consentFilter =
    scope === "public"
      ? {
          consents: {
            some: {
              revokedAt: null,
              OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
            },
          },
        }
      : {};
  const where = { ...base, ...search, ...consentFilter };
  const [total, engineers] = await Promise.all([
    prisma.engineer.count({ where }),
    prisma.engineer.findMany({
      where,
      include: { skills: true, consents: true },
      orderBy: { createdAt: "desc" },
      ...(page ? { skip: (page - 1) * LIST_PAGE_SIZE, take: LIST_PAGE_SIZE } : {}),
    }),
  ]);
  return { items: engineers.map((e) => serializeEngineer(e, auth)), total };
}

export async function getEngineer(auth: AuthContext, id: string) {
  const e = await prisma.engineer.findUnique({
    where: { id },
    include: { skills: true, consents: true, skillSheetDocument: { select: { filename: true } } },
  });
  // 他テナントの非公開データは 404 相当（存在推測を防ぐ §29）
  if (!e) return null;
  if (e.deletedAt && e.tenantCompanyId !== auth.companyId) return null; // 論理削除済み（§26）
  if (e.tenantCompanyId !== auth.companyId && e.status !== "PUBLISHED") return null;
  return {
    ...serializeEngineer(e, auth),
    // 職務経歴書（原本・PII含む）: 自社のみファイル名を返す。取得はPII権限で別途制御
    skillSheetFilename:
      e.tenantCompanyId === auth.companyId ? (e.skillSheetDocument?.filename ?? null) : null,
  };
}

// 職務経歴書（スキルシート）の添付・差し替え。原本は取込と同じストレージに保存し
// SourceDocument として管理する（PII を含むため LLM には送らない）
export async function attachSkillSheet(
  auth: AuthContext,
  engineerId: string,
  file: { filename: string; mimeType: string; content: Buffer }
) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null }, // テナント分離
    include: { skills: true },
  });
  if (!engineer) return { error: { code: "NOT_FOUND" as const } };
  if (!isSkillSheetFile(file.filename))
    return {
      error: {
        code: "VALIDATION_ERROR" as const,
        message: "職務経歴書は Excel・Word・PDF のファイルを添付してください",
      },
    };
  if (file.content.length > 10 * 1024 * 1024)
    return { error: { code: "VALIDATION_ERROR" as const, message: "ファイルは10MB以下にしてください" } };

  await mkdir(path.join(STORAGE_DIR, auth.companyId), { recursive: true });
  const storagePath = path.join(
    STORAGE_DIR,
    auth.companyId,
    `${Date.now()}_${truncateFilenameBytes(file.filename, 180)}`
  );
  await writeFile(storagePath, file.content);
  const doc = await prisma.sourceDocument.create({
    data: {
      tenantCompanyId: auth.companyId,
      kind: "ENGINEER_SHEET",
      filename: file.filename,
      storagePath,
      mimeType: file.mimeType,
      size: file.content.length,
      uploadedByMemberId: auth.memberId,
    },
  });
  await prisma.engineer.update({
    where: { id: engineer.id },
    data: { skillSheetDocumentId: doc.id },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "SkillSheetAttached",
    targetType: "Engineer",
    targetId: engineer.id,
    metadata: { size: file.content.length }, // ファイル名は氏名を含みうるため監査ログに残さない
  });

  const result = await extractSheetIntoEngineer(
    auth,
    engineer,
    doc.id,
    file.filename,
    file.content,
    false // 添付時は控えめに反映（既存の入力を上書きしない）
  );
  return { ok: true as const, documentId: doc.id, ...result };
}

// 添付済みの職務経歴書から再抽出（人材編集の「更新する」時に選択可）。
// 保存済みの原本ファイルを読み直して抽出・反映する（ファイルの再アップロード不要）
export async function reExtractSkillSheet(auth: AuthContext, engineerId: string) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null }, // テナント分離
    include: { skills: true, skillSheetDocument: true },
  });
  if (!engineer) return { error: { code: "NOT_FOUND" as const } };
  if (!engineer.skillSheetDocument)
    return { error: { code: "VALIDATION_ERROR" as const, message: "職務経歴書が添付されていません" } };
  const content = await readFile(engineer.skillSheetDocument.storagePath).catch(() => null);
  if (!content)
    return { error: { code: "NOT_FOUND" as const, message: "原本ファイルが見つかりません" } };
  const result = await extractSheetIntoEngineer(
    auth,
    engineer,
    engineer.skillSheetDocument.id,
    engineer.skillSheetDocument.filename,
    content,
    true // 明示的な再抽出では経験月数を推定値で上書きする（誤った月数の修正手段）
  );
  return { ok: true as const, ...result };
}

// 経歴書の内容をマッチングへ反映: テキスト抽出 → PII匿名化 → LLM正規化 → 不足スキルの追加。
// 既存スキルは上書きせず、未登録スキルの追加と経験月数0の補完のみ行う（担当者の入力を正とする）
async function extractSheetIntoEngineer(
  auth: AuthContext,
  engineer: Engineer & { skills: EngineerSkill[] },
  docId: string,
  filename: string,
  content: Buffer,
  overwriteMonths: boolean // true=再抽出: 既存スキルの月数を抽出値で上書き / false=添付: 月数0のみ補完
) {
  let addedSkills = 0;
  let updatedMonths = 0;
  let extractWarning: string | null = null;
  try {
    const text = await extractDocumentText(filename, content);
    const { masked, tokens } = maskPii(text);
    // 再抽出時の重複を避けるため置換表は入れ替える
    await prisma.piiTokenMap.deleteMany({ where: { sourceDocumentId: docId } });
    if (tokens.length > 0) {
      await prisma.piiTokenMap.createMany({
        data: tokens.map((t) => ({
          sourceDocumentId: docId,
          token: t.token,
          originalValue: t.originalValue,
          kind: t.kind,
        })),
      });
    }
    const check = verifyMasked(masked);
    if (!check.ok) throw new Error("匿名化検査で残存PIIを検出したため内容反映を中止しました");
    const extracted = await llmGateway.extract(masked, "ENGINEER_SHEET");
    if (extracted.kind === "ENGINEER_SHEET") {
      const existing = new Map(engineer.skills.map((s) => [s.name.trim().toLowerCase(), s]));
      for (const s of extracted.skills) {
        const key = s.name.trim().toLowerCase();
        const cur = existing.get(key);
        if (!cur) {
          // LLM が同名スキルを重複して返すことがあるため、作成分もマップに登録して一意制約違反を防ぐ
          const created = await prisma.engineerSkill.create({
            data: {
              engineerId: engineer.id,
              name: s.name,
              category: s.category,
              months: s.months ?? 0,
            },
          });
          existing.set(key, created);
          addedSkills++;
        } else if (
          (s.months ?? 0) > 0 &&
          (overwriteMonths ? cur.months !== s.months : cur.months === 0)
        ) {
          await prisma.engineerSkill.update({
            where: { id: cur.id },
            data: { months: s.months! },
          });
          existing.set(key, { ...cur, months: s.months! });
          updatedMonths++;
        }
      }
      // 用語辞書の自動増補（Phase 2 名寄せ）: 新語の正規形をLLMが提案し辞書へ登録（失敗しても添付は成立）
      await registerNewTermAliases(
        [
          ...extracted.skills.map((s) => s.name),
          ...extracted.processes,
          ...extracted.roles,
          ...extracted.industries,
        ],
        auth.companyId
      );
      // 工程・業種経験もスキルとして追加する（必須スキル判定・検索で使えるように。重複名は除外）
      for (const extra of [
        ...extracted.processes.map((name) => ({ name, category: "PROCESS" as const })),
        ...extracted.industries.map((name) => ({ name, category: "INDUSTRY" as const })),
      ]) {
        const key = extra.name.trim().toLowerCase();
        if (!key || existing.has(key)) continue;
        const created = await prisma.engineerSkill.create({
          data: { engineerId: engineer.id, name: extra.name, category: extra.category, months: 0 },
        });
        existing.set(key, created);
        addedSkills++;
      }
      // プロフィール項目も未入力の場合のみ経歴書から補完する（入力済みは上書きしない）
      const profile: Record<string, unknown> = {};
      if (!engineer.residenceCity && extracted.residenceCity)
        profile.residenceCity = extracted.residenceCity;
      if (engineer.processes.length === 0 && extracted.processes.length > 0)
        profile.processes = extracted.processes;
      if (engineer.roles.length === 0 && extracted.roles.length > 0)
        profile.roles = extracted.roles;
      if (engineer.industries.length === 0 && extracted.industries.length > 0)
        profile.industries = extracted.industries;
      if (!engineer.summary && extracted.summary) profile.summary = extracted.summary;
      if (!engineer.maskedSourceText) profile.maskedSourceText = masked;
      if (Object.keys(profile).length > 0) {
        await prisma.engineer.update({ where: { id: engineer.id }, data: profile });
      }
      await audit({
        tenantCompanyId: auth.companyId,
        actorUserId: auth.userAccountId,
        action: "SkillSheetExtracted",
        targetType: "Engineer",
        targetId: engineer.id,
        metadata: { addedSkills, updatedMonths, filledFields: Object.keys(profile) },
      });
    }
  } catch (e) {
    // 抽出失敗でも添付自体は成立させる（内容反映のみスキップ）。原因調査用に監査ログへ記録
    extractWarning = e instanceof Error ? e.message : String(e);
    await audit({
      tenantCompanyId: auth.companyId,
      actorUserId: auth.userAccountId,
      action: "SkillSheetExtractFailed",
      targetType: "Engineer",
      targetId: engineer.id,
      metadata: { message: extractWarning.slice(0, 300) },
    });
  }

  return { addedSkills, updatedMonths, extractWarning };
}

// 職務経歴書のダウンロード（自社 + engineer.read.pii のみ。呼び出し側で権限確認済み）
export async function getSkillSheetFile(auth: AuthContext, engineerId: string) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId }, // テナント分離
    include: { skillSheetDocument: true },
  });
  if (!engineer?.skillSheetDocument) return null;
  const doc = engineer.skillSheetDocument;
  const content = await readFile(doc.storagePath).catch(() => null);
  if (!content) return null;
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "SkillSheetDownloaded",
    targetType: "Engineer",
    targetId: engineer.id,
  });
  return { filename: doc.filename, mimeType: doc.mimeType, content };
}

export type EngineerInput = {
  name: string;
  ageBand: number;
  affiliationType: "EMPLOYEE" | "AFFILIATED" | "FREELANCER" | "SUBTIER1";
  residenceCity?: string;
  nearestStation?: string;
  nationality?: string; // 国籍（国名。未指定は日本国籍とみなす）
  availableFrom?: string;
  availabilityRate?: number;
  desiredRateYen: number;
  commuteMaxMinutes?: number;
  maxOnsiteDaysPerWeek?: number;
  remotePreference?: "R0" | "R1" | "R2" | "R3" | "R4" | "R5";
  travelOk?: boolean;
  summary?: string;
  processes?: string[];
  roles?: string[];
  industries?: string[];
  skills?: { category: string; name: string; months: number; lastUsedAt?: string }[];
};

// 表示用コードの採番: システム全体の最大番号+1（企業をまたいで一意。件数方式だと物理削除で
// 番号が詰まり既存コードと衝突する）。形式は E+6桁（例: E000001）
async function nextEngineerCode(): Promise<string> {
  const rows = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(code FROM '[0-9]+$') AS INTEGER)) AS max
    FROM engineers WHERE code ~ '^E-?[0-9]+$'`;
  return `E${String(Number(rows[0]?.max ?? 0) + 1).padStart(6, "0")}`;
}

export async function createEngineer(auth: AuthContext, input: EngineerInput) {
  const code = await nextEngineerCode();
  const engineer = await prisma.engineer.create({
    data: {
      tenantCompanyId: auth.companyId,
      code,
      createdByMemberId: auth.memberId,
      name: input.name,
      ageBand: input.ageBand,
      affiliationType: input.affiliationType,
      residenceCity: input.residenceCity,
      nationality: input.nationality?.trim() || null,
      nearestStation: input.nearestStation,
      availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
      availabilityRate: input.availabilityRate ?? 100,
      desiredRateYen: input.desiredRateYen,
      commuteMaxMinutes: input.commuteMaxMinutes,
      // 週最大出社日数は許容出社条件と連動（未指定時は許容出社条件から導出）
      maxOnsiteDaysPerWeek:
        input.maxOnsiteDaysPerWeek ?? remoteLevelToOnsiteDays(input.remotePreference ?? "R0"),
      remotePreference: input.remotePreference ?? "R0",
      travelOk: input.travelOk ?? false,
      summary: input.summary ?? "",
      processes: input.processes ?? [],
      roles: input.roles ?? [],
      industries: input.industries ?? [],
      skills: {
        create: (input.skills ?? []).map((s) => ({
          category: s.category as never,
          name: s.name,
          months: s.months,
          lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt) : null,
        })),
      },
    },
    include: { skills: true, consents: true },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerCreated",
    targetType: "Engineer",
    targetId: engineer.id,
  });
  // 用語辞書の自動増補（Phase 2 名寄せ）: 手入力・取込確定を問わず新語の正規形を辞書へ登録
  // （取込確定も本関数経由のためここで一括して行う。失敗しても登録は成立）
  await registerNewTermAliases(
    [
      ...(input.skills ?? []).map((s) => s.name),
      ...(input.processes ?? []),
      ...(input.roles ?? []),
      ...(input.industries ?? []),
    ],
    auth.companyId
  );
  return serializeEngineer(engineer, auth);
}

// 人材の更新（自社のみ）。skills は全置換。name は指定時のみ更新（PII権限がない担当者の編集を許容）
export async function updateEngineer(
  auth: AuthContext,
  engineerId: string,
  input: Omit<EngineerInput, "name"> & { name?: string }
) {
  const existing = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null },
  });
  if (!existing) return { error: { code: "NOT_FOUND" as const } };

  const engineer = await prisma.$transaction(async (tx) => {
    await tx.engineerSkill.deleteMany({ where: { engineerId } });
    return tx.engineer.update({
      where: { id: engineerId },
      data: {
        updatedByMemberId: auth.memberId,
        ...(input.name ? { name: input.name } : {}),
        ageBand: input.ageBand,
        affiliationType: input.affiliationType,
        residenceCity: input.residenceCity ?? null,
        nationality: input.nationality?.trim() || null,
        nearestStation: input.nearestStation ?? null,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        availabilityRate: input.availabilityRate ?? 100,
        desiredRateYen: input.desiredRateYen,
        commuteMaxMinutes: input.commuteMaxMinutes ?? null,
        // 週最大出社日数は許容出社条件と連動（未指定時は許容出社条件から導出）
        maxOnsiteDaysPerWeek:
          input.maxOnsiteDaysPerWeek ?? remoteLevelToOnsiteDays(input.remotePreference ?? "R0"),
        remotePreference: input.remotePreference ?? "R0",
        travelOk: input.travelOk ?? false,
        summary: input.summary ?? "",
        processes: input.processes ?? [],
        roles: input.roles ?? [],
        industries: input.industries ?? [],
        skills: {
          create: (input.skills ?? []).map((s) => ({
            category: s.category as never,
            name: s.name,
            months: s.months,
            lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt) : null,
          })),
        },
      },
      include: { skills: true, consents: true },
    });
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerUpdated",
    targetType: "Engineer",
    targetId: engineerId,
  });
  // 用語辞書の自動増補（Phase 2 名寄せ）: 更新で追加された新語も辞書へ登録
  await registerNewTermAliases(
    [
      ...(input.skills ?? []).map((s) => s.name),
      ...(input.processes ?? []),
      ...(input.roles ?? []),
      ...(input.industries ?? []),
    ],
    auth.companyId
  );
  return { engineer: serializeEngineer(engineer, auth) };
}

export async function addConsent(
  auth: AuthContext,
  engineerId: string,
  input: { method: string; documentVersion: string; purposes: string[]; validUntil?: string }
) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId },
  });
  if (!engineer) return null;
  const consent = await prisma.personConsent.create({
    data: {
      engineerId,
      consentedAt: new Date(),
      method: input.method,
      documentVersion: input.documentVersion,
      purposes: input.purposes,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
    },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "ConsentRegistered",
    targetType: "Engineer",
    targetId: engineerId,
    metadata: { consentId: consent.id },
  });
  return consent;
}

// 公開（§11.3: 有効な同意がない人材は公開できない）
export async function publishEngineer(auth: AuthContext, engineerId: string) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId },
    include: { consents: true },
  });
  if (!engineer) return { error: "NOT_FOUND" as const };
  if (!hasValidConsent(engineer.consents)) return { error: "CONSENT_REQUIRED" as const };
  if (engineer.workAuthStatus === "EXPIRED") return { error: "WORK_AUTH_EXPIRED" as const };
  await prisma.engineer.update({
    where: { id: engineerId },
    data: { status: "PUBLISHED", updatedByMemberId: auth.memberId },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerPublished",
    targetType: "Engineer",
    targetId: engineerId,
  });
  return { ok: true as const };
}

// 人材の稼働状態（紹介中/稼働中）の手動設定
export async function setEngineerWorkStatus(
  auth: AuthContext,
  engineerId: string,
  workStatus: "PROPOSING" | "WORKING"
) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null },
  });
  if (!engineer) return { error: "NOT_FOUND" as const };
  await prisma.engineer.update({
    where: { id: engineerId },
    data: { workStatus, updatedByMemberId: auth.memberId },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerUpdated",
    targetType: "Engineer",
    targetId: engineerId,
    metadata: { workStatus },
  });
  return { ok: true as const };
}

// 人材の削除（論理削除 §26 準拠）。deletedAt を設定して全画面・検索から除外する。
// 進行中のエントリーがある人材は削除できない（見送り・辞退のみなら可）。
// PII の物理削除は削除請求フロー（privacy）で行う
export async function deleteEngineer(auth: AuthContext, engineerId: string) {
  const existing = await prisma.engineer.findFirst({
    where: { id: engineerId, tenantCompanyId: auth.companyId, deletedAt: null },
  });
  if (!existing) return { error: { code: "NOT_FOUND" as const } };
  const activeEntries = await prisma.entry.count({
    where: { engineerId, status: { notIn: ["DECLINED", "WITHDRAWN"] } },
  });
  if (activeEntries > 0)
    return {
      error: {
        code: "VERSION_CONFLICT" as const,
        message: "進行中のエントリーがあるため削除できません（見送り・辞退後に削除してください）",
      },
    };
  await prisma.engineer.update({
    where: { id: engineerId },
    data: { deletedAt: new Date() },
  });
  await audit({
    tenantCompanyId: auth.companyId,
    actorUserId: auth.userAccountId,
    action: "EngineerDeleted",
    targetType: "Engineer",
    targetId: engineerId, // 監査ログに氏名等の PII は含めない
  });
  return { ok: true as const };
}
