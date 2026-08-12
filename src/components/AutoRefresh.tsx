"use client";

// 処理中の取込などがある間、一定間隔で画面を再取得して進捗を反映する
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
