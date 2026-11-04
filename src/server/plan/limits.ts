// プランごとの数量上限（PRO版仕様書 §7）
//
// 基本版の上限は「予約」であり、現時点では API トークン本数（段階B で適用）を除きすべて無制限。
// 有効化する際は規約改定と1か月前告知を行ったうえで、この定数表だけを変更する。
// 超過時は新規登録・公開のみ拒否し（403 PLAN_LIMIT_EXCEEDED）、既存データの削除・非公開化は行わない。

import type { CompanyPlan } from "./features";

export type LimitKey =
  | "ingestions_per_month" // 取込件数/月（候補 30）
  | "members" // 担当者数（候補 3）
  | "published_projects" // 公開中案件（候補 20）
  | "published_engineers" // 営業中人材（候補 20）
  | "api_tokens" // API トークン本数（FREE 2 / PRO 10。有効なトークンを数える。既存分は削除しない）
  | "webhooks" // Slack/Teams Webhook（PRO 5件/社）
  | "saved_searches" // 保存検索（PRO 10件/社）
  | "skill_sheet_templates"; // スキルシートの自社テンプレート（PRO 3件/社）

// null = 無制限
export const PLAN_LIMITS: Record<CompanyPlan, Record<LimitKey, number | null>> = {
  FREE: {
    ingestions_per_month: null,
    members: null,
    published_projects: null,
    published_engineers: null,
    api_tokens: 2, // 基本版は2本まで（PRO版仕様書 §4.10。3本以上ある既存企業は新規作成のみ制限）
    saved_searches: 0,
    skill_sheet_templates: 0,
    webhooks: 0,
  },
  TRIAL: {
    ingestions_per_month: null,
    members: null,
    published_projects: null,
    published_engineers: null,
    api_tokens: 10,
    saved_searches: 10,
    skill_sheet_templates: 3,
    webhooks: 5,
  },
  PRO: {
    ingestions_per_month: null,
    members: null,
    published_projects: null,
    published_engineers: null,
    api_tokens: 10,
    saved_searches: 10,
    skill_sheet_templates: 3,
    webhooks: 5,
  },
};

export function limitFor(plan: CompanyPlan, key: LimitKey): number | null {
  return PLAN_LIMITS[plan][key];
}

export const PLAN_LIMIT_MESSAGE = "現在のプランの上限に達しています";

// current 件がすでにある状態で1件追加できるか。超過なら §29 形式のエラー
export function assertLimit(
  plan: CompanyPlan,
  key: LimitKey,
  current: number
): { error: { code: "PLAN_LIMIT_EXCEEDED"; message: string } } | null {
  const limit = limitFor(plan, key);
  if (limit == null || current < limit) return null;
  return { error: { code: "PLAN_LIMIT_EXCEEDED", message: PLAN_LIMIT_MESSAGE } };
}
