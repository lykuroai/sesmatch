import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

// 料金ページ（PRO版仕様書 §2, §3, §11）。未ログインで閲覧可能。
// 基本版は現行機能をすべて無料で提供し続け、PRO 版は上乗せ機能を月額固定で提供する。
// PRO の申込は新規登録画面のプラン選択・会社マイページ「プラン」・お問合せの3経路（2026-12-04 受付開始。運営が承認して有効化）。価格は税別・月払いのみ（年払いは 2026-11-05 廃止）。

export const metadata = {
  title: "料金",
  description:
    "SES DirectMatch の料金。基本版は掲載料・月額費用・成約手数料すべて0円。PRO版は月額39,800円（税別・担当者5名込み）で、相手企業名の明示・一括取込・新着アラート・分析などの上乗せ機能をご利用いただけます。",
  alternates: { canonical: "/pricing" },
  openGraph: { title: "料金" },
};

type Row = { label: string; free: string; pro: string; soon?: boolean };
type Group = { title: string; rows: Row[] };

// 機能比較（PRO版仕様書 §3 の抜粋。「準備中」は段階B・C で提供予定）
const GROUPS: Group[] = [
  {
    title: "登録・取込",
    rows: [
      { label: "案件・人材の登録、貼り付け・ファイル取込、OCR、AI 整理", free: "○", pro: "○" },
      { label: "一括取込（複数ファイル同時アップロード、人材書類の複数件分割）", free: "−", pro: "最大20ファイル/回" },
      { label: "取込件数・公開中件数", free: "無制限", pro: "無制限" },
    ],
  },
  {
    title: "検索・マッチング",
    rows: [
      { label: "公開案件・公開人材の検索、AI マッチング", free: "○", pro: "○" },
      { label: "相手企業名の明示（他社の公開案件・人材に掲載企業名を表示）", free: "取引先登録済みのみ", pro: "すべての他社" },
      { label: "保存検索と新着アラート（メール通知）", free: "−", pro: "10件/社" },
      { label: "Slack／Teams 通知（Incoming Webhook、5件/社）", free: "−", pro: "○" },
    ],
  },
  {
    title: "商談・面談",
    rows: [
      { label: "商談申込み・スカウト、双方承認、メッセージ、面談", free: "○", pro: "○" },
      { label: "一斉スカウト（最大20名/回）、スカウト文の AI 下書き、既読表示・反応率", free: "−", pro: "○" },
      { label: "スキルシート再生成（自社書式。印刷用 PDF／Excel）", free: "−", pro: "○" },
      { label: "Web 会議（コンソール内。人材本人はゲスト URL で参加）", free: "−", pro: "○" },
    ],
  },
  {
    title: "契約・稼働・手数料",
    rows: [
      { label: "条件確認書の相互署名、稼働開始・終了、月次稼働確認", free: "○", pro: "○" },
      { label: "成約手数料", free: "0円", pro: "0円" },
    ],
  },
  {
    title: "分析・統制・サポート",
    rows: [
      { label: "ホーム KPI", free: "○", pro: "○" },
      { label: "商談ファネル、市場単価レンジ、CSV エクスポート", free: "−", pro: "○" },
      { label: "2要素認証（認証アプリ）", free: "○", pro: "○" },
      { label: "2要素認証の全員必須化", free: "−", pro: "○" },
      { label: "API トークン本数", free: "2本", pro: "10本" },
      { label: "IP 制限、SSO、監査ログ出力", free: "−", pro: "○", soon: true },
      { label: "お問合せ", free: "通常対応", pro: "優先対応（目安1営業日）" },
      { label: "導入オンボーディング（オンライン60分）", free: "−", pro: "○" },
    ],
  },
];

