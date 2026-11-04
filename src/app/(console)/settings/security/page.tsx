import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { hasFeature } from "@/server/plan/features";
import { getSecuritySettings } from "@/server/auth/mfa";
import { MfaRequirementToggle, MfaSetup } from "@/components/MfaSetup";

// セキュリティ設定（PRO版仕様書 §4.11, §11）: 本人の2要素認証と、企業の必須化（PRO）
export default async function SecuritySettingsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const canManage = hasPermission(auth.roles, "company.manage");
  const settings = canManage ? await getSecuritySettings(auth) : null;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/company" className="text-sm text-blue-700 hover:underline">← 会社マイページ</Link>
        <h1 className="mb-2 mt-2 text-2xl font-bold">セキュリティ</h1>
        <p className="text-sm text-slate-500">ログインの2要素認証（認証アプリ）。企業全体への必須化は PRO 版で設定できます。</p>
      </div>
      <MfaSetup required={auth.mfaRequired} />
      {settings && (
        <MfaRequirementToggle initial={settings.mfaRequired} members={settings.members} canManage={canManage} pro={hasFeature(auth, "mfa_required")} />
      )}
    </div>
  );
}
