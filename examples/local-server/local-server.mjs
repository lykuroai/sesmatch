#!/usr/bin/env node
// SESマッチングプラットフォーム ローカルサーバ参考実装（local_server_spec_v0_1.md）
//
// 自社環境内で案件・人材書類を収集・構造化・保管し、商談開始のタイミングで
// 必要な1件だけを親サーバ（ses.lykuro.ai）へ送信する。
//
//   使い方:  node local-server.mjs [設定ファイルパス]（省略時: ./config.json）
//
// フォルダ構成（dataDir の下に自動作成）:
//   受入/案件/・受入/人材/   ここに置いたファイルを自前LLMで解析してローカル在庫へ
//   在庫/案件/・在庫/人材/   解析済みの在庫（original.*, extracted.json, meta.json）
//   エラー/                  解析に失敗したファイル（.エラー.txt に理由）
//
// 管理画面: http://127.0.0.1:8787 （既定。外部には公開しないこと）

import { createServer } from "http";
import { readFile, writeFile, readdir, stat, rename, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { extractText, SUPPORTED_EXTENSIONS } from "./lib/extract.mjs";
import { LlmClient } from "./lib/llm.mjs";
import { Store, KIND_DIRS } from "./lib/store.mjs";
import { ParentClient } from "./lib/parent.mjs";
import { matchEngineerToProject, matchProjectToEngineer } from "./lib/match.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

// 親サーバへの送信機能は送信仕様の変更に伴い一時停止中（再開時に true へ戻す）
const SEND_TO_PARENT_ENABLED = false;

// ---- 設定 ----------------------------------------------------------------

async function loadConfig() {
  const configPath = process.argv[2] ?? path.join(scriptDir, "config.json");
  let file = {};
  try {
    file = JSON.parse(await readFile(configPath, "utf-8"));
  } catch {
    console.error(`設定ファイルが読めません: ${configPath}（config.example.json を config.json にコピーして編集してください）`);
    process.exit(1);
  }
  const config = {
    dataDir: file.dataDir ?? "./data",
    host: file.host ?? "127.0.0.1", // 社内LANに公開する場合のみ変更（インターネット公開は禁止）
    port: file.port ?? 8787,
    scanIntervalMs: file.scanIntervalMs ?? 5000,
    parent: {
      baseUrl: file.parent?.baseUrl ?? "https://ses.lykuro.ai",
      token: process.env.SES_PARENT_TOKEN ?? file.parent?.token ?? "",
      email: process.env.SES_PARENT_EMAIL ?? file.parent?.email ?? "",
      password: process.env.SES_PARENT_PASSWORD ?? file.parent?.password ?? "",
    },
    llm: {
      baseUrl: file.llm?.baseUrl ?? "",
      apiKey: process.env.LLM_API_KEY ?? file.llm?.apiKey ?? "",
      model: file.llm?.model ?? "",
    },
  };
  if (!config.llm.baseUrl || !config.llm.model) {
    console.error("設定エラー: llm.baseUrl / llm.model を設定してください（OpenAI互換APIのURLとモデル名）");
    process.exit(1);
  }
  return config;
}

// ---- 受入フォルダの監視・解析 ----------------------------------------------

const seenFiles = new Map(); // path -> {size, mtimeMs} 前回スキャン値（書き込み完了待ち用）
const processing = new Set();

async function moveToError(store, filePath, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(store.errorDir(), `${stamp}_${path.basename(filePath)}`);
  await rename(filePath, dest).catch(() => {});
  await writeFile(`${dest}.エラー.txt`, `${reason}\n`, "utf-8").catch(() => {});
}

async function processInboxFile(store, llm, kind, filePath, extraMeta = {}) {
  const name = path.basename(filePath);
  const kindLabel = KIND_DIRS[kind];
  try {
    log(`解析開始: [${kindLabel}] ${name}`);
    const buffer = await readFile(filePath);
    const text = await extractText(name, buffer);
    // LLM送信禁止・取込時の匿名化は2026-08-19に全面撤廃（本体 §25.2 と同じ）。原文を送信する
    const extracted = await llm.extract(text, kind);
    // 人材の氏名: 画面入力 > LLM抽出値 の優先でメタ情報に保存
    const meta = await store.saveItem({
      kind,
      sourcePath: filePath,
      filename: name,
      extracted,
      maskedText: text, // 保存ファイル名（masked.txt）は互換のため維持
      ...(kind === "ENGINEER_SHEET" && !extraMeta.personName && extracted.name
        ? { personName: String(extracted.name) }
        : {}),
      ...extraMeta,
    });
    log(`在庫に保存: [${kindLabel}] ${name} (id: ${meta.id})`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log(`解析失敗: [${kindLabel}] ${name} → エラー/（${reason}）`);
    await moveToError(store, filePath, reason);
  }
}

async function scanOnce(store, llm) {
  for (const kind of Object.keys(KIND_DIRS)) {
    const dir = store.inboxDir(kind);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const filePath = path.join(dir, entry.name);
      if (processing.has(filePath)) continue;
      if (!SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        await moveToError(store, filePath, `未対応のファイル形式です（対応: ${SUPPORTED_EXTENSIONS.join(" ")}。画像・スキャン書類は親サーバの取込パネルから直接取り込んでください）`);
        continue;
      }
      const s = await stat(filePath).catch(() => null);
      if (!s) continue;
      const prev = seenFiles.get(filePath);
      seenFiles.set(filePath, { size: s.size, mtimeMs: s.mtimeMs });
      if (!prev || prev.size !== s.size || prev.mtimeMs !== s.mtimeMs) continue; // コピー完了待ち

      processing.add(filePath);
      try {
        await processInboxFile(store, llm, kind, filePath);
      } finally {
        processing.delete(filePath);
        seenFiles.delete(filePath);
      }
    }
  }
}

// ---- 管理画面（Web UI + JSON API）------------------------------------------

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("リクエストが大きすぎます");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};
const csv = (v) =>
  String(v ?? "")
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter(Boolean);

