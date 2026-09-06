// システムエラー通知の純粋ロジック（テスト対象）。DB・メールには触れない

export type SystemErrorSource = "LLM" | "INGEST" | "API" | "PAGE" | "MAIL" | "OTHER";

// 同一内容（source × message）のエラーを再通知しない間隔
export const NOTIFY_SUPPRESS_MS = 30 * 60 * 1000;

export const MESSAGE_MAX = 500;
export const DETAIL_MAX = 4000;

// 直近の通知時刻から、今回もメール通知すべきか
export function shouldNotify(lastNotifiedAt: Date | null | undefined, now: Date): boolean {
  if (!lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= NOTIFY_SUPPRESS_MS;
}

// 取込失敗のうち「書類側の問題（利用者が対処するもの）」は運営へ通知しない。
// それ以外（LLM API 障害・接続失敗・JSON 検証失敗・OCR 環境未設定など）はシステムエラーとして扱う
const USER_SIDE_PATTERNS = [
  /^KIND_MISMATCH/,
  /^文書種別を判定できませんでした/,
  /テキストを抽出できませんでした/,
  /に変換してください/,
  /原本ファイルが見つかりません/,
];

export function isUserSideIngestionError(message: string): boolean {
  return USER_SIDE_PATTERNS.some((re) => re.test(message));
}

// 取込失敗メッセージから通知の分類を決める（LLM 由来かそれ以外か）
export function ingestionErrorSource(message: string): SystemErrorSource {
  return /LLM/.test(message) ? "LLM" : "INGEST";
}

export function errorMessageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function errorDetailOf(e: unknown): string | undefined {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    const causeText = cause ? `\ncaused by: ${errorMessageOf(cause)}` : "";
    return `${e.stack ?? e.message}${causeText}`;
  }
  return undefined;
}

export function truncate(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// 運営宛メールの本文。個人情報を含めない（呼び出し側の message / detail にも含めないこと）
export function buildNotificationMail(input: {
  source: SystemErrorSource;
  message: string;
  detail?: string;
  tenantCompanyName?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  occurredAt: Date;
  adminUrl: string;
}): { subject: string; body: string } {
  const lines = [
    `発生時刻: ${input.occurredAt.toISOString()}`,
    `分類: ${input.source}`,
    `内容: ${input.message}`,
  ];
  if (input.tenantCompanyName) lines.push(`企業: ${input.tenantCompanyName}`);
  if (input.targetType || input.targetId)
    lines.push(`対象: ${[input.targetType, input.targetId].filter(Boolean).join(" ")}`);
  if (input.detail) lines.push("", "詳細:", truncate(input.detail, 1500) ?? "");
  lines.push(
    "",
    `運営コンソール（エラーログ）: ${input.adminUrl}`,
    `※同じ内容のエラーは ${NOTIFY_SUPPRESS_MS / 60000} 分以内は再通知しません`
  );
  return {
    subject: `【SES DirectMatch】システムエラー（${input.source}）: ${truncate(input.message, 80)}`,
    body: lines.join("\n"),
  };
}
