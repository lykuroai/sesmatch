// Next.js 計装フック。サーバー側（RSC ページ・Server Action）で未処理例外が起きたとき
// システムエラーログに記録し運営へ通知する（§33）。API（Hono）の例外は app.onError が扱う。
// notFound() / redirect() は Next が処理するためここには来ない
import type { Instrumentation } from "next";

// サーバー起動時に1回呼ばれる。PRO 機能の定期処理（新着アラートの評価 15分間隔）を起動する（PRO版仕様書 §9）
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@/server/plan/scheduler");
  startScheduler();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportSystemError, errorMessageOf } = await import("@/server/system-error");
  // 認証情報・クエリ文字列は記録しない（パスのみ）
  const path = request.path.split("?")[0];
  await reportSystemError({
    source: "PAGE",
    message: `${request.method} ${path}: ${errorMessageOf(error)}`,
    error,
    targetType: context.routeType,
    targetId: context.routePath,
  });
};