function Cell({ value }: { value: string }) {
  if (value === "○") return <span className="text-xl font-bold leading-none text-emerald-600">〇</span>;
  if (value === "−") return <span className="text-slate-400">−</span>;
  return <span>{value}</span>;
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <PublicHeader />
      <section className="relative overflow-hidden bg-gradient-to-b from-sky-50 via-white to-white">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-40 h-96 w-96 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-5xl px-4 py-10 lg:px-6 lg:py-16">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Pricing</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">料金</h1>
            <p className="mt-3 text-sm text-slate-600">
              基本版は今後も無料のまま。もっと速く・多く・自動で動かしたい企業向けに PRO 版をご用意しました。
            </p>
          </div>

          {/* プランカード */}
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold">基本版</h2>
              <p className="mt-1 text-sm text-slate-500">登録から成約・稼働管理まで、すべての基本機能</p>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-black text-blue-700">0</span>
                <span className="text-sm font-bold text-blue-700">円</span>
                <span className="ml-2 text-xs text-slate-500">掲載料・月額費用・成約手数料すべて</span>
              </p>
              <ul className="mt-5 space-y-2 text-sm text-slate-600">
                <li>・担当者数、取込件数、公開中件数に制限なし</li>
                <li>・AI マッチング、商談、双方承認、契約、稼働確認</li>
                <li>・企業間関係に登録した取引先の掲載企業名を表示</li>
              </ul>
              <Link
                href="/apply"
                className="mt-6 inline-flex w-full items-center justify-center rounded-full border border-blue-600 px-6 py-3 text-sm font-bold text-blue-700 hover:bg-blue-50"
              >
                無料で企業登録
              </Link>
            </section>

            <section className="relative rounded-2xl border-2 border-emerald-500 bg-white p-6 shadow-md shadow-emerald-500/10">
              <span className="absolute -top-3 left-6 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">PRO</span>
              <h2 className="text-lg font-bold">PRO 版</h2>
              <p className="mt-1 text-sm text-slate-500">基本版のすべて ＋ 量・速さ・自動化・分析・統制の上乗せ機能</p>
              <p className="mt-4 flex flex-wrap items-baseline gap-1">
                <span className="text-xs text-slate-500">月額</span>
                <span className="text-4xl font-black text-emerald-700">39,800</span>
                <span className="text-sm font-bold text-emerald-700">円</span>
                <span className="ml-1 text-xs text-slate-500">（税別・1社）</span>
              </p>
              <ul className="mt-5 space-y-2 text-sm text-slate-600">
                <li>・担当者5名まで含む（6名以降は 1名 4,000円/月）</li>
                <li>・月払いのみ（年払い・割引はありません）</li>
                <li>・30日間のお試し期間あり。開始当月は無料、翌月分から請求</li>
                <li>・請求書払い（月末締め・翌月末振込）。解約は当月末までの申し出で翌月から基本版へ</li>
              </ul>
              <Link
                href="/apply"
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-700"
              >
                企業登録して PRO 版を申し込む
              </Link>
              <p className="mt-2 text-center text-xs text-slate-500">
                PRO 版のお申込は 2026年12月4日 から受け付けます。企業登録画面でのプラン選択、またはご登録済みの企業は会社マイページの「プラン」からお申込みください。
              </p>
            </section>
          </div>

          {/* 機能比較 */}
          <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-base font-bold">機能比較</h2>
            <p className="mt-1 text-xs text-slate-500">
              「準備中」の機能は順次提供します。人材本人の氏名・実額単価は、プランにかかわらず双方承認後にのみ開示されます。
            </p>
            <div className="mt-4 overflow-x-auto">
              {/* 枠線は罫線をはっきり出す（2026-11-05 郭指摘: 薄くて見にくい）。行・列ともに slate-300 の罫線、PRO 列は薄い緑地 */}
              <table className="w-full min-w-[560px] border-collapse border border-slate-300 text-sm">
                <thead>
                  <tr className="bg-slate-100 text-left text-xs font-bold text-slate-700">
                    <th className="border border-slate-300 px-3 py-2">機能</th>
                    <th className="w-36 border border-slate-300 px-3 py-2">基本版</th>
                    <th className="w-44 border border-slate-300 bg-emerald-100 px-3 py-2 text-emerald-800">PRO 版</th>
                  </tr>
                </thead>
                <tbody>
                  {GROUPS.map((g) => (
                    <GroupRows key={g.title} group={g} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 注記 */}
          <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs leading-relaxed text-slate-600">
            <h2 className="text-sm font-bold text-slate-800">ご利用条件</h2>
            <ul className="mt-2 space-y-1">
              <li>・表示価格はすべて税別です。消費税は請求時の税率で加算します。</li>
              <li>・追加担当者の料金は前月末時点の有効な担当者数で算定します。日割り計算は行いません。</li>
              <li>・お試し期間・PRO 版の期限が切れた場合は自動的に基本版に戻ります。登録データは削除されません。</li>
              <li>・PRO 版では他社の公開案件・公開人材に掲載企業名が表示されます（人材本人の氏名・実額単価は双方承認後のみ）。</li>
              <li>・PRO 版のお申込・解約申請は、企業登録画面のプラン選択または会社マイページの「プラン」から受け付けます（2026年12月4日受付開始。「お問合せ」からのご相談も可能です）。運営が確認のうえ有効化します。</li>
            </ul>
          </section>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/apply/rules" className="px-4 py-3 text-sm font-medium text-slate-600 hover:text-blue-700">
              企業登録のルール
            </Link>
            <Link href="/login" className="px-4 py-3 text-sm font-medium text-slate-600 hover:text-blue-700">
              ログイン画面へ戻る
            </Link>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}

function GroupRows({ group }: { group: Group }) {
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={3} className="border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700">
          {group.title}
        </td>
      </tr>
      {group.rows.map((r) => (
        <tr key={r.label}>
          <td className="border border-slate-300 px-3 py-2 text-slate-700">
            {r.label}
            {r.soon && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">準備中</span>}
          </td>
          <td className="border border-slate-300 px-3 py-2">
            <Cell value={r.free} />
          </td>
          <td className="border border-slate-300 bg-emerald-50/60 px-3 py-2 font-medium text-slate-800">
            <Cell value={r.pro} />
          </td>
        </tr>
      ))}
    </>
  );
}
