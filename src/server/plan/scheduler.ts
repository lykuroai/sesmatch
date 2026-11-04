// PRO 機能の定期処理（PRO版仕様書 §4.3, §9）。Next.js の instrumentation.ts から起動するプロセス内タイマー。
//
// 業務モジュールを直接 import せず、自プロセスの内部ジョブ API（POST /api/v1/internal/jobs/alerts）を
// 呼び出す。instrumentation.ts の import 連鎖に業務コード（Prisma・OCR のネイティブ依存等）を入れると
// Next.js の Edge 向けコンパイルで失敗するため。内部 API はプロセス内で生成したトークンで保護する。
// 単一コンテナ運用が前提（複数インスタンス化する場合は外部スケジューラから同 API を叩く構成へ移す）。
// ALERT_SCHEDULER=0 で停止できる（テスト・ビルド・開発時の抑止用）
// 注意: instrumentation.ts は Edge 向けにもコンパイルされるため、このモジュールは Node 固有 API
// （"crypto" "fs" 等）を import しない。乱数は Web Crypto（globalThis.crypto）を使う

const INTERVAL_MS = 15 * 60 * 1000; // 新着アラートの評価間隔
const PERIODIC_INTERVAL_MS = 60 * 60 * 1000; // 月次処理（監査ログ送付・カード決済の使用量報告）の確認間隔
const FIRST_DELAY_MS = 60 * 1000; // 起動直後の負荷を避ける

type SchedulerGlobal = typeof globalThis & {
  __sesmatchSchedulerStarted?: boolean;
  __sesmatchInternalJobToken?: string;
};

// 内部ジョブ API の認証トークン（プロセス起動ごとに生成。API 側は同じ値を照合する）
export function internalJobToken(): string {
  const g = globalThis as SchedulerGlobal;
  g.__sesmatchInternalJobToken ??= `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`.replace(/-/g, "");
  return g.__sesmatchInternalJobToken;
}

export function startScheduler(): void {
  const g = globalThis as SchedulerGlobal;
  if (g.__sesmatchSchedulerStarted) return; // 開発時のホットリロードで多重起動しない
  if (process.env.ALERT_SCHEDULER === "0") return;
  g.__sesmatchSchedulerStarted = true;
  const port = process.env.PORT || "3000";
  const base = `http://127.0.0.1:${port}/api/v1/internal/jobs`;

  const call = async (job: "alerts" | "periodic") => {
    try {
      const res = await fetch(`${base}/${job}`, { method: "POST", headers: { "X-Internal-Job-Token": internalJobToken() } });
      if (!res.ok) console.error(`[${job}] 内部ジョブ API が失敗: ${res.status}`);
    } catch (e) {
      console.error(`[${job}] 内部ジョブ API の呼び出しに失敗`, e);
    }
  };
  setTimeout(() => {
    void call("alerts");
    setInterval(() => void call("alerts"), INTERVAL_MS).unref();
  }, FIRST_DELAY_MS).unref();
  setTimeout(() => {
    void call("periodic");
    setInterval(() => void call("periodic"), PERIODIC_INTERVAL_MS).unref();
  }, FIRST_DELAY_MS * 2).unref();
}
