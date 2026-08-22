// 相互取引先の実名表示（2026-08-22 郭指示）
//
// 「企業間関係」に登録した取引先の他社案件・人材には掲載企業名を表示する。
// ただし片方向の登録では表示しない（企業名を自由入力で登録するだけで、他社の匿名掲載の
// 保有企業を特定できてしまうため）。自社が相手を登録し、かつ相手も自社を登録している
// 「相互登録」の場合のみ、双方の画面で相互に実名を表示する（Level 1 匿名の例外）。
// 名称の照合は企業重複判定と同じ正規化（法人格表記・全半角等のゆれ吸収）で行う。

import { prisma } from "@/server/db";
import { normalizeCompanyName } from "./company-duplicate";

// 相互登録が成立している取引先テナントの Map（tenantCompanyId → 企業名）を返す。
// 関係種別は問わない（取引先・一社下・営業委任のいずれも取引実態の申告とみなす）
export async function mutualPartnerNames(companyId: string): Promise<Map<string, string>> {
  const [me, myRels] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    prisma.companyRelationship.findMany({
      where: { companyId },
      select: { partnerName: true },
    }),
  ]);
  if (!me || myRels.length === 0) return new Map();
  const myTargets = new Set(myRels.map((r) => normalizeCompanyName(r.partnerName)));

  // 自社の登録名と一致する開通済みテナント
  const companies = await prisma.company.findMany({
    where: { id: { not: companyId }, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const candidates = companies.filter((c) => myTargets.has(normalizeCompanyName(c.name)));
  if (candidates.length === 0) return new Map();

  // 相手側も自社を登録しているか（相互確認）
  const myName = normalizeCompanyName(me.name);
  const reverse = await prisma.companyRelationship.findMany({
    where: { companyId: { in: candidates.map((c) => c.id) } },
    select: { companyId: true, partnerName: true },
  });
  const confirmed = new Set(
    reverse
      .filter((r) => normalizeCompanyName(r.partnerName) === myName)
      .map((r) => r.companyId)
  );
  return new Map(
    candidates.filter((c) => confirmed.has(c.id)).map((c) => [c.id, c.name])
  );
}