const strOrNull = (v) => {
  const s = String(v ?? "").trim();
  return s || null;
};

// 在庫編集用: UIの修正内容をローカル抽出データ（extracted.json）の形式に組み立てる
// （既存の未対応キーは温存する）
function buildProjectExtracted(prev, body) {
  return {
    ...prev,
    name: strOrNull(body.name),
    startDate: strOrNull(body.startDate),
    rateMaxYen: toInt(body.rateMaxYen) ?? null,
    onsiteDaysPerWeek: toInt(body.onsiteDaysPerWeek) ?? null,
    locationCity: strOrNull(body.locationCity),
    noForeignNational:
      body.noForeignNational === true || body.noForeignNational === false ? body.noForeignNational : null,
    requiredSkills: csv(body.requiredSkills),
    preferredSkills: csv(body.preferredSkills),
    summary: String(body.summary ?? "").trim(),
  };
}

function buildEngineerExtracted(prev, body) {
  return {
    ...prev,
    ageBand: toInt(body.ageBand) ?? null,
    nationality: strOrNull(body.nationality),
    residenceCity: strOrNull(body.residenceCity),
    availableFrom: strOrNull(body.availableFrom),
    desiredRateYen: toInt(body.desiredRateYen) ?? null,
    maxOnsiteDaysPerWeek: toInt(body.maxOnsiteDaysPerWeek) ?? null,
    skills: (Array.isArray(body.skills) ? body.skills : [])
      .filter((s) => s && String(s.name ?? "").trim())
      .map((s) => ({ category: s.category, name: String(s.name).trim(), months: toInt(s.months) ?? null })),
    processes: csv(body.processes),
    roles: csv(body.roles),
    industries: csv(body.industries),
    summary: String(body.summary ?? "").trim(),
  };
}

// 公開送信用: UIで確認・修正した値を親サーバの登録APIの形式に組み立てる
function buildProjectPayload(body) {
  return {
    name: String(body.name ?? "").trim(),
    anonymousSummary: String(body.anonymousSummary ?? "").trim(),
    startDate: String(body.startDate ?? "").trim(),
    rateMaxYen: toInt(body.rateMaxYen),
    contractType: body.contractType,
    ...(String(body.locationCity ?? "").trim() ? { locationCity: String(body.locationCity).trim() } : {}),
    ...(toInt(body.onsiteDaysPerWeek) != null ? { onsiteDaysPerWeek: toInt(body.onsiteDaysPerWeek) } : {}),
    ...(body.noForeignNational === true || body.noForeignNational === false
      ? { noForeignNational: body.noForeignNational }
      : {}),
    requiredSkills: csv(body.requiredSkills).map((name) => ({ name })),
    preferredSkills: csv(body.preferredSkills).map((name) => ({ name })),
  };
}

