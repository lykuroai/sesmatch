import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { listFees, listInvoices } from "@/server/services/billing";
import { FEE_STATUS_LABELS } from "@/lib/constants";
import { ActionButton } from "@/components/ActionButton";
import { InvoiceGenerateForm } from "@/components/InvoiceGenerateForm";

// 請求（§23）: 手数料は需要側企業負担。月別集計・請求書発行・入金記録。
export default async function BillingPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "billing.read")) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">請求</h1>
        <p className="text-sm text-slate-500">請求情報の閲覧権限がありません（billing.read）。</p>
      </div>
    );
  }
  const [fees, invoices] = await Promise.all([listFees(auth), listInvoices(auth)]);
  const canManage = hasPermission(auth.roles, "billing.manage");

  // 月別集計
  const byMonth = new Map<string, { charged: number; cancelled: number; count: number }>();
  for (const f of fees) {
    const m = byMonth.get(f.month) ?? { charged: 0, cancelled: 0, count: 0 };
    if (f.status === "CHARGED") m.charged += f.feeExTaxYen;
    if (f.status === "CANCELLED" || f.status === "REFUNDED") m.cancelled++;
    m.count++;
    byMonth.set(f.month, m);
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">請求（成約手数料）</h1>
      <p className="mb-6 text-sm text-slate-500">
        需要側企業として負担する手数料の一覧です。料率3%・最大12稼働月・13稼働月目以降無料（§23）。
      </p>

      {canManage && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">請求書発行</h2>
          <InvoiceGenerateForm />
        </section>
      )}

      <div className="mb-6 grid grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">月別手数料</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">月</th><th className="py-1">課金（税抜）</th><th className="py-1">キャンセル</th><th className="py-1">件数</th></tr>
            </thead>
            <tbody>
              {[...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, m]) => (
                <tr key={month} className="border-t border-slate-100">
                  <td className="py-1.5 font-medium">{month}</td>
                  <td className="py-1.5">{m.charged.toLocaleString()}円</td>
                  <td className="py-1.5 text-red-600">{m.cancelled > 0 ? `${m.cancelled}件` : "-"}</td>
                  <td className="py-1.5">{m.count}</td>
                </tr>
              ))}
              {byMonth.size === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-slate-400">手数料はありません</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">請求書</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">月</th><th className="py-1">税抜</th><th className="py-1">税込</th><th className="py-1">状態</th><th /></tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="py-1.5 font-medium">{inv.month}</td>
                  <td className="py-1.5">{inv.feeExTaxYen.toLocaleString()}円</td>
                  <td className="py-1.5">{inv.totalYen.toLocaleString()}円</td>
                  <td className="py-1.5 text-xs">{inv.status === "PAID" ? "入金済み" : "発行済み"}</td>
                  <td className="py-1.5 text-right">
                    <Link
                      href={`/billing/invoices/${inv.id}`}
                      className="mr-2 text-xs text-blue-700 hover:underline"
                    >
                      帳票
                    </Link>
                    {canManage && inv.status === "ISSUED" && (
                      <ActionButton path={`/api/v1/invoices/${inv.id}/pay`} label="入金記録" />
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-slate-400">請求書はありません</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-bold">手数料明細</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">月</th><th className="py-1">基準額</th><th className="py-1">手数料（税抜）</th>
              <th className="py-1">稼働月</th><th className="py-1">状態</th><th className="py-1">請求</th>
            </tr>
          </thead>
          <tbody>
            {fees.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="py-1.5">{f.month}</td>
                <td className="py-1.5">{f.baseAmountYen.toLocaleString()}円</td>
                <td className="py-1.5 font-medium">{f.feeExTaxYen.toLocaleString()}円</td>
                <td className="py-1.5">{f.chargeableMonthIndex}稼働月目</td>
                <td className="py-1.5 text-xs">{FEE_STATUS_LABELS[f.status]}</td>
                <td className="py-1.5 text-xs">{f.invoiceId ? "請求済み" : "未請求"}</td>
              </tr>
            ))}
            {fees.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-slate-400">手数料はありません</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
