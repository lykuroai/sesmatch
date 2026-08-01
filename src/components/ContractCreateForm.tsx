"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

// 個別契約の作成（§22）。指揮命令・検収の確認事項は必須。
export function ContractCreateForm({
  entryId,
  defaultRateYen,
}: {
  entryId: string;
  defaultRateYen?: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/v1/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryId,
        contractType: f.get("contractType"),
        monthlyRateYen: parseInt(String(f.get("monthlyRateYen"))),
        startDate: f.get("startDate"),
        endDate: f.get("endDate") || undefined,
        commandChecklist: {
          instructionManager: f.get("instructionManager"),
          attendanceManager: f.get("attendanceManager"),
          assignmentDecider: f.get("assignmentDecider"),
          acceptanceMethod: f.get("acceptanceMethod"),
          resubcontractApproval: f.get("resubcontractApproval"),
        },
        notes: String(f.get("notes") ?? "").trim() || undefined,
      }),
    });
    setLoading(false);
    if (res.ok) {
      const created = await res.json();
      router.push(`/contracts/${created.id}`);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "契約の作成に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
      <h2 className="mb-1 font-bold text-indigo-900">個別契約を作成（§22）</h2>
      <p className="mb-4 text-xs text-indigo-700">
        準委任・請負では案件保有企業から本人への直接指揮命令を禁止します。以下の確認事項は必須です。
      </p>
      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約形態</label>
          <select name="contractType" className={input}>
            <option value="準委任">準委任</option>
            <option value="請負">請負</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">月額契約金額（円・税抜）</label>
          <input type="number" name="monthlyRateYen" required min={1} defaultValue={defaultRateYen} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約開始日</label>
          <input type="date" name="startDate" required className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">業務指示責任者・経路</label>
          <input name="instructionManager" required className={input} placeholder="供給側PMを通じて指示" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">勤怠・休暇管理主体</label>
          <input name="attendanceManager" required className={input} placeholder="供給側企業" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">配置決定主体</label>
          <input name="assignmentDecider" required className={input} placeholder="供給側企業" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">成果・役務の検収方法</label>
          <input name="acceptanceMethod" required className={input} placeholder="月次作業報告書の確認" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">再委託承認</label>
          <input name="resubcontractApproval" required className={input} placeholder="再委託なし" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約終了日（任意）</label>
          <input type="date" name="endDate" className={input} />
        </div>
        <div className="col-span-3">
          <label className="mb-1 block text-xs text-slate-600">備考（任意）</label>
          <textarea
            name="notes"
            rows={3}
            maxLength={2000}
            className={input}
            placeholder="精算幅（140h〜180h）、残業単価、支払サイト、その他特記事項など"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="mt-4 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? "作成中..." : "契約を作成（エントリーは契約手続中へ）"}
      </button>
    </form>
  );
}
