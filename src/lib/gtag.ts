// 計測イベントの送信（Google タグマネージャー向け）。
// dataLayer にカスタムイベントを push し、GA4 イベント・Google 広告コンバージョンの発火は GTM コンテナ側の
// トリガー（カスタムイベント名）で設定する。GTM 未読込でも dataLayer にキューされ、読込後に処理される。
//
// イベント名と GTM 側の用途:
//   apply_click  ホーム画面（ログインLP）の「企業登録を申し込む」ボタン押下（GA4 用）
//   apply_reach  企業申込画面への到達（Google 広告「申し込み到達」コンバージョン）
//   sign_up      企業登録の完了（/apply/register の第2段階完了時。Google 広告「申し込み登録完了」コンバージョン・GA4 のキーイベント）
export type TrackingEvent = "apply_click" | "apply_reach" | "sign_up";

export function trackEvent(name: TrackingEvent, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event: name, ...(params ?? {}) });
}

// 「申し込み到達」の送信済みフラグ（sessionStorage）。ホーム画面のボタン押下で送った直後に /apply が開いて
// 画面表示時にもう一度送られる二重計上を防ぐ。/apply 側は読み取ったらフラグを消す
const APPLY_REACH_SENT_KEY = "ads_apply_reach_sent";

// ホーム画面（ログインLP）の「企業登録を申し込む」ボタンを押した時に呼ぶ。
// GA4 向けの apply_click と、Google 広告「申し込み到達」向けの apply_reach を送る
export function reportHomeApplyClick() {
  trackEvent("apply_click", { location: "home" });
  trackEvent("apply_reach", { source: "home_button" });
  try {
    sessionStorage.setItem(APPLY_REACH_SENT_KEY, "1");
  } catch {
    // プライベートモード等で保存できない場合は二重送信の抑止なしで続行
  }
}

// 企業申込画面（/apply）を開いた時に1回呼ぶ。
// 直前にホーム画面のボタン経由で送信済みなら送らない（直接URL・/about 経由などは送る）
export function reportApplyReachConversion() {
  let alreadySent = false;
  try {
    alreadySent = sessionStorage.getItem(APPLY_REACH_SENT_KEY) === "1";
    sessionStorage.removeItem(APPLY_REACH_SENT_KEY);
  } catch {
    // 読めない場合は未送信として扱う
  }
  if (alreadySent) return;
  trackEvent("apply_reach", { source: "page_view" });
}

// 企業登録が完了した時に1回呼ぶ（Google 広告「申し込み登録完了」・GA4 sign_up）
export function reportSignupConversion() {
  trackEvent("sign_up", { method: "company_application" });
}
