// RSC / Server Actions からセッションを解決するヘルパー
import { cookies } from "next/headers";
import { resolveSession, SESSION_COOKIE, type AuthContext } from "@/server/auth/session";

export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}
