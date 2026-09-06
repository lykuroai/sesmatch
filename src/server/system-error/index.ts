// システムエラーの記録と運営への通知（§33 監視）。
// - DB（system_error_logs）へ記録し、運営コンソール /admin#errors で一覧できる
// - OPERATIONS_MAIL が設定されていれば運営へメール通知（同一内容は30分以内は再通知しない）
// - 業務処理を失敗させないため、この関数自体は決して例外を投げない
import { prisma } from "@/server/db";
import { appBaseUrl, sendMail } from "@/server/mail";
import {
  DETAIL_MAX,
  MESSAGE_MAX,
  NOTIFY_SUPPRESS_MS,
  buildNotificationMail,
  errorDetailOf,
  errorMessageOf,
  shouldNotify,
  truncate,
  type SystemErrorSource,
} from "./logic";

export type { SystemErrorSource } from "./logic";
export * from "./logic";

export async function reportSystemError(input: {
  source: SystemErrorSource;
  message: string;
  detail?: string;
  error?: unknown; // 渡されれば detail をスタックトレースで補う
  tenantCompanyId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  notify?: boolean; // false: DB 記録のみ（メール送信自体の失敗など、通知がループするもの）
}): Promise<void> {
  const now = new Date();
  const message = truncate(input.message, MESSAGE_MAX) ?? "";
  const detail = truncate(input.detail ?? errorDetailOf(input.error), DETAIL_MAX);
  console.error(`[system-error] ${input.source}: ${message}`);
  try {
    const opsMail = process.env.OPERATIONS_MAIL;
    let notify = input.notify !== false && !!opsMail;
    if (notify) {
      const last = await prisma.systemErrorLog.findFirst({
        where: {
          source: input.source,
          message,
          notifiedAt: { gte: new Date(now.getTime() - NOTIFY_SUPPRESS_MS) },
        },
        orderBy: { notifiedAt: "desc" },
        select: { notifiedAt: true },
      });
      notify = shouldNotify(last?.notifiedAt, now);
    }
    const log = await prisma.systemErrorLog.create({
      data: {
        source: input.source,
        message,
        detail,
        tenantCompanyId: input.tenantCompanyId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        notifiedAt: notify ? now : null,
      },
    });
    if (!notify || !opsMail) return;

    const company = input.tenantCompanyId
      ? await prisma.company.findUnique({
          where: { id: input.tenantCompanyId },
          select: { name: true },
        })
      : null;
    const mail = buildNotificationMail({
      source: input.source,
      message,
      detail,
      tenantCompanyName: company?.name,
      targetType: input.targetType,
      targetId: input.targetId,
      occurredAt: log.createdAt,
      adminUrl: `${appBaseUrl()}/admin#errors`,
    });
    await sendMail({ to: opsMail, ...mail });
  } catch (e) {
    // 記録・通知の失敗はログのみ（業務処理を止めない）
    console.error("[system-error] 記録・通知に失敗", errorMessageOf(e));
  }
}
