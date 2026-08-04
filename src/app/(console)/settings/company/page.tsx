import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { hasPermission } from "@/server/auth/rbac";
import { CompanyProfileForm } from "@/components/CompanyProfileForm";

// 企業情報（企業オーナー・企業管理者が修正可）
export default async function CompanySettingsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const company = await prisma.company.findUnique({ where: { id: auth.companyId } });
  if (!company) redirect("/login");
  const canManage = hasPermission(auth.roles, "company.manage");

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">企業情報</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {canManage ? (
          <CompanyProfileForm
            company={{
              name: company.name,
              companyType: company.companyType,
              corporateNumber: company.corporateNumber,
              address: company.address,
            }}
          />
        ) : (
          <dl className="max-w-lg space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">企業名</dt>
              <dd className="mt-0.5 font-medium">{company.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">事業者種別</dt>
              <dd className="mt-0.5">
                {company.companyType === "CORPORATION" ? "法人" : "個人事業主"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">法人番号</dt>
              <dd className="mt-0.5">{company.corporateNumber ?? "未登録"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">所在地</dt>
              <dd className="mt-0.5">{company.address ?? "未登録"}</dd>
            </div>
          </dl>
        )}
      </section>
      {!canManage && (
        <p className="mt-3 text-xs text-slate-500">
          企業情報の修正は企業オーナー・企業管理者のみ行えます。
        </p>
      )}
    </div>
  );
}
