import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { RelationshipForm, RelationshipTable } from "@/components/RelationshipForm";

// 企業間関係: 取引先・一社下・営業委任（§8.2, §12.4）
export default async function RelationshipsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const canManage = hasPermission(auth.roles, "relationship.manage");
  const items = await prisma.companyRelationship.findMany({
    where: { companyId: auth.companyId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">企業間関係</h1>
      <p className="mb-6 text-sm text-slate-500">
        一社下人材を提案するには、直接契約が確認済みの「一社下」関係の登録が必要です（最大商流1・二社下以降は禁止）。
        また、<b>ここに登録した取引先</b>の案件・人材には掲載企業名が表示されます
        （相手企業が本サービスに登録済みの場合。人材本人の氏名等の開示は従来どおり双方承認後です）。
      </p>
      {canManage && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">関係を登録</h2>
          <RelationshipForm />
        </section>
      )}
      <RelationshipTable
        items={items.map((r) => ({
          id: r.id,
          partnerName: r.partnerName,
          type: r.type,
          contractConfirmed: r.contractConfirmed,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        }))}
        canManage={canManage}
      />
    </div>
  );
}
