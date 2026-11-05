// 特定商取引法に基づく表記（PRO版仕様書 §12）。有料プラン（PRO版）の提供に伴い掲示する。
// 【 】内は運営者が確定させる項目。公開前に内容を確認すること
import Link from "next/link";

const th = "w-40 shrink-0 py-2 pr-4 align-top text-sm font-bold text-stone-700";
const td = "py-2 text-sm leading-relaxed text-stone-700";

export const metadata = {
  title: "特定商取引法に基づく表記",
  description: "SES DirectMatch の有料プラン（PRO版）に関する特定商取引法に基づく表記です。",
  alternates: { canonical: "/tokushoho" },
  openGraph: { title: "特定商取引法に基づく表記" },
};

const ROWS: { label: string; body: React.ReactNode }[] = [
  { label: "販売事業者", body: "株式会社ｅビジネスソリューション" },
  { label: "代表者", body: "郭 亮" },
  { label: "所在地", body: "東京都江東区塩浜２－１３－９" },
  { label: "連絡先", body: "メールアドレス: support@lykuro.ai（受付時間: 平日10:00〜18:00）。電話番号はご請求があれば遅滞なく開示します。" },
  { label: "適格請求書発行事業者登録番号", body: "T3-0111-0104-6589" },
  {
    label: "販売価格",
    body: (
      <>
        基本版: 無料（掲載料・月額費用・成約手数料すべて0円）<br />
        PRO版: 月額 39,800円（税別・税込 43,780円）。担当者5名まで含み、6名以降は1名につき月額 4,000円（税別）。月払いのみ<br />
        詳細は <Link href="/pricing" className="text-orange-800 hover:underline">料金ページ</Link> をご覧ください。
      </>
    ),
  },
  { label: "商品代金以外の必要料金", body: "振込手数料（請求書払いの場合）、インターネット接続等の通信費用は利用企業の負担となります。" },
  { label: "支払方法", body: "請求書払い（銀行振込）。" },
  { label: "支払時期", body: "対象月の翌月末日まで（月末締め・翌月末払い）。利用開始当月は無料で、翌月分から請求します（日割り計算なし）。" },
  { label: "サービスの提供時期", body: "お申込（企業登録画面・会社マイページ・お問合せ）を運営が確認しプランを設定した後、直ちに企業コンソールでご利用いただけます。" },
  {
    label: "解約・返金",
    body: "当月末日までのお申し出により翌月から基本版へ変更（解約）できます。月の途中で解約した場合の当月分の返金は行いません。デジタルサービスの性質上、提供開始後の返品はできません。",
  },
  { label: "お試し期間", body: "PRO版には30日間のお試し期間があります。期間満了後は自動的に基本版に戻り、料金は発生しません。" },
  { label: "動作環境", body: "最新版の Google Chrome、Microsoft Edge、Safari。スマートフォンのブラウザにも対応しています（一部機能はPC専用）。" },
];

export default function TokushohoPage() {
  return (
    <article>
      <h1 className="text-xl font-bold text-stone-900">特定商取引法に基づく表記</h1>
      <p className="mt-2 text-xs text-stone-400">最終更新日: 2026年11月5日</p>
      <table className="mt-6 w-full border-t border-stone-200">
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label} className="border-b border-stone-200">
              <th scope="row" className={th}>
                {r.label}
              </th>
              <td className={td}>{r.body}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
