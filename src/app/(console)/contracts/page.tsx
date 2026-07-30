import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { listContracts } from "@/server/services/contracts";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";

export default async function ContractsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "contract.read")) {
    return <p className="text-sm text-slate-500">契約情報の閲覧権限がありません。</p>;
  }
  const contracts = await listContracts(auth);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">契約・稼働</h1>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">案件</th>
              <th className="px-4 py-3">人材</th>
              <th className="px-4 py-3">立場</th>
              <th className="px-4 py-3">契約形態</th>
              <th className="px-4 py-3">月額</th>
              <th className="px-4 py-3">稼働開始</th>
              <th className="px-4 py-3">状態</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c!.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/contracts/${c!.id}`} className="font-medium text-blue-700 hover:underline">
                    {c!.projectCode} {c!.projectName}
                  </Link>
                </td>
                <td className="px-4 py-3">{c!.engineerCode} {c!.engineerName}</td>
                <td className="px-4 py-3 text-xs">{c!.side === "DEMAND" ? "需要側" : "供給側"}</td>
                <td className="px-4 py-3">{c!.contractType}</td>
                <td className="px-4 py-3">{(c!.monthlyRateYen / 10_000).toLocaleString()}万円</td>
                <td className="px-4 py-3 text-xs">
                  {c!.workStartedAt ? new Date(c!.workStartedAt).toLocaleDateString("ja-JP") : "-"}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${
                    c!.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700"
                      : c!.status === "CANCELLED" || c!.status === "TERMINATED" ? "bg-slate-100 text-slate-500"
                      : "bg-amber-50 text-amber-700"
                  }`}>
                    {CONTRACT_STATUS_LABELS[c!.status]}
                  </span>
                </td>
              </tr>
            ))}
            {contracts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  契約はありません。エントリー詳細（双方承認後）から作成できます。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
