// クライアント側からGA4イベントを送信する（タグ未読込・ID未設定時は何もしない）
export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (gtag) gtag("event", name, params ?? {});
}
