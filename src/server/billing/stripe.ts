// Stripe クライアント（PRO版仕様書 §4.15）。環境変数が揃うまでカード決済は停止（画面に出ない）。
//
//   STRIPE_SECRET_KEY      … シークレットキー
//   STRIPE_WEBHOOK_SECRET  … 受信 Webhook の署名シークレット（POST /api/v1/webhooks/stripe）
//   STRIPE_PRICE_MONTHLY   … PRO 月額（39,800円・税別）の Price ID
//   STRIPE_PRICE_YEARLY    … PRO 年払い（398,000円・税別）の Price ID
//   STRIPE_TAX_RATE_ID     … 消費税10%の Tax Rate ID（任意。未設定なら Stripe 側の価格に税を含める運用）
//
// カード情報はプラットフォームに保存しない（Checkout／Customer Portal を使う）

import Stripe from "stripe";

let client: Stripe | null = null;

export type StripeEnv = {
  secretKey: string;
  webhookSecret: string;
  priceMonthly: string;
  priceYearly: string;
  taxRateId: string | null;
};

export function stripeEnv(): StripeEnv | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const priceMonthly = process.env.STRIPE_PRICE_MONTHLY;
  const priceYearly = process.env.STRIPE_PRICE_YEARLY;
  if (!secretKey || !webhookSecret || !priceMonthly || !priceYearly) return null;
  return { secretKey, webhookSecret, priceMonthly, priceYearly, taxRateId: process.env.STRIPE_TAX_RATE_ID || null };
}

export const isStripeConfigured = () => stripeEnv() != null;

export function getStripe(): Stripe {
  const env = stripeEnv();
  if (!env) throw new Error("Stripe が設定されていません");
  client ??= new Stripe(env.secretKey, { typescript: true });
  return client;
}

// 署名検証（§4.15 テスト観点）。失敗時は null
export function constructStripeEvent(rawBody: string, signature: string | undefined, secret = stripeEnv()?.webhookSecret): Stripe.Event | null {
  if (!signature || !secret) return null;
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return null;
  }
}

export { Stripe };
