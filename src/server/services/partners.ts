// 取引先の実名表示（2026-08-22 郭指示）
//
// 「企業間関係」に登録した取引先の他社案件・人材には掲載企業名を表示する。
// 自社が相手企業名を登録していれば表示する（片方向。2026-08-22 当初は相互登録を条件と
// していたが、同日の郭判断で片方向へ変更。登録名から掲載企業を特定できる点は許容する）。
// 名称の照合は企業重複判定と同じ正規化（法人格表記・全半角等のゆれ吸収）で行う。

import { prisma } from "@/server/db";
import { normalizeCompanyName } from "./company-duplicate";

// 企業間関係に登録済みの取引先テナントの Map（tenantCompanyId → 企業名）を返す。
// 関係種別は問わない（取引先・一社下・営業委任のいずれも取引実態の申告とみなす）
export async function registeredPartnerNames(companyId: string): Promise<Map<string, string>> {
  const myRels = await prisma.companyRelationship.findMany({
    where: { companyId },
    select: { partnerName: true },
  });
  if (myRels.length === 0) return new Map();
  const myTargets = new Set(myRels.map((r) => normalizeCompanyName(r.partnerName)));

  // 自社の登録名と一致する開通済みテナント
  const companies = await prisma.company.findMany({
    where: { id: { not: companyId }, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  return new Map(
    companies
      .filter((c) => myTargets.has(normalizeCompanyName(c.name)))
      .map((c) => [c.id, c.name])
  );
}
