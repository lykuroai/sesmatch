#!/usr/bin/env node
// SQL Server（eigyoubot）の人材文書（doc_kind=CANDIDATE）を sesmatch の取込 API に流す独立ツール。
// 取込パイプライン（PII匿名化 → LLM正規化 → 人手確認）を API 経由で通すため、直接DBには書かない。
//
// 使い方:
//   node scripts/import-from-sqlserver.mjs                        # ドライラン（対象件数と先頭5件を表示）
//   node scripts/import-from-sqlserver.mjs --run --limit 10      # 10件だけ実行
//   node scripts/import-from-sqlserver.mjs --run --since 2026-07-27 --until 2026-08-03
//
// 接続設定（環境変数、括弧内は既定値）:
//   APP_BASE_URL (http://127.0.0.1:3000)  APP_EMAIL  APP_PASSWORD   … sesmatch 側（ingestion.create 権限が必要）
//   MSSQL_HOST (127.0.0.1)  MSSQL_PORT (1433)  MSSQL_USER (sa)  MSSQL_PASSWORD  MSSQL_DB (eigyoubot)
//
// 冪等性: 取込済み document_id を scripts/.import-sqlserver-state.json に記録し、再実行時はスキップする。
// content_hash が同一の文書は最初の1件だけ取り込む。

import sql from "mssql";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

// 今週の月曜（JST基準の素朴な計算）
function thisWeekMonday() {
  const now = new Date();
  const day = now.getDay(); // 0=日
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return mon.toISOString().slice(0, 10);
}

const SINCE = opt("since", thisWeekMonday());
const UNTIL = opt("until", new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)); // 明日=今日いっぱい
const LIMIT = parseInt(opt("limit", "0")) || 0; // 0=無制限
const RUN = flag("run");
const BASE_URL = (opt("base-url", process.env.APP_BASE_URL ?? "http://127.0.0.1:3000")).replace(/\/+$/, "");
const APP_EMAIL = process.env.APP_EMAIL ?? "";
const APP_PASSWORD = process.env.APP_PASSWORD ?? "";

const STATE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".import-sqlserver-state.json");

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function fetchDocs() {
  const pool = await sql.connect({
    server: process.env.MSSQL_HOST ?? "127.0.0.1",
    port: parseInt(process.env.MSSQL_PORT ?? "1433"),
    user: process.env.MSSQL_USER ?? "sa",
    password: process.env.MSSQL_PASSWORD ?? "",
    database: process.env.MSSQL_DB ?? "eigyoubot",
    options: { trustServerCertificate: true, encrypt: true },
  });
  const result = await pool
    .request()
    .input("since", sql.Date, SINCE)
    .input("until", sql.Date, UNTIL)
    .query(
      `SELECT document_id, title, body_text, created_at, content_hash
       FROM ses_documents
       WHERE doc_kind = 'CANDIDATE' AND created_at >= @since AND created_at < @until
       ORDER BY created_at ASC`
    );
  await pool.close();
  return result.recordset;
}

async function login() {
  if (!APP_EMAIL || !APP_PASSWORD) {
    console.error("APP_EMAIL / APP_PASSWORD を設定してください（ingestion.create 権限のあるアカウント）");
    process.exit(1);
  }
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: APP_EMAIL, password: APP_PASSWORD }),
  });
  if (!res.ok) {
    console.error(`ログイン失敗 (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("sesmatch_session="));
  if (!cookie) {
    console.error("セッションCookieを取得できませんでした");
    process.exit(1);
  }
  return cookie;
}

async function main() {
  console.log(`対象: ${SINCE} 〜 ${UNTIL}（doc_kind=CANDIDATE, ${BASE_URL} へ取込）`);
  const docs = await fetchDocs();

  // content_hash 重複は最初の1件のみ
  const seen = new Set();
  const unique = docs.filter((d) => {
    if (d.content_hash && seen.has(d.content_hash)) return false;
    if (d.content_hash) seen.add(d.content_hash);
    return true;
  });

  const state = loadState();
  const doneIds = new Set(state[BASE_URL] ?? []);
  const pending = unique.filter((d) => !doneIds.has(d.document_id));
  const targets = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;

  console.log(
    `取得 ${docs.length} 件 → 重複除去後 ${unique.length} 件 → 取込済みスキップ後 ${pending.length} 件 → 今回対象 ${targets.length} 件`
  );

  if (!RUN) {
    console.log("\n[ドライラン] 先頭5件:");
    for (const d of targets.slice(0, 5)) {
      console.log(
        `  #${d.document_id} ${String(d.created_at).slice(0, 10)} ${String(d.title ?? "").slice(0, 60)} (${(d.body_text ?? "").length}文字)`
      );
    }
    console.log("\n実行するには --run を付けてください（--limit N で件数制限）");
    return;
  }

  const cookie = await login();
  let ok = 0,
    failed = 0;
  const errors = [];
  for (const [i, d] of targets.entries()) {
    // タイトルは短めに切る（原本保存のファイル名になるため。長い日本語タイトルはバイト長超過で失敗する）
    const title = `[eb#${d.document_id}] ${(d.title ?? "").trim()}`.slice(0, 60);
    const text = (d.body_text ?? "").slice(0, 100_000);
    if (!text.trim()) {
      failed++;
      errors.push(`#${d.document_id}: 本文が空`);
      continue;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/v1/ingestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ text, title }),
      });
      if (res.ok) {
        const job = await res.json();
        ok++;
        doneIds.add(d.document_id);
        console.log(`[${i + 1}/${targets.length}] #${d.document_id} → ${job.status ?? "OK"}`);
      } else {
        failed++;
        const body = await res.text().catch(() => "");
        errors.push(`#${d.document_id}: HTTP ${res.status} ${body.slice(0, 150)}`);
        console.log(`[${i + 1}/${targets.length}] #${d.document_id} → 失敗 (HTTP ${res.status})`);
      }
    } catch (e) {
      failed++;
      errors.push(`#${d.document_id}: ${e.message}`);
      console.log(`[${i + 1}/${targets.length}] #${d.document_id} → 失敗 (${e.message})`);
    }
    // 進捗保存（中断しても再開できる）
    if ((i + 1) % 10 === 0 || i === targets.length - 1) {
      state[BASE_URL] = [...doneIds];
      saveState(state);
    }
  }
  state[BASE_URL] = [...doneIds];
  saveState(state);

  console.log(`\n完了: 成功 ${ok} / 失敗 ${failed}`);
  if (errors.length) {
    console.log("失敗詳細（先頭10件）:");
    for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  }
  console.log("取込結果は sesmatch の「取込履歴」画面で確認・確定してください（人手確認待ち）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
