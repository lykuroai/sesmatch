"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/v1/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
      className="text-xs text-slate-500 underline hover:text-slate-700"
    >
      ログアウト
    </button>
  );
}
