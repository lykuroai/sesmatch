// サイト共通のSEO・計測設定
export const SITE_URL = (process.env.APP_BASE_URL || "https://ses.lykuro.ai").replace(/\/$/, "");
export const SITE_NAME = "SES DirectMatch";
export const SITE_TITLE = "SES DirectMatch — AI人材・案件ダイレクトマッチング";
export const SITE_DESCRIPTION =
  "SES企業向けのAI案件・人材マッチングサービス。案件票やスキルシートを貼り付け・ファイル取込するだけで登録でき、AIが最適な案件・人材を提案します。";

// 計測は Google タグマネージャー（GTM）に一本化（2026-10-22）。GA4 測定ID（G-3PL6PCVBCX）と
// Google 広告のコンバージョン（AW-18224920135）は GTM コンテナ側のタグで設定し、コードは dataLayer へ
// カスタムイベントを送るだけにする（src/lib/gtag.ts 参照）。
// 本番のDockerビルドは .env.production をビルド時に読まないため、コンテナIDはここに直接記載する
export const GTM_CONTAINER_ID = "GTM-KKX7RQN9";
