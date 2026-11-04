// RSC / Server Actions からセッションを解決するヘルパー
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE, type AuthContext } from "@/server/auth/session";
import { clientIpFromHeaders, isIpAllowed } from "@/server/auth/ip";

export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  const auth = await resolveSession(store.get(SESSION_COOKIE)?.value);
  if (!auth) return null;
  // IP 制限（PRO版仕様書 §4.12）: 既存セッションも許可外からは画面を開けない（ログイン画面へ）
  if (auth.ipAllowList.length > 0) {
    const h = await headers();
    if (!isIpAllowed(clientIpFromHeaders((n) => h.get(n) ?? undefined), auth.ipAllowList)) redirect("/login?error=ip");
  }
  return auth;
}
