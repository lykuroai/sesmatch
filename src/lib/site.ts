// サイト共通のSEO・計測設定
export const SITE_URL = (process.env.APP_BASE_URL || "https://ses.lykuro.ai").replace(/\/$/, "");
export const SITE_NAME = "SES DirectMatch";
export const SITE_TITLE = "SES DirectMatch — AI人材・案件ダイレクトマッチング";
export const SITE_DESCRIPTION =
  "SES企業向けのAI案件・人材マッチングサービス。案件票やスキルシートを貼り付け・ファイル取込するだけで登録でき、AIが最適な案件・人材を提案します。";

// GA4 測定ID（例: "G-XXXXXXXXXX"）。空ならタグを出力しない。
// 本番のDockerビルドは .env.production をビルド時に読まないため、IDが決まったらここに直接記載する
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-3PL6PCVBCX";
