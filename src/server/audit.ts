import { prisma } from "@/server/db";

// 追記型監査ログ（§31, §32）。更新・削除は行わないこと。
export async function audit(params: {
  tenantCompanyId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      tenantCompanyId: params.tenantCompanyId,
      actorUserId: params.actorUserId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata as object | undefined,
    },
  });
}
