import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { hasFeature } from "@/server/plan/features";
import { getSecuritySettings } from "@/server/auth/mfa";
import { getSecurityOverview } from "@/server/auth/security";
import { clientIpFromHeaders } from "@/server/auth/ip";
import { MfaRequirementToggle, MfaSetup } from "@/components/MfaSetup";
import { IpRestrictionPanel, SsoSettingsPanel } from "@/components/SecuritySettings";

// セキュリティ設定（PRO版仕様書 §4.11〜§4.13, §11）: 本人の2要素認証、企業の必須化（PRO）、IP 制限（PRO）、SSO（PRO）
export default async function SecuritySettingsPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const canManage = hasPermission(auth.roles, "company.manage");
  const h = await headers();
  const [settings, overview] = canManage
    ? await Promise.all([getSecuritySettings(auth), getSecurityOverview(auth, clientIpFromHeaders((n) => h.get(n) ?? undefined))])
    : [null, null];
  return (
    <div className="space-y-6">
      <div>
        <Link href="/company" className="text-sm text-orange-800 hover:underline">← 会社マイページ</Link>
        <h1 className="mb-2 mt-2 text-2xl font-bold">セキュリティ</h1>
        <p className="text-sm text-stone-500">ログインの2要素認証（認証アプリ）。企業全体への必須化・IP アドレス制限・SSO は PRO 版で設定できます。</p>
      </div>
      <MfaSetup required={auth.mfaRequired} />
      {settings && overview && (
        <>
          <MfaRequirementToggle initial={settings.mfaRequired} members={settings.members} canManage={canManage} pro={hasFeature(auth, "mfa_required")} />
          <IpRestrictionPanel initial={overview.ipRestriction} canManage={canManage} pro={hasFeature(auth, "ip_restriction")} />
          <SsoSettingsPanel initial={overview.sso} canManage={canManage} pro={hasFeature(auth, "sso")} />
        </>
      )}
    </div>
  );
}
