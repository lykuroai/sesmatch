import { prisma } from "@/server/db";

// 運営コンソール用の監視ビュー。テナント横断で参照するため、
// 運営トークン必須の /operations API からのみ呼ぶこと。

// 各契約の稼働状況・金額・手数料の一覧（§22/§23 の監視）
export async function listContractsForOperations() {
  const contracts = await prisma.contract.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { workMonths: { include: { fee: true }, orderBy: { month: "asc" } } },
  });

  const companyIds = [...new Set(contracts.flatMap((c) => [c.demandCompanyId, c.supplyCompanyId]))];
  const projectIds = [...new Set(contracts.map((c) => c.projectId))];
  const engineerIds = [...new Set(contracts.map((c) => c.engineerId))];
  const [companies, projects, engineers] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, code: true, name: true },
    }),
    prisma.engineer.findMany({
      where: { id: { in: engineerIds } },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const engineerMap = new Map(engineers.map((e) => [e.id, e]));

  return contracts.map((c) => {
    const fees = c.workMonths.flatMap((w) => (w.fee ? [w.fee] : []));
    const project = projectMap.get(c.projectId);
    const engineer = engineerMap.get(c.engineerId);
    return {
      id: c.id,
      status: c.status,
      contractType: c.contractType,
      monthlyRateYen: c.monthlyRateYen,
      startDate: c.startDate,
      endDate: c.endDate,
      workStartedAt: c.workStartedAt,
      terminatedAt: c.terminatedAt,
      demandCompanyName: companyName.get(c.demandCompanyId) ?? "-",
      supplyCompanyName: companyName.get(c.supplyCompanyId) ?? "-",
      projectCode: project?.code ?? "-",
      projectName: project?.name ?? "（削除済み案件）",
      engineerCode: engineer?.code ?? "-",
      engineerName: engineer?.name ?? "（削除済み人材）",
      confirmedMonths: c.workMonths.length,
      lastConfirmedMonth: c.workMonths.at(-1)?.month ?? null,
      totalConfirmedYen: c.workMonths.reduce((s, w) => s + w.confirmedAmountYen, 0),
      totalFeeExTaxYen: fees.reduce((s, f) => s + f.feeExTaxYen, 0),
      chargedMonths: fees.filter((f) => f.status === "CHARGED").length,
      freeMonths: fees.filter((f) => f.status === "FREE").length,
    };
  });
}

// 人材の稼働状況一覧。EXECUTED/ACTIVE の契約から稼働状態を導出する
export async function listEngineersWorkStatusForOperations() {
  const engineers = await prisma.engineer.findMany({
    where: { deletedAt: null },
    orderBy: [{ tenantCompanyId: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      availabilityRate: true,
      availableFrom: true,
      tenantCompanyId: true,
      tenantCompany: { select: { name: true } },
    },
  });
  const contracts = await prisma.contract.findMany({
    where: { status: { in: ["EXECUTED", "ACTIVE"] }, engineerId: { in: engineers.map((e) => e.id) } },
    select: {
      engineerId: true,
      status: true,
      projectId: true,
      demandCompanyId: true,
      monthlyRateYen: true,
      workStartedAt: true,
      endDate: true,
    },
  });
  const projectIds = [...new Set(contracts.map((c) => c.projectId))];
  const demandIds = [...new Set(contracts.map((c) => c.demandCompanyId))];
  const [projects, demandCompanies] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
    prisma.company.findMany({ where: { id: { in: demandIds } }, select: { id: true, name: true } }),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const demandName = new Map(demandCompanies.map((c) => [c.id, c.name]));
  // 同一人材に複数契約がある場合は稼働中を優先して代表1件を表示
  const byEngineer = new Map<string, (typeof contracts)[number]>();
  for (const c of contracts) {
    const cur = byEngineer.get(c.engineerId);
    if (!cur || (cur.status !== "ACTIVE" && c.status === "ACTIVE")) byEngineer.set(c.engineerId, c);
  }

  return engineers.map((e) => {
    const contract = byEngineer.get(e.id);
    const workStatus = !contract ? "STANDBY" : contract.status === "ACTIVE" ? "WORKING" : "CONTRACTED";
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      companyName: e.tenantCompany.name,
      publishStatus: e.status,
      availabilityRate: e.availabilityRate,
      availableFrom: e.availableFrom,
      workStatus, // WORKING=稼働中 / CONTRACTED=成約・稼働開始前 / STANDBY=待機
      assignment: contract
        ? {
            projectName: projectName.get(contract.projectId) ?? "（削除済み案件）",
            demandCompanyName: demandName.get(contract.demandCompanyId) ?? "-",
            monthlyRateYen: contract.monthlyRateYen,
            workStartedAt: contract.workStartedAt,
            endDate: contract.endDate,
          }
        : null,
    };
  });
}
