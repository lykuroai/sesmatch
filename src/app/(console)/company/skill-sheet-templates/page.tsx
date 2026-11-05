import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasFeature } from "@/server/plan/features";
import { SkillSheetTemplateAdmin } from "@/components/SkillSheetTemplateAdmin";

// スキルシート書式（自社テンプレート）の管理画面（PRO版仕様書 §4.7, §11）
export default async function SkillSheetTemplatesPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return (
    <div>
      <Link href="/company" className="text-sm text-orange-800 hover:underline">← 会社マイページ</Link>
      <h1 className="mb-2 mt-2 text-2xl font-bold">
        スキルシート書式 <span className="ml-2 align-middle rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
      </h1>
      <p className="mb-6 text-sm text-stone-500">人材データから自社書式のスキルシート（印刷用・Excel）を生成します。匿名版は Level 1 情報のみ、実名版は自社人材（PII 権限）または双方承認済みの他社人材に限ります。</p>
      {hasFeature(auth, "skill_sheet_render") ? (
        <SkillSheetTemplateAdmin />
      ) : (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm text-stone-700">
          スキルシート再生成は PRO 版の機能です。<Link href="/pricing" className="ml-2 text-emerald-700 hover:underline">料金を見る →</Link>
        </p>
      )}
    </div>
  );
}
