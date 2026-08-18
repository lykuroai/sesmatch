// デモ用シード: 2社（A社=需要側の案件保有、B社=供給側の人材保有）を作成し、
// 双方向マッチングを試せる状態にする。

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  // ---- A社（案件を多く持つ企業）----
  const companyA = await prisma.company.create({
    data: { name: "株式会社アルファシステムズ", companyType: "CORPORATION", status: "ACTIVE" },
  });
  const ownerA = await prisma.userAccount.create({
    data: { email: "owner-a@example.com", passwordHash, name: "青山 一郎" },
  });
  const memberA = await prisma.companyMember.create({
    data: { companyId: companyA.id, userAccountId: ownerA.id },
  });
  await prisma.companyMemberRole.createMany({
    data: [{ memberId: memberA.id, role: "OWNER" }],
  });
  const salesA = await prisma.userAccount.create({
    data: { email: "sales-a@example.com", passwordHash, name: "浅野 二郎" },
  });
  const salesMemberA = await prisma.companyMember.create({
    data: { companyId: companyA.id, userAccountId: salesA.id },
  });
  await prisma.companyMemberRole.createMany({
    data: [{ memberId: salesMemberA.id, role: "SALES" }],
  });

  // ---- B社（人材を多く持つ企業）----
  const companyB = await prisma.company.create({
    data: { name: "ベータテクノロジー株式会社", companyType: "CORPORATION", status: "ACTIVE" },
  });
  const ownerB = await prisma.userAccount.create({
    data: { email: "owner-b@example.com", passwordHash, name: "別府 花子" },
  });
  const memberB = await prisma.companyMember.create({
    data: { companyId: companyB.id, userAccountId: ownerB.id },
  });
  await prisma.companyMemberRole.createMany({
    data: [{ memberId: memberB.id, role: "OWNER" }],
  });
  const hrB = await prisma.userAccount.create({
    data: { email: "hr-b@example.com", passwordHash, name: "堀田 三郎" },
  });
  const hrMemberB = await prisma.companyMember.create({
    data: { companyId: companyB.id, userAccountId: hrB.id },
  });
  await prisma.companyMemberRole.createMany({
    data: [{ memberId: hrMemberB.id, role: "HR_MANAGER" }],
  });

  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
  const monthsAgo = (m: number) => new Date(Date.now() - m * 30 * 86_400_000);

  // ---- A社の案件 ----
  await prisma.project.create({
    data: {
      tenantCompanyId: companyA.id,
      code: "P000001",
      name: "大手金融機関向け 勘定系周辺システム更改",
      anonymousSummary:
        "大手金融機関の勘定系周辺システムの更改案件。Java/Spring Boot によるバックエンド開発。基本設計から結合テストまで。",
      industry: "金融",
      headcount: 2,
      startDate: inDays(30),
      locationCity: "千代田区",
      onsiteDaysPerWeek: 2,
      remoteLevel: "R2",
      rateMinYen: 650_000,
      rateMaxYen: 800_000,
      contractType: "準委任",
      allowSubtier: false,
      acceptedTypes: ["EMPLOYEE", "AFFILIATED", "FREELANCER"],
      processes: ["基本設計", "開発", "テスト"],
      status: "PUBLISHED",
      skills: {
        create: [
          { name: "Java", required: true, minMonths: 36 },
          { name: "Spring Boot", required: true, minMonths: 24 },
          { name: "AWS", required: false },
          { name: "Docker", required: false },
        ],
      },
    },
  });
  await prisma.project.create({
    data: {
      tenantCompanyId: companyA.id,
      code: "P000002",
      name: "国内通信事業者向け Webフロント刷新",
      anonymousSummary:
        "国内通信事業者の顧客向けポータルのフロントエンド刷新。React/TypeScript。フルリモート（緊急出社の可能性あり）。",
      industry: "通信",
      headcount: 1,
      startDate: inDays(14),
      locationCity: "港区",
      onsiteDaysPerWeek: 0,
      remoteLevel: "R4",
      rateMaxYen: 750_000,
      contractType: "準委任",
      allowSubtier: true,
      acceptedTypes: ["EMPLOYEE", "AFFILIATED", "FREELANCER", "SUBTIER1"],
      processes: ["詳細設計", "開発"],
      status: "PUBLISHED",
      skills: {
        create: [
          { name: "TypeScript", required: true, minMonths: 24 },
          { name: "React", required: true, minMonths: 24 },
          { name: "Next.js", required: false },
        ],
      },
    },
  });

  // ---- B社の人材 ----
  const consent = (validDays = 365) => ({
    create: [
      {
        consentedAt: new Date(),
        method: "メール",
        documentVersion: "v1.0",
        purposes: ["マッチング", "段階開示", "LLM匿名化処理"],
        validUntil: inDays(validDays),
      },
    ],
  });

  await prisma.engineer.create({
    data: {
      tenantCompanyId: companyB.id,
      code: "E000001",
      name: "谷口 健",
      ageBand: 35,
      affiliationType: "EMPLOYEE",
      residenceCity: "川崎市",
      nearestStation: "武蔵小杉",
      availableFrom: inDays(20),
      desiredRateYen: 720_000,
      maxOnsiteDaysPerWeek: 3,
      remotePreference: "R2",
      workAuthStatus: "NOT_REQUIRED",
      status: "PUBLISHED",
      summary: "金融系基幹システムのバックエンド開発を10年以上経験。設計からテストまで一貫して対応可能。",
      processes: ["基本設計", "詳細設計", "開発", "テスト"],
      roles: ["リーダー"],
      industries: ["金融", "保険"],
      skills: {
        create: [
          { category: "LANGUAGE", name: "Java", months: 120, lastUsedAt: monthsAgo(1) },
          { category: "FRAMEWORK", name: "Spring Boot", months: 60, lastUsedAt: monthsAgo(1) },
          { category: "DATABASE", name: "Oracle", months: 96, lastUsedAt: monthsAgo(6) },
          { category: "CLOUD", name: "AWS", months: 36, lastUsedAt: monthsAgo(2) },
        ],
      },
      consents: consent(),
    },
  });

  await prisma.engineer.create({
    data: {
      tenantCompanyId: companyB.id,
      code: "E000002",
      name: "内村 沙織",
      ageBand: 30,
      affiliationType: "AFFILIATED",
      residenceCity: "横浜市",
      availableFrom: inDays(7),
      desiredRateYen: 680_000,
      maxOnsiteDaysPerWeek: 0,
      remotePreference: "R4",
      workAuthStatus: "NOT_REQUIRED",
      status: "PUBLISHED",
      summary: "Web系フロントエンド開発5年。React/TypeScript を中心にモダンフロントの設計・開発を担当。",
      processes: ["詳細設計", "開発", "テスト"],
      roles: [],
      industries: ["通信", "EC"],
      skills: {
        create: [
          { category: "LANGUAGE", name: "TypeScript", months: 60, lastUsedAt: monthsAgo(0) },
          { category: "FRAMEWORK", name: "React", months: 60, lastUsedAt: monthsAgo(0) },
          { category: "FRAMEWORK", name: "Next.js", months: 24, lastUsedAt: monthsAgo(0) },
          { category: "TOOL", name: "Docker", months: 36, lastUsedAt: monthsAgo(1) },
        ],
      },
      consents: consent(),
    },
  });

  // 同意なし人材（公開不可のテスト用: DRAFT のまま）
  await prisma.engineer.create({
    data: {
      tenantCompanyId: companyB.id,
      code: "E000003",
      name: "江藤 実",
      ageBand: 40,
      affiliationType: "SUBTIER1",
      residenceCity: "さいたま市",
      availableFrom: inDays(45),
      desiredRateYen: 600_000,
      maxOnsiteDaysPerWeek: 5,
      remotePreference: "R0",
      workAuthStatus: "NOT_REQUIRED",
      status: "DRAFT",
      summary: "インフラ構築・運用の経験が長い。一社下所属。",
      processes: ["運用", "保守"],
      roles: [],
      industries: ["製造"],
      skills: {
        create: [
          { category: "OS", name: "Linux", months: 120, lastUsedAt: monthsAgo(1) },
          { category: "CLOUD", name: "AWS", months: 48, lastUsedAt: monthsAgo(3) },
        ],
      },
    },
  });

  // B社の案件（双方向を示すため）
  await prisma.project.create({
    data: {
      tenantCompanyId: companyB.id,
      code: "P000003",
      name: "製造業向け 生産管理システム保守開発",
      anonymousSummary: "大手製造業の生産管理システムの保守開発。Python 中心。",
      industry: "製造",
      headcount: 1,
      startDate: inDays(21),
      locationCity: "名古屋市",
      onsiteDaysPerWeek: 5,
      remoteLevel: "R0",
      rateMaxYen: 600_000,
      contractType: "準委任",
      acceptedTypes: ["EMPLOYEE", "AFFILIATED"],
      processes: ["開発", "保守"],
      status: "PUBLISHED",
      skills: {
        create: [{ name: "Python", required: true, minMonths: 24 }],
      },
    },
  });

  // A社の人材（少数）
  await prisma.engineer.create({
    data: {
      tenantCompanyId: companyA.id,
      code: "E000004",
      name: "安藤 大輔",
      ageBand: 25,
      affiliationType: "EMPLOYEE",
      residenceCity: "世田谷区",
      availableFrom: inDays(10),
      desiredRateYen: 550_000,
      maxOnsiteDaysPerWeek: 5,
      remotePreference: "R0",
      workAuthStatus: "NOT_REQUIRED",
      status: "PUBLISHED",
      summary: "Python によるデータ連携基盤の開発経験3年。",
      processes: ["開発", "テスト"],
      roles: [],
      industries: ["製造", "物流"],
      skills: {
        create: [
          { category: "LANGUAGE", name: "Python", months: 36, lastUsedAt: monthsAgo(0) },
          { category: "DATABASE", name: "PostgreSQL", months: 24, lastUsedAt: monthsAgo(2) },
        ],
      },
      consents: consent(),
    },
  });

  console.log("Seed 完了:");
  console.log("  A社: owner-a@example.com / password123（オーナー）, sales-a@example.com（営業）");
  console.log("  B社: owner-b@example.com / password123（オーナー）, hr-b@example.com（人材管理）");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
