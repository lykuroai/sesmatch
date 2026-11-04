import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasFeature } from "@/server/plan/features";
import { hasPermission } from "@/server/auth/rbac";
import { WebhookAdmin } from "@/components/WebhookAdmin";

// 外部通知（Slack／Teams Webhook）の管理画面（PRO版仕様書 §4.9, §11）
export default async function WebhooksPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return (
    <div>
      <Link href="/company" className="text-sm text-blue-700 hover:underline">← 会社マイページ</Link>
      <h1 className="mb-2 mt-2 text-2xl font-bold">
        外部通知（Webhook） <span className="ml-2 align-middle rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
      </h1>
      <p className="mb-6 text-sm text-slate-500">新着アラート・商談申込み・双方承認・面談設定・メッセージ受信・契約の署名依頼を Slack／Teams の Incoming Webhook へ通知します。</p>
      {!hasFeature(auth, "webhook_notify") ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm text-slate-700">
          Slack／Teams 通知は PRO 版の機能です。<Link href="/pricing" className="ml-2 text-emerald-700 hover:underline">料金を見る →</Link>
        </p>
      ) : !hasPermission(auth.roles, "company.manage") ? (
        <p className="text-sm text-slate-500">通知先の管理には company.manage 権限が必要です。</p>
      ) : (
        <WebhookAdmin />
      )}
    </div>
  );
}
