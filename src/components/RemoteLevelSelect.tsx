"use client";

// 在宅区分（案件）/ 許容出社条件（人材）の選択。導出される週出社日数を表示のみで連動させる
// （日数は入力させず、区分から自動導出して保存する）
import { useState } from "react";
import { REMOTE_LEVEL_LABELS, remoteLevelToOnsiteDays } from "@/lib/constants";

export function RemoteLevelSelect({
  name,
  initial,
  daysLabel,
  showCode = false,
  className,
}: {
  name: string;
  initial: string;
  daysLabel: string; // 例: 週出社日数 / 週最大出社日数
  showCode?: boolean; // true なら「R2: 週2〜3出社」形式で表示
  className?: string;
}) {
  const [level, setLevel] = useState(initial);
  return (
    <>
      <select name={name} className={className} value={level} onChange={(e) => setLevel(e.target.value)}>
        {Object.entries(REMOTE_LEVEL_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {showCode ? `${k}: ${v}` : v}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500">
        {daysLabel}: 週{remoteLevelToOnsiteDays(level)}日（自動設定）
      </p>
    </>
  );
}
