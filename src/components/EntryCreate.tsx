"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// エントリー作成（§20.1）
// PROPOSAL: 他社案件詳細から自社人材を提案 / SCOUT: 他社人材詳細から自社案件へスカウト
export function EntryCreate({
  type,
  fixedProjectId,
  fixedEngineerId,
  options,
  showSubtierCheck,
}: {
  type: "PROPOSAL" | "SCOUT";
  fixedProjectId?: string;
  fixedEngineerId?: string;
  options: { id: string; label: string; subtier?: boolean }[];
  showSubtierCheck?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState("");
  const [subtierApproved, setSubtierApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedOption = options.find((o) => o.id === selected);
  const needsSubtier = showSubtierCheck && selectedOption?.subtier;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        projectId: fixedProjectId ?? (type === "SCOUT" ? selected : undefined) ?? selected,
        engineerId: fixedEngineerId ?? (type === "PROPOSAL" ? selected : undefined) ?? selected,
        note: note || undefined,
        subtierApproved,
      }),
    });
    setLoading(false);
    if (res.ok) {
      const created = await res.json();
      router.push(`/entries/${created.id}`);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? b?.error?.code ?? "エントリーに失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
      <h2 className="mb-3 font-bold text-blue-900">
        {type === "PROPOSAL" ? "この案件へ自社人材を提案" : "この人材に自社案件を提案する"}
      </h2>
      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div>
          <label className="mb-1 block text-xs text-slate-600">
            {type === "PROPOSAL" ? "提案する人材（公開・同意済みのみ）" : "自社案件"}
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            required
            className="min-w-64 rounded border border-slate-300 bg-white px-2 py-1.5"
          >
            <option value="">選択してください</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-slate-600">申し送り（任意）</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5"
            placeholder="連絡先は記載しないでください"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !selected}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "送信中..." : type === "PROPOSAL" ? "提案する" : "商談を申し込む"}
        </button>
      </div>
      {needsSubtier && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={subtierApproved}
            onChange={(e) => setSubtierApproved(e.target.checked)}
          />
          一社下企業から本案件への提案承認を得ています（案件単位の承認 §12.4）
        </label>
      )}
    </form>
  );
}
