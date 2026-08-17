#!/usr/bin/env node
// SESマッチングプラットフォーム 子サーバ参考実装（フォルダ監視 → 取込API送信）
//
// 自社サーバ・PC上でフォルダを監視し、置かれた書類を ses.lykuro.ai の取込APIへ
// 送信するサンプルです。依存パッケージなし・このファイル1つで動作します（Node.js 20以上）。
//
//   使い方:  node child-server.mjs [設定ファイルパス]
//            設定ファイル省略時は同じディレクトリの config.json を読み込みます
//
// フォルダ構成（watchDir の下に自動作成されます）:
//   案件/     ここに置いたファイルを「案件」として取込
//   人材/     ここに置いたファイルを「人材」として取込（1ファイル=1名）
//   取込済/   取込に成功し人手確認待ちになったファイルの移動先
//   エラー/   取込に失敗したファイルの移動先（同名の .エラー.txt に理由を書き出し）
//
// 送信後の人手確認・確定は従来どおりWebコンソール（/ingestions 取込履歴）で行ってください。

import { readFile, writeFile, readdir, mkdir, rename, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ---- 設定 ----------------------------------------------------------------

const DEFAULTS = {
  baseUrl: "https://ses.lykuro.ai", // プラットフォームのURL
  email: "", // ログインメールアドレス（取込専用の担当者アカウントを推奨）
  password: "", // パスワード（このファイルの権限を600にするか、環境変数 SES_PASSWORD を使用）
  watchDir: "./ingest", // 監視フォルダ（下に 案件/人材/取込済/エラー を作成）
  scanIntervalMs: 5000, // フォルダを確認する間隔
  statusTimeoutMs: 300000, // 取込結果（解析完了）を待つ最大時間
};

// 取込APIが対応するファイル形式（これ以外は無視してログに警告を出す）
const SUPPORTED_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", // 書類
  ".jpg", ".jpeg", ".png", ".webp", // 画像（サーバー側でOCR）
  ".txt", ".csv", ".md", // テキスト
];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // サーバー側の上限と同じ 20MB

const KIND_DIRS = { 案件: "PROJECT_DESCRIPTION", 人材: "ENGINEER_SHEET" };
const DONE_DIR = "取込済";
const ERROR_DIR = "エラー";

async function loadConfig() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const configPath = process.argv[2] ?? path.join(scriptDir, "config.json");
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(configPath, "utf-8"));
  } catch {
    // 設定ファイルが無ければ既定値＋環境変数のみで動作
  }
  const config = {
    ...DEFAULTS,
    ...fileConfig,
    // 環境変数が最優先（パスワードをファイルに書きたくない場合に使用）
    baseUrl: process.env.SES_BASE_URL ?? fileConfig.baseUrl ?? DEFAULTS.baseUrl,
    email: process.env.SES_EMAIL ?? fileConfig.email ?? "",
    password: process.env.SES_PASSWORD ?? fileConfig.password ?? "",
  };
  if (!config.email || !config.password) {
    console.error(
      "設定エラー: email / password を設定してください（config.json または環境変数 SES_EMAIL / SES_PASSWORD）"
    );
    process.exit(1);
  }
  return config;
}

// ---- APIクライアント（セッションCookie認証・401で自動再ログイン） ----------

class ApiClient {
  constructor(baseUrl, email, password) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.email = email;
    this.password = password;
    this.cookie = null;
  }

  async login() {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(`ログイン失敗 (${res.status}): ${body?.error?.message ?? "認証情報を確認してください"}`);
    }
    const setCookies = res.headers.getSetCookie();
    const session = setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("sesmatch_session="));
    if (!session) throw new Error("ログイン応答にセッションCookieがありません");
    this.cookie = session;
  }

  // 認証付きfetch。セッション失効（401）時は一度だけ再ログインして再試行する
  async request(pathname, options = {}) {
    if (!this.cookie) await this.login();
    const doFetch = () =>
      fetch(`${this.baseUrl}${pathname}`, {
        ...options,
        headers: { ...(options.headers ?? {}), cookie: this.cookie },
      });
    let res = await doFetch();
    if (res.status === 401) {
      await this.login();
      res = await doFetch();
    }
    return res;
  }

  // ファイルを取込APIへ送信し、取込ジョブを返す
  async ingestFile(filePath, expectedKind) {
    const content = await readFile(filePath);
    const form = new FormData();
    form.append("file", new Blob([content]), path.basename(filePath));
    form.append("expectedKind", expectedKind);
    const res = await this.request("/api/v1/ingestions", { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.error?.message ?? `HTTP ${res.status}`;
      // 4xx はファイル起因（再送しても失敗する）、それ以外は一時障害として扱う
      throw Object.assign(new Error(message), { permanent: res.status >= 400 && res.status < 500 });
    }
    return body;
  }

  async getIngestion(jobId) {
    const res = await this.request(`/api/v1/ingestions/${jobId}`);
    if (!res.ok) throw new Error(`取込状況の取得に失敗 (HTTP ${res.status})`);
    return res.json();
  }
}

// ---- フォルダ監視ループ ----------------------------------------------------

