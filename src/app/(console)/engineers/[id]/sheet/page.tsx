import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { buildSkillSheet, type SheetModel } from "@/server/services/skill-sheet";
import { PrintButton } from "@/components/PrintButton";

// スキルシートの印刷用ページ（PRO版仕様書 §4.7）。ブラウザの印刷から PDF 保存する（請求書帳票と同じ方式）。
// 可否（PRO・実名版の条件）はサービス側で判定する
export default async function SkillSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; template?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { id } = await params;
  const sp = await searchParams;
  const mode = sp.mode === "named" ? "named" : "anonymous";
  const result = await buildSkillSheet(auth, id, { mode, templateId: sp.template || "standard", format: "html" });
  if ("error" in result) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">{result.error.message ?? "出力できません"}</p>
      </div>
    );
  }
  const m = result as SheetModel;
  const en = m.engineer;
  const s = m.template.sections;
  const row = (label: string, value: React.ReactNode) => (
    <tr className="border-b border-stone-200">
      <th className="w-32 bg-stone-50 px-3 py-1.5 text-left text-xs font-medium text-stone-600">{label}</th>
      <td className="px-3 py-1.5">{value}</td>
    </tr>
  );
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href={`/engineers/${id}`} className="text-sm text-orange-800 hover:underline">← 人材詳細に戻る</a>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-8 text-sm shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="mb-4 flex items-end justify-between border-b-2 border-stone-800 pb-2">
          <h1 className="text-2xl font-bold tracking-wider">{m.template.title}</h1>
          <div className="text-right text-xs text-stone-600">
            {m.companyName && <p className="font-medium">{m.companyName}</p>}
            <p>作成日: {m.generatedAt.toISOString().slice(0, 10)}</p>
            <p>{m.mode === "named" ? "実名版" : "匿名版"}</p>
          </div>
        </div>
        <table className="mb-4 w-full border border-stone-200">
          <tbody>
            {row("人材ID", en.code)}
            {en.name && row("氏名", en.name)}
            {row("年代", en.ageBand)}
            {row("所属区分", en.affiliation)}
            {s.conditions && row(m.mode === "named" ? "希望単価" : "単価帯", en.rate)}
            {s.conditions && row("居住エリア", en.residenceCity ?? "-")}
            {s.conditions && row("稼働可能日", en.availableFrom ?? "即日")}
            {s.conditions && row("在宅・出社", `${en.remote}${en.maxOnsiteDaysPerWeek != null ? `（週${en.maxOnsiteDaysPerWeek}日まで出社可）` : ""}`)}
          </tbody>
        </table>
        {s.summary && (
          <section className="mb-4">
            <h2 className="mb-1 border-l-4 border-stone-800 pl-2 font-bold">概要</h2>
            <p className="whitespace-pre-wrap">{en.summary || "-"}</p>
          </section>
        )}
        {s.skills && (
          <section className="mb-4">
            <h2 className="mb-1 border-l-4 border-stone-800 pl-2 font-bold">スキル</h2>
            <table className="w-full border border-stone-200 text-xs">
              <thead className="bg-stone-50 text-left">
                <tr>
                  <th className="px-2 py-1">分類</th>
                  <th className="px-2 py-1">技術</th>
                  <th className="px-2 py-1 text-right">経験</th>
                </tr>
              </thead>
              <tbody>
                {en.skills.map((sk, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="px-2 py-1 text-stone-500">{sk.category}</td>
                    <td className="px-2 py-1">{sk.name}</td>
                    <td className="px-2 py-1 text-right">{sk.months != null ? `${sk.months}ヶ月` : "-"}</td>
                  </tr>
                ))}
                {en.skills.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-2 text-stone-400">-</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}
        {s.processes && (
          <section className="mb-2">
            <h2 className="mb-1 border-l-4 border-stone-800 pl-2 font-bold">経験工程</h2>
            <p>{en.processes.join(" / ") || "-"}</p>
          </section>
        )}
        {s.roles && (
          <section className="mb-2">
            <h2 className="mb-1 border-l-4 border-stone-800 pl-2 font-bold">役割</h2>
            <p>{en.roles.join(" / ") || "-"}</p>
          </section>
        )}
        {s.industries && (
          <section className="mb-2">
            <h2 className="mb-1 border-l-4 border-stone-800 pl-2 font-bold">業種経験</h2>
            <p>{en.industries.join(" / ") || "-"}</p>
          </section>
        )}
        {m.template.footerNote && <p className="mt-6 border-t border-stone-200 pt-2 text-xs text-stone-500">{m.template.footerNote}</p>}
      </div>
    </div>
  );
}
