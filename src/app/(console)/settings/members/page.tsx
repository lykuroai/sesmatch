import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { hasPermission } from "@/server/auth/rbac";
import { InviteMemberForm, MemberRow } from "@/components/MemberAdmin";
import { ROLE_LABELS } from "@/lib/constants";

// 担当者・ロール管理（§7）
export default async function MembersPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const canManage = hasPermission(auth.roles, "member.manage");
  const members = await prisma.companyMember.findMany({
    where: { companyId: auth.companyId },
    include: { userAccount: true, roles: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">担当者</h1>
      {canManage && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">担当者を招待</h2>
          <InviteMemberForm />
        </section>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">氏名</th>
              <th className="px-4 py-3">メールアドレス</th>
              <th className="px-4 py-3">ロール</th>
              <th className="px-4 py-3">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) =>
              canManage ? (
                <MemberRow
                  key={m.id}
                  member={{
                    id: m.id,
                    name: m.userAccount.name,
                    email: m.userAccount.email,
                    roles: m.roles.map((r) => r.role),
                    status: m.status,
                    isOwner: m.roles.some((r) => r.role === "OWNER"),
                  }}
                />
              ) : (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{m.userAccount.name}</td>
                  <td className="px-4 py-3">{m.userAccount.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {m.roles.map((r) => (
                        <span key={r.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                          {ROLE_LABELS[r.role]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">{m.status === "ACTIVE" ? "有効" : m.status}</td>
                  <td />
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