const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

// 書き込み途中のファイルを送らないよう、前回スキャンとサイズ・更新時刻が同じものだけ処理する
const seenFiles = new Map(); // path -> { size, mtimeMs }
const processing = new Set(); // 送信処理中のファイル（多重送信防止）
const retryCounts = new Map(); // path -> 一時障害の連続失敗回数

async function moveTo(watchDir, dirName, filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(watchDir, dirName, `${stamp}_${path.basename(filePath)}`);
  await rename(filePath, dest);
  return dest;
}

// ジョブが解析完了（人手確認待ち/失敗）になるまでポーリングする
async function waitForResult(client, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await client.getIngestion(jobId);
    if (["REVIEW_REQUIRED", "CONFIRMED", "FAILED"].includes(job.status)) return job;
    if (Date.now() > deadline) return job; // タイムアウト時は最後の状態を返す（サーバー側で処理は継続）
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function processFile(client, config, filePath, expectedKind, kindLabel) {
  const name = path.basename(filePath);
  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_FILE_BYTES) throw Object.assign(new Error("ファイルが20MBを超えています"), { permanent: true });

    log(`送信: [${kindLabel}] ${name}`);
    const job = await client.ingestFile(filePath, expectedKind);
    // 送信成功後は先にファイルを退避する（結果待ち中の再送・二重取込を防ぐ）
    const moved = await moveTo(config.watchDir, DONE_DIR, filePath);

    const result = await waitForResult(client, job.id, config.statusTimeoutMs);
    if (result.status === "FAILED") {
      // 解析段階の失敗（種別不一致・PII検査など）はエラーフォルダへ移し、理由を書き出す
      const errorDest = path.join(config.watchDir, ERROR_DIR, path.basename(moved));
      await rename(moved, errorDest);
      await writeFile(`${errorDest}.エラー.txt`, `${result.error ?? "不明なエラー"}\n`, "utf-8");
      log(`失敗: [${kindLabel}] ${name} → エラー/（理由: ${result.error ?? "不明"}）`);
    } else {
      log(`完了: [${kindLabel}] ${name} → 取込済/（状態: ${result.status} — Webコンソールの取込履歴で確認・確定してください）`);
    }
    retryCounts.delete(filePath);
  } catch (e) {
    if (e.permanent) {
      const dest = await moveTo(config.watchDir, ERROR_DIR, filePath).catch(() => null);
      if (dest) await writeFile(`${dest}.エラー.txt`, `${e.message}\n`, "utf-8").catch(() => {});
      log(`失敗: [${kindLabel}] ${name} → エラー/（理由: ${e.message}）`);
    } else {
      // 一時障害（ネットワーク断・サーバー5xx）はファイルを残し、次回スキャンで再送する
      const count = (retryCounts.get(filePath) ?? 0) + 1;
      retryCounts.set(filePath, count);
      log(`一時エラー: [${kindLabel}] ${name}（${count}回目）: ${e.message} — 次回スキャンで再試行します`);
    }
  }
}

async function scanOnce(client, config) {
  for (const [dirName, expectedKind] of Object.entries(KIND_DIRS)) {
    const dir = path.join(config.watchDir, dirName);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      if (processing.has(filePath)) continue;
      if (entry.name.startsWith(".")) continue; // 隠しファイル・書き込み中の一時ファイルを除外
      if (!SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        log(`対象外の形式のため無視: ${dirName}/${entry.name}（対応: ${SUPPORTED_EXTENSIONS.join(" ")}）`);
        seenFiles.set(filePath, { skip: true });
        continue;
      }
      const s = await stat(filePath).catch(() => null);
      if (!s) continue;
      const prev = seenFiles.get(filePath);
      seenFiles.set(filePath, { size: s.size, mtimeMs: s.mtimeMs });
      if (prev?.skip) continue;
      // 初見またはサイズ・更新時刻が変化中のファイルは次回スキャンまで待つ（コピー完了待ち）
      if (!prev || prev.size !== s.size || prev.mtimeMs !== s.mtimeMs) continue;

      processing.add(filePath);
      try {
        await processFile(client, config, filePath, expectedKind, dirName);
      } finally {
        processing.delete(filePath);
        seenFiles.delete(filePath);
      }
    }
  }
}

async function main() {
  const config = await loadConfig();
  const client = new ApiClient(config.baseUrl, config.email, config.password);

  for (const dir of [...Object.keys(KIND_DIRS), DONE_DIR, ERROR_DIR]) {
    await mkdir(path.join(config.watchDir, dir), { recursive: true });
  }

  await client.login();
  log(`起動しました: ${config.baseUrl} へ ${config.email} で接続`);
  log(`監視中: ${path.resolve(config.watchDir)}/案件, ${path.resolve(config.watchDir)}/人材`);

  for (;;) {
    await scanOnce(client, config).catch((e) => log(`スキャンエラー: ${e.message}`));
    await new Promise((r) => setTimeout(r, config.scanIntervalMs));
  }
}

main().catch((e) => {
  console.error(`起動失敗: ${e.message}`);
  process.exit(1);
});
