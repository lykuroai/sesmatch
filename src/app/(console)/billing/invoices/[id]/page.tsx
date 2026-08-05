import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { getInvoiceDocument } from "@/server/services/billing";
import { PrintButton } from "@/components/PrintButton";

// 請求書帳票（§23）: 需要側企業向けの印刷・PDF保存用レイアウト
export default async function InvoiceDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "billing.read")) {
    return <p className="text-sm text-slate-500">請求情報の閲覧権限がありません（billing.read）。</p>;
  }
  const { id } = await params;
  const inv = await getInvoiceDocument(auth, id);
  if (!inv) notFound();

  const fmtDate = (d: Date) => new Date(d).toLocaleDateString("ja-JP");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/billing" className="text-sm text-blue-700 hover:underline">
          ← 請求に戻る
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <h1 className="mb-6 text-center text-2xl font-bold tracking-widest">請 求 書</h1>

        <div className="mb-6 flex items-start justify-between text-sm">
          <div>
            <p className="border-b border-slate-400 pb-1 text-lg font-bold">
              {inv.companyName} 御中
            </p>
            <p className="mt-4">下記のとおりご請求申し上げます。</p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>請求書番号: {inv.id}</p>
            <p>発行日: {fmtDate(inv.issuedAt)}</p>
            <p>対象月: {inv.month}</p>
            <p className="mt-2 font-medium">株式会社ｅビジネスソリューション</p>
            <p>登録番号: T3-0111-0104-6589</p>
          </div>
        </div>

        <div className="mb-6 rounded border border-slate-300 p-3 text-center">
          <span className="mr-4 text-sm">ご請求金額（税込）</span>
          <span className="text-2xl font-bold">{inv.totalYen.toLocaleString()}円</span>
        </div>

        <table className="mb-6 w-full text-sm">
          <thead className="border-b-2 border-slate-400 text-left text-xs text-slate-600">
            <tr>
              <th className="py-2">対象月</th>
              <th className="py-2">案件</th>
              <th className="py-2">人材</th>
              <th className="py-2">基準額</th>
              <th className="py-2">稼働月</th>
              <th className="py-2 text-right">手数料（税抜）</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-200">
                <td className="py-2">{l.month}</td>
                <td className="py-2">{l.projectLabel}</td>
                <td className="py-2">{l.engineerLabel}</td>
                <td className="py-2">{l.baseAmountYen.toLocaleString()}円</td>
                <td className="py-2">{l.chargeableMonthIndex}稼働月目</td>
                <td className="py-2 text-right">{l.feeExTaxYen.toLocaleString()}円</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-64 text-sm">
          <div className="flex justify-between border-b border-slate-200 py-1.5">
            <span>小計（税抜）</span>
            <span>{inv.feeExTaxYen.toLocaleString()}円</span>
          </div>
          <div className="flex justify-between border-b border-slate-200 py-1.5">
            <span>消費税</span>
            <span>{inv.taxYen.toLocaleString()}円</span>
          </div>
          <div className="flex justify-between border-b-2 border-slate-400 py-1.5 font-bold">
            <span>合計</span>
            <span>{inv.totalYen.toLocaleString()}円</span>
          </div>
        </div>

        <div className="mt-6 rounded border border-slate-300 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-slate-500">お振込先</p>
          <p>三菱UFJ銀行 上野中央支店 普通 0720675</p>
          <p>カ）イービジネスソリューション</p>
        </div>

      </div>
    </div>
  );
}
