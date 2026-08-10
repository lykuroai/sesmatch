import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { getProject } from "@/server/services/projects";
import { hasPermission } from "@/server/auth/rbac";
import { ProjectForm } from "@/components/ProjectForm";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!hasPermission(auth.roles, "project.create")) redirect("/projects");
  const { id } = await params;
  const p = await getProject(auth, id);
  if (!p || !p.own) notFound();

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">案件を編集 — {p.code}</h1>
      <ProjectForm
        projectId={p.id}
        initial={{
          name: p.name,
          anonymousSummary: p.anonymousSummary,
          industry: p.industry,
          headcount: p.headcount,
          startDate: new Date(p.startDate).toISOString().slice(0, 10),
          locationCity: p.locationCity,
          contractType: p.contractType,
          dispatchConflictDate: p.dispatchConflictDate
            ? new Date(p.dispatchConflictDate).toISOString().slice(0, 10)
            : null,
          dispatchDemandManager: p.dispatchDemandManager,
          dispatchProhibitedConfirmed: p.dispatchProhibitedConfirmed,
          remoteLevel: p.remoteLevel,
          rateMaxMan: Math.round(p.rateMaxYen / 10_000),
          requiredSkills: p.requiredSkills.map((s) => s.name),
          preferredSkills: p.preferredSkills.map((s) => s.name),
          processes: p.processes,
          acceptedTypes: p.acceptedTypes,
          allowSubtier: p.allowSubtier,
          noForeignNational: p.noForeignNational,
        }}
      />
    </div>
  );
}
