"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 案件の進行状態・人材の稼働状態の手動設定セレクタ
export function WorkflowStatusSelect({
  path,
  current,
  options,
}: {
  path: string; // 例: /api/v1/projects/xxx/workflow-status
  current: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function change(status: string) {
    if (status === current) return;
    setSaving(true);
    setError(false);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSaving(false);
    if (res.ok) router.refresh();
    else setError(true);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={current}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        title="選択すると状態を変更できます"
        className="rounded border border-blue-300 bg-white px-2 py-1 text-sm font-medium text-slate-800 hover:border-blue-500 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">変更失敗</span>}
    </span>
  );
}
