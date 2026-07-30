import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { getEngineer } from "@/server/services/engineers";
import { hasPermission } from "@/server/auth/rbac";
import { EngineerForm } from "@/components/EngineerForm";

export default async function EditEngineerPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "engineer.create")) redirect("/engineers");
  const { id } = await params;
  const e = await getEngineer(auth, id);
  if (!e || !e.own) notFound();

  // ageBand ラベル（"35〜39歳"）から下限値を復元
  const ageBand = parseInt(e.ageBand);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">人材を編集 — {e.code}</h1>
      <EngineerForm
        engineerId={e.id}
        initial={{
          name: e.name, // PII権限がなければ undefined → 氏名は変更不可
          ageBand: Number.isFinite(ageBand) ? ageBand : 30,
          affiliationType: e.affiliationType,
          residenceCity: e.residenceCity,
          availableFrom: e.availableFrom
            ? new Date(e.availableFrom).toISOString().slice(0, 10)
            : null,
          desiredRateMan: e.desiredRateYen ? Math.round(e.desiredRateYen / 10_000) : undefined,
          maxOnsiteDaysPerWeek: e.maxOnsiteDaysPerWeek,
          remotePreference: e.remotePreference,
          processes: e.processes,
          industries: e.industries,
          skills: e.skills.map((s) => ({ name: s.name, category: s.category, months: s.months })),
          summary: e.summary,
        }}
      />
      {e.desiredRateYen === undefined && (
        <p className="mt-3 text-xs text-amber-600">
          注意: engineer.read.pii 権限がないため実額単価を表示できません。希望単価欄には正しい値を入力し直してください。
        </p>
      )}
    </div>
  );
}
