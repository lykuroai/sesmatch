import {
  ADS_APPLY_REACH_CONVERSION_LABEL,
  ADS_CONVERSION_ID,
  ADS_SIGNUP_CONVERSION_LABEL,
} from "@/lib/site";

// クライアント側からGA4・Google 広告のイベントを送信する。
// ページ表示直後は gtag.js（afterInteractive）の読込前で gtag が未定義のことがあるため、
// 定義されるまで待ってから送信する（タグ設定 config の後にイベントが並ぶようにする）。
// 測定ID未設定でタグを出力していない場合は一定時間後に諦めて何もしない
const GTAG_WAIT_INTERVAL_MS = 100;
const GTAG_WAIT_MAX_MS = 15000;
export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  const startedAt = Date.now();
  const attempt = () => {
    if (w.gtag) {
      w.gtag("event", name, params ?? {});
      return;
    }
    if (Date.now() - startedAt < GTAG_WAIT_MAX_MS) setTimeout(attempt, GTAG_WAIT_INTERVAL_MS);
  };
  attempt();
}

// Google 広告のコンバージョンを送信する（イベントスニペット相当）。ID・ラベル未設定時は何もしない
function reportConversion(label: string) {
  if (!ADS_CONVERSION_ID || !label) return;
  trackEvent("conversion", {
    send_to: `${ADS_CONVERSION_ID}/${label}`,
    value: 1.0,
    currency: "JPY",
  });
}

// 「申し込み到達」の送信済みフラグ（sessionStorage）。ホーム画面のボタン押下で送った直後に /apply が開いて
// 画面表示時にもう一度送られる二重計上を防ぐ。/apply 側は読み取ったらフラグを消す
const APPLY_REACH_SENT_KEY = "ads_apply_reach_sent";

// 「申し込み到達」: ホーム画面（ログインLP）の「企業登録を申し込む」ボタンを押した時に呼ぶ。
// GA4 にも apply_click を送る
export function reportHomeApplyClick() {
  trackEvent("apply_click", { location: "home" });
  reportConversion(ADS_APPLY_REACH_CONVERSION_LABEL);
  try {
    sessionStorage.setItem(APPLY_REACH_SENT_KEY, "1");
  } catch {
    // プライベートモード等で保存できない場合は二重送信の抑止なしで続行
  }
}

// 「申し込み到達」: 企業申込画面（/apply）を開いた時に1回呼ぶ。
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
  reportConversion(ADS_APPLY_REACH_CONVERSION_LABEL);
}

// 「申し込み登録完了」: 企業登録が完了した時に1回呼ぶ
export function reportSignupConversion() {
  reportConversion(ADS_SIGNUP_CONVERSION_LABEL);
}
