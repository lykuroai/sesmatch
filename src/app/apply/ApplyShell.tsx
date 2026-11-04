// 企業申込（/apply・/apply/register）共通の外枠（ヘッダー・淡いグラデーション背景・フッター）と入力欄のスタイル。
// RSC・クライアントのどちらからも使える（状態を持たない）
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

// 入力欄・ラベルの見た目はログイン画面に合わせる
export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20";
export const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export default function ApplyShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <PublicHeader showApply={false} />
      <section className="relative overflow-hidden bg-gradient-to-b from-sky-50 via-white to-white">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-40 h-96 w-96 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-md px-4 py-10 lg:py-16">{children}</div>
      </section>
      <PublicFooter />
    </main>
  );
}