function buildEngineerPayload(body) {
  return {
    name: String(body.name ?? "").trim(),
    ageBand: toInt(body.ageBand),
    affiliationType: body.affiliationType,
    desiredRateYen: toInt(body.desiredRateYen),
    ...(String(body.residenceCity ?? "").trim() ? { residenceCity: String(body.residenceCity).trim() } : {}),
    ...(String(body.nationality ?? "").trim() ? { nationality: String(body.nationality).trim() } : {}),
    ...(String(body.availableFrom ?? "").trim() ? { availableFrom: String(body.availableFrom).trim() } : {}),
    ...(toInt(body.maxOnsiteDaysPerWeek) != null ? { maxOnsiteDaysPerWeek: toInt(body.maxOnsiteDaysPerWeek) } : {}),
    summary: String(body.summary ?? "").trim(),
    processes: csv(body.processes),
    roles: csv(body.roles),
    industries: csv(body.industries),
    skills: (Array.isArray(body.skills) ? body.skills : [])
      .filter((s) => s && String(s.name ?? "").trim())
      .map((s) => ({
        category: s.category,
        name: String(s.name).trim(),
        months: toInt(s.months) ?? 0,
      })),
  };
}

async function handleApi(req, res, { store, parent, config, llm }) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  // 画面からのアップロード: 受入フォルダに保存して即時解析（フォルダ投入と同じパイプライン）
  if (req.method === "POST" && parts[1] === "upload" && parts.length === 3) {
    const kind = parts[2] === "projects" ? "PROJECT_DESCRIPTION" : parts[2] === "engineers" ? "ENGINEER_SHEET" : null;
    if (!kind) return json(res, 404, { error: "not found" });
    let rawName = "";
    try {
      rawName = decodeURIComponent(req.headers["x-filename"] ?? "");
    } catch {
      return json(res, 400, { error: "ファイル名が不正です" });
    }
    const filename = path.basename(rawName).replace(/^\.+/, "");
    if (!filename) return json(res, 400, { error: "ファイル名が不正です" });
    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return json(res, 400, { error: `未対応のファイル形式です（対応: ${SUPPORTED_EXTENSIONS.join(" ")}。画像・スキャン書類は親サーバの取込パネルから直接取り込んでください）` });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) return json(res, 413, { error: "ファイルが大きすぎます（上限30MB）" });
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return json(res, 400, { error: "空のファイルです" });

    const dir = store.inboxDir(kind);
    let dest = path.join(dir, filename);
    const exists = await stat(dest).catch(() => null);
    if (exists || processing.has(dest)) dest = path.join(dir, `${Date.now()}_${filename}`);
    const tmp = path.join(dir, `.upload_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    await writeFile(tmp, buffer);
    processing.add(dest); // フォルダ監視との二重処理を防止
    await rename(tmp, dest);
    log(`画面から受入: [${KIND_DIRS[kind]}] ${path.basename(dest)}`);
    // 解析はバックグラウンドで実行（完了は一覧の自動更新で反映される）
    processInboxFile(store, llm, kind, dest).finally(() => processing.delete(dest));
    return json(res, 200, { ok: true, filename: path.basename(dest) });
  }

  // 画面からのテキスト貼り付け: .txt として受入フォルダに保存して即時解析（親画面の貼り付け取込と同等）
  if (req.method === "POST" && parts[1] === "paste" && parts.length === 3) {
    const kind = parts[2] === "projects" ? "PROJECT_DESCRIPTION" : parts[2] === "engineers" ? "ENGINEER_SHEET" : null;
    if (!kind) return json(res, 404, { error: "not found" });
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) return json(res, 413, { error: "テキストが大きすぎます（上限10万文字）" });
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    } catch {
      return json(res, 400, { error: "リクエスト形式が不正です" });
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json(res, 400, { error: "テキストが空です" });
    if (text.length > 100_000) return json(res, 413, { error: "テキストが大きすぎます（上限10万文字）" });
    const title = typeof body.title === "string" ? path.basename(body.title.trim()).replace(/^\.+/, "").slice(0, 80) : "";
    // 人材の氏名（任意）: PIIのためLLMには送らず、在庫メタ情報として保持する
    const personName =
      kind === "ENGINEER_SHEET" && typeof body.name === "string" ? body.name.trim().slice(0, 80) || null : null;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const filename = `${title || `貼り付け_${stamp}`}.txt`;

    const dir = store.inboxDir(kind);
    let dest = path.join(dir, filename);
    const exists = await stat(dest).catch(() => null);
    if (exists || processing.has(dest)) dest = path.join(dir, `${Date.now()}_${filename}`);
    const tmp = path.join(dir, `.paste_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    await writeFile(tmp, text, "utf-8");
    processing.add(dest); // フォルダ監視との二重処理を防止
    await rename(tmp, dest);
    log(`画面から貼り付け受入: [${KIND_DIRS[kind]}] ${path.basename(dest)}`);
    processInboxFile(store, llm, kind, dest, personName ? { personName } : {}).finally(() => processing.delete(dest));
    return json(res, 200, { ok: true, filename: path.basename(dest) });
  }

  if (req.method === "GET" && url.pathname === "/api/info") {
    return json(res, 200, {
      parentBaseUrl: config.parent.baseUrl,
      parentConfigured: parent.configured,
      sendEnabled: SEND_TO_PARENT_ENABLED,
      parentAuth: config.parent.token ? "APIトークン" : config.parent.email ? "メール＋パスワード（暫定）" : "未設定",
      llmModel: config.llm.model,
      dataDir: path.resolve(config.dataDir),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/items") {
    const [projects, engineers] = await Promise.all([
      store.listItems("PROJECT_DESCRIPTION"),
      store.listItems("ENGINEER_SHEET"),
    ]);
    const slim = (items) =>
      items.map(({ meta, extracted }) => ({ meta, summary: extracted.summary ?? "", name: extracted.name ?? null }));
    return json(res, 200, { projects: slim(projects), engineers: slim(engineers) });
  }

  // 親サーバの企業間公開検索（§9.3）: GET /api/parent/projects|engineers?q=&page=
  if (
    req.method === "GET" &&
    parts[1] === "parent" &&
    (parts[2] === "projects" || parts[2] === "engineers") &&
    parts.length === 3
  ) {
    if (!parent.configured) return json(res, 400, { error: "親サーバの認証情報が設定されていません（config.json の parent）" });
    try {
      const q = url.searchParams.get("q") ?? "";
      const page = url.searchParams.get("page") ?? "1";
      const source = url.searchParams.get("source") ?? "all"; // 掲載元: all | own | other
      // 進行中のものだけを対象にする（案件=募集中 / 人材=紹介中）
      const isActive = (i) =>
        parts[2] === "projects" ? i.workflowStatus === "RECRUITING" : i.workStatus === "PROPOSING";
      // 親コンソールの検索と同様に、他社の公開分と自社分を併取得して統合する
      // （自社は公開済みのみ。own フラグで区別し、UI側で「自社」表示・提案対象外とする）
      const fetchOwnActive = async () =>
        ((await parent.search(parts[2], "own", q)).items ?? []).filter(
          (i) => i.status === "PUBLISHED" && isActive(i)
        );
      const fetchPublicActive = async () =>
        ((await parent.search(parts[2], "public", q, page)).items ?? []).filter(isActive);
      let items;
      if (source === "own") items = await fetchOwnActive();
      else if (source === "other") items = await fetchPublicActive();
      else {
        const [pubActive, ownActive] = await Promise.all([fetchPublicActive(), fetchOwnActive()]);
        items = [...ownActive, ...pubActive];
      }

      // マッチ対象（ローカル在庫）が指定されていれば §19 簡易版で判定し、適合のみスコア順で返す
      const targetId = url.searchParams.get("targetId");
      if (targetId) {
        const targetKind = parts[2] === "projects" ? "ENGINEER_SHEET" : "PROJECT_DESCRIPTION";
        const target = await store.getItem(targetKind, targetId).catch(() => null);
        if (!target) return json(res, 404, { error: "マッチ対象の在庫が見つかりません" });
        items = items
          .map((i) => ({
            ...i,
            match:
              parts[2] === "projects"
                ? matchEngineerToProject(target.extracted, i)
                : matchProjectToEngineer(target.extracted, i),
          }))
          .filter((i) => i.match.passed)
          .sort((a, b) => b.match.score - a.match.score);
      }
      return json(res, 200, { items, total: items.length });
    } catch (e) {
      return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 提案・紹介の候補: 親サーバ上の公開済み自社案件・人材（登録元がローカルか親コンソールかを問わない）
  if (req.method === "GET" && parts[1] === "parent" && parts[2] === "own" && parts.length === 3) {
    if (!parent.configured) return json(res, 400, { error: "親サーバの認証情報が設定されていません（config.json の parent）" });
    const kindPath = url.searchParams.get("kind");
    if (kindPath !== "projects" && kindPath !== "engineers") return json(res, 400, { error: "kind が不正です" });
    try {
      const own = await parent.search(kindPath, "own", "");
      const items = (own.items ?? [])
        .filter((i) => i.status === "PUBLISHED")
        .filter((i) =>
          kindPath === "projects"
            ? i.workflowStatus !== "ENDED"
            : !["CONTRACTED", "WORKING"].includes(i.workStatus)
        )
        .map((i) => ({
          id: i.id,
          label: (kindPath === "projects"
            ? `${i.code ?? ""} ${i.name ?? ""}`
            : `${i.code ?? ""} ${i.name ?? ""} ${i.ageBand ?? ""} ${i.rateBand ?? ""}`
          )
            .replace(/\s+/g, " ")
            .trim(),
        }));
      return json(res, 200, { items });
    } catch (e) {
      return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 人材提案・案件紹介の作成（§9.4）: POST /api/parent/entries
  if (req.method === "POST" && parts[1] === "parent" && parts[2] === "entries" && parts.length === 3) {
    if (!parent.configured) return json(res, 400, { error: "親サーバの認証情報が設定されていません（config.json の parent）" });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return json(res, 400, { error: "リクエスト形式が不正です" });
    }
    if (body.type !== "PROPOSAL" && body.type !== "SCOUT") return json(res, 400, { error: "type が不正です" });
    if (!body.projectId || !body.engineerId) return json(res, 400, { error: "projectId / engineerId は必須です" });
    try {
      const entry = await parent.createEntry({
        type: body.type,
        projectId: String(body.projectId),
        engineerId: String(body.engineerId),
        ...(String(body.note ?? "").trim() ? { note: String(body.note).trim() } : {}),
      });
      log(`${body.type === "PROPOSAL" ? "人材提案" : "案件紹介"}を作成: 商談 ${entry.id}`);
      return json(res, 200, { entry });
    } catch (e) {
      return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // /api/items/:kind/:id/(send|status|publish) と /api/items/:kind/:id
  if (parts[0] === "api" && parts[1] === "items" && parts.length >= 4) {
    const kind = parts[2] === "projects" ? "PROJECT_DESCRIPTION" : parts[2] === "engineers" ? "ENGINEER_SHEET" : null;
    if (!kind) return json(res, 404, { error: "not found" });
    const id = parts[3];
    const item = await store.getItem(kind, id).catch(() => null);
    if (!item) return json(res, 404, { error: "見つかりません" });

    // 公開送信（§9.2）: 確認・修正済みの構造化データを親サーバへ直接登録し、公開まで行う
    if (req.method === "POST" && parts[4] === "publish") {
      if (!parent.configured) return json(res, 400, { error: "親サーバの認証情報が設定されていません（config.json の parent）" });
      if (item.meta.status === "PUBLISHED") return json(res, 409, { error: "既に公開送信済みです" });
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return json(res, 400, { error: "リクエスト形式が不正です" });
      }
      try {
        const isProject = kind === "PROJECT_DESCRIPTION";
        const payload = isProject ? buildProjectPayload(body) : buildEngineerPayload(body);
        const created = isProject
          ? await parent.publishProject(payload)
          : await parent.publishEngineer(payload);
        const meta = await store.updateMeta(kind, id, {
          status: "PUBLISHED",
          publishedAt: new Date().toISOString(),
          parentId: created.id,
          parentName: payload.name,
          ...(kind === "ENGINEER_SHEET" ? { personName: payload.name } : {}),
        });
        log(`公開送信: [${KIND_DIRS[kind]}] ${meta.filename} → 親サーバ ${created.id}`);
        return json(res, 200, { meta, parentId: created.id });
      } catch (e) {
        return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (req.method === "POST" && parts[4] === "send") {
      // 商談開始: 原本を親サーバの取込APIへ送信（親側でPII匿名化→LLM解析→人手確認）
      if (!SEND_TO_PARENT_ENABLED) return json(res, 503, { error: "親サーバへの送信は仕様変更のため一時停止中です" });
      if (!parent.configured) return json(res, 400, { error: "親サーバの認証情報が設定されていません（config.json の parent）" });
      if (item.meta.status === "SENT") return json(res, 409, { error: "既に送信済みです" });
      if (!item.originalPath) return json(res, 500, { error: "原本ファイルが見つかりません" });
      try {
        const job = await parent.sendDocument(item.originalPath, item.meta.filename, kind);
        const meta = await store.updateMeta(kind, id, {
          status: "SENT",
          sentAt: new Date().toISOString(),
          parentJobId: job.id,
        });
        log(`親サーバへ送信: [${KIND_DIRS[kind]}] ${meta.filename} (取込ジョブ: ${job.id})`);
        return json(res, 200, { meta });
      } catch (e) {
        return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (req.method === "GET" && parts[4] === "status") {
      if (!item.meta.parentJobId) return json(res, 400, { error: "未送信です" });
      try {
        const job = await parent.getIngestion(item.meta.parentJobId);
        return json(res, 200, { status: job.status, error: job.error ?? null });
      } catch (e) {
        return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (req.method === "GET" && parts.length === 4) return json(res, 200, item);

    // ローカル在庫の修正: 抽出データを編集保存する（親サーバへは送らない）
    if (req.method === "PUT" && parts.length === 4) {
      if (item.meta.status === "PUBLISHED")
        return json(res, 409, { error: "公開送信済みのため修正できません（親サーバ側で修正してください）" });
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return json(res, 400, { error: "リクエスト形式が不正です" });
      }
      const extracted =
        kind === "PROJECT_DESCRIPTION"
          ? buildProjectExtracted(item.extracted, body)
          : buildEngineerExtracted(item.extracted, body);
      await store.updateExtracted(kind, id, extracted);
      // 人材の氏名はPIIのため抽出データと分け、メタ情報として保存する
      if (kind === "ENGINEER_SHEET" && typeof body.name === "string")
        await store.updateMeta(kind, id, { personName: body.name.trim().slice(0, 80) || null });
      log(`在庫を修正: [${KIND_DIRS[kind]}] ${item.meta.filename}`);
      return json(res, 200, { ok: true, extracted });
    }

    if (req.method === "DELETE" && parts.length === 4) {
      await store.deleteItem(kind, id);
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: "not found" });
}

// ---- 起動 -----------------------------------------------------------------

async function main() {
  const config = await loadConfig();
  const store = new Store(config.dataDir);
  await store.init();
  const llm = new LlmClient(config.llm);
  const parent = new ParentClient(config.parent);
  const uiHtml = await readFile(path.join(scriptDir, "ui.html"), "utf-8");

  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(uiHtml);
      }
      if (req.url?.startsWith("/api/")) return await handleApi(req, res, { store, parent, config, llm });
      res.writeHead(404).end();
    } catch (e) {
      log(`APIエラー: ${e instanceof Error ? e.message : e}`);
      if (!res.headersSent) json(res, 500, { error: "内部エラー" });
    }
  });
  server.listen(config.port, config.host, () => {
    log(`ローカルサーバ起動: http://${config.host}:${config.port}`);
    log(`受入フォルダ: ${path.resolve(config.dataDir)}/受入/案件, 受入/人材`);
    log(`親サーバ: ${config.parent.baseUrl}（認証: ${config.parent.token ? "APIトークン" : config.parent.email ? "メール＋パスワード" : "未設定"}） / LLM: ${config.llm.model}`);
  });

  for (;;) {
    await scanOnce(store, llm).catch((e) => log(`スキャンエラー: ${e.message}`));
    await new Promise((r) => setTimeout(r, config.scanIntervalMs));
  }
}

main().catch((e) => {
  console.error(`起動失敗: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
