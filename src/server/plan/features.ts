// 利用プランと機能ゲート（PRO版仕様書 §5）
//
// - プランは企業単位（Company.plan）。FREE=基本版、TRIAL=PRO お試し、PRO=有料
// - 期限切れ（planExpiresAt < now）の TRIAL/PRO は要求ごとに FREE として扱い、降格バッチは持たない
// - PRO 限定機能の判定は hasFeature() に集約し、RSC ページと API の両方から使う
//   （画面側の出し分けだけに頼らない）。API はプラン外を 403 PLAN_REQUIRED で拒否する
// - 基本方針（§1.2）: 基本版の既存機能は制限しない。人材本人の匿名性・双方承認はプランで差を付けない

export type CompanyPlan = "FREE" | "TRIAL" | "PRO";

// PRO 限定機能のキー（§5）。段階A: company_name_display / bulk_ingest / saved_search_alert /
// analytics_export / priority_support。以降は段階B・C で追加
export const PRO_FEATURES = [
  "company_name_display", // 相手企業名の明示（§4.1）
  "bulk_ingest", // 一括取込（§4.2）
  "saved_search_alert", // 保存検索と新着アラート（§4.3）
  "analytics_export", // 分析・エクスポート（§4.4）
  "priority_support", // 優先サポート（§4.5）
  "bulk_scout", // 一斉スカウト（§4.6）
  "skill_sheet_render", // スキルシート再生成（§4.7）
  "web_meeting", // Web 会議（§4.8）
  "webhook_notify", // Slack/Teams Webhook（§4.9）
  "api_extended", // API トークン拡大（§4.10）
  "mfa_required", // 2要素認証の必須化（§4.11）
  "ip_restriction", // IP 制限（§4.12）
  "sso", // SSO（§4.13）
  "audit_export", // 監査ログのエクスポート（§4.14）
  "card_billing", // カード決済（§4.15）
] as const;
export type ProFeature = (typeof PRO_FEATURES)[number];

export const PLAN_LABELS: Record<CompanyPlan, string> = {
  FREE: "基本版",
  TRIAL: "PRO（お試し）",
  PRO: "PRO",
};

// プラン判定に必要な最小の情報（Company の一部、または AuthContext）
export type PlanInfo = { plan: CompanyPlan; planExpiresAt?: Date | string | null };

// 期限を考慮した実効プラン。期限切れの TRIAL/PRO は FREE
export function effectivePlan(c: PlanInfo, now: Date = new Date()): CompanyPlan {
  if (c.plan === "FREE") return "FREE";
  if (c.planExpiresAt == null) return c.plan;
  const exp = typeof c.planExpiresAt === "string" ? new Date(c.planExpiresAt) : c.planExpiresAt;
  return exp.getTime() < now.getTime() ? "FREE" : c.plan;
}

export function isProPlan(c: PlanInfo, now: Date = new Date()): boolean {
  return effectivePlan(c, now) !== "FREE";
}

// PRO 限定機能を使えるか。TRIAL は PRO と同じ機能をすべて満たす（§5）
export function hasFeature(c: PlanInfo, feature: ProFeature, now: Date = new Date()): boolean {
  if (!PRO_FEATURES.includes(feature)) return false;
  return isProPlan(c, now);
}

export const PLAN_REQUIRED_MESSAGE = "この機能は PRO 版でご利用いただけます";

// サービス層用: プラン外なら §29 形式のエラーを返す（API は 403 PLAN_REQUIRED にする）
export function assertFeature(
  c: PlanInfo,
  feature: ProFeature
): { error: { code: "PLAN_REQUIRED"; message: string } } | null {
  return hasFeature(c, feature) ? null : { error: { code: "PLAN_REQUIRED", message: PLAN_REQUIRED_MESSAGE } };
}
