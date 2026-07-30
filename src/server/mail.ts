// メール配信（Amazon SES）
// MAIL_FROM が未設定の間は送信せずログのみ（開発・モック動作）。
// 認証は AWS SDK の既定チェーン（EC2 インスタンスロール推奨。無ければ AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）。
// 送信失敗は業務処理を失敗させない（ログのみ）。

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

let client: SESv2Client | null = null;

export const appBaseUrl = () =>
  (process.env.APP_BASE_URL || "https://ses.lykuro.ai").replace(/\/$/, "");

export async function sendMail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const from = process.env.MAIL_FROM;
  if (!from) {
    console.info(`[mail:mock] to=${input.to} subject=${input.subject}`);
    return;
  }
  try {
    client ??= new SESv2Client({
      region: process.env.AWS_REGION || "ap-northeast-1",
    });
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "UTF-8" },
            Body: { Text: { Data: input.body, Charset: "UTF-8" } },
          },
        },
      })
    );
  } catch (e) {
    console.error(`[mail] 送信失敗 to=${input.to} subject=${input.subject}`, e);
  }
}
