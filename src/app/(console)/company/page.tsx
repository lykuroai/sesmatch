import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";

// 会社マイページ: 企業に関する管理機能の入口（ヘッダー右の会社名から遷移）
const SECTIONS = [
  { href: "/settings/company", label: "企業情報", desc: "企業名・事業者種別・法人番号の確認と修正" },
  { href: "/settings/members", label: "担当者", desc: "担当者の招待・ロール変更・停止" },
  { href: "/billing", label: "請求", desc: "成約手数料・請求書・入金の管理" },
  { href: "/reports", label: "通報", desc: "再転載・無承認再仲介などの通報" },
  { href: "/audit", label: "監査", desc: "監査ログの閲覧" },
];

export default async function CompanyMyPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const [company, memberCount] = await Promise.all([
    prisma.company.findUnique({ where: { id: auth.companyId } }),
    prisma.companyMember.count({ where: { companyId: auth.companyId, status: "ACTIVE" } }),
  ]);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">{company?.name ?? auth.companyName}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {company?.companyType === "CORPORATION" ? "法人" : "個人事業主"}
        {company?.corporateNumber && ` ／ 法人番号 ${company.corporateNumber}`}
        {` ／ 担当者 ${memberCount}名`}
      </p>
      <div className="grid grid-cols-3 gap-4">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50 hover:shadow"
          >
            <p className="font-bold">{s.label}</p>
            <p className="mt-1 text-xs text-slate-500">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
