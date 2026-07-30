import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { ReportForm } from "@/components/ReportForm";

// 通報・異議申立て（§24, Phase 2）
// 通報は運営が審査する（運営コンソールは対象外のため、本画面は登録と自社通報の閲覧のみ）
export default async function ReportsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const canReport = hasPermission(auth.roles, "report.create");
  const items = canReport
    ? await prisma.report.findMany({
        where: { tenantCompanyId: auth.companyId },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">通報・異議申立て</h1>
      <p className="mb-6 text-sm text-slate-500">
        再転載、無承認再仲介、直接取引の誘引、所属偽装等を発見した場合に通報できます。内容は運営が審査します。
      </p>
      {canReport ? (
        <>
          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-bold">通報する</h2>
            <ReportForm />
          </section>
          <div className="space-y-3">
            {items.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{r.category}</p>
                  <span className={`rounded px-2 py-0.5 text-xs ${
                    r.status === "OPEN" ? "bg-amber-50 text-amber-700" : r.status === "RESOLVED" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                  }`}>
                    {r.status === "OPEN" ? "受付済み" : r.status === "REVIEWING" ? "審査中" : "対応済み"}
                  </span>
                </div>
                {r.targetRef && <p className="mt-1 text-xs text-slate-500">対象: {r.targetRef}</p>}
                <p className="mt-2 text-sm text-slate-600">{r.body}</p>
                <p className="mt-2 text-xs text-slate-400">{new Date(r.createdAt).toLocaleString("ja-JP")}</p>
              </div>
            ))}
            {items.length === 0 && <p className="text-sm text-slate-400">通報はありません</p>}
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500">通報の権限がありません。</p>
      )}
    </div>
  );
}
