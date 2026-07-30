// ロール→権限マッピング（§7.2, §7.3）
// 最小権限RBAC。権限文字列は仕様書 §7.3 の形式に従う。

export const PERMISSIONS = [
  "dashboard.read",
  "engineer.read.masked",
  "engineer.read.pii",
  "engineer.create",
  "engineer.publish",
  "project.read",
  "project.create",
  "project.publish",
  "match.run",
  "ingestion.create",
  "ingestion.confirm",
  "consent.manage",
  "member.manage",
  "privacy.process",
  "audit.read",
  "entry.submit",
  "entry.approve",
  "entry.read",
  "message.send",
  "interview.manage",
  "relationship.manage",
  "report.create",
  "contract.read",
  "contract.create",
  "contract.sign",
  "workmonth.confirm",
  "billing.read",
  "billing.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  // 企業オーナー: 全権限（§7.2）
  OWNER: [...PERMISSIONS],
  // 企業管理者: 担当者、権限、企業設定
  ADMIN: [
    "dashboard.read",
    "engineer.read.masked",
    "project.read",
    "member.manage",
    "audit.read",
    "entry.read",
    "relationship.manage",
  ],
  // 営業担当: 案件、人材、マッチング、エントリー
  SALES: [
    "dashboard.read",
    "engineer.read.masked",
    "engineer.create",
    "project.read",
    "project.create",
    "project.publish",
    "match.run",
    "ingestion.create",
    "entry.submit",
    "entry.approve",
    "entry.read",
    "message.send",
    "interview.manage",
    "relationship.manage",
    "report.create",
    "contract.read",
    "contract.create",
  ],
  // 人材管理担当: 人材、スキルシート、本人同意、所属
  HR_MANAGER: [
    "dashboard.read",
    "engineer.read.masked",
    "engineer.read.pii",
    "engineer.create",
    "engineer.publish",
    "consent.manage",
    "ingestion.create",
    "ingestion.confirm",
    "entry.read",
    "entry.approve",
    "message.send",
  ],
  // 案件管理担当: 案件、候補、面談
  PROJECT_MANAGER: [
    "dashboard.read",
    "engineer.read.masked",
    "project.read",
    "project.create",
    "project.publish",
    "match.run",
    "ingestion.create",
    "ingestion.confirm",
    "entry.read",
    "entry.approve",
    "message.send",
    "interview.manage",
  ],
  // 契約担当: 基本契約、個別契約、署名（§7.2）
  CONTRACT: [
    "dashboard.read",
    "project.read",
    "engineer.read.masked",
    "entry.read",
    "contract.read",
    "contract.create",
    "contract.sign",
    "workmonth.confirm",
  ],
  // 経理担当: 手数料、請求、入金、返金（§7.2）
  ACCOUNTING: [
    "dashboard.read",
    "contract.read",
    "workmonth.confirm",
    "billing.read",
    "billing.manage",
  ],
  // 個人情報管理者: PII、訂正、削除、同意
  PRIVACY_OFFICER: [
    "dashboard.read",
    "engineer.read.masked",
    "engineer.read.pii",
    "consent.manage",
    "privacy.process",
  ],
  AUDITOR: ["dashboard.read", "audit.read"],
  VIEWER: ["dashboard.read", "engineer.read.masked", "project.read", "entry.read"],
};

export function permissionsOf(roles: string[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) set.add(p);
  }
  return set;
}

export function hasPermission(roles: string[], permission: Permission): boolean {
  return permissionsOf(roles).has(permission);
}
