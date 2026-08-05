"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

export type ContractEditInitial = {
  contractType: string;
  monthlyRateYen: number;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  commandChecklist: Record<string, string>;
  notes: string;
  anySigned: boolean; // 片側署名済みか（修正時に署名が取り消される旨の警告に使用）
};

// 署名完了前の契約修正（§22）。修正すると既存の署名は取り消され、双方の再署名が必要になる
export function ContractEditForm({
  contractId,
  initial,
}: {
  contractId: string;
  initial: ContractEditInitial;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const message = initial.anySigned
      ? "修正内容を保存しますか？既存の署名は取り消され、双方の再署名が必要になります。"
      : "修正内容を保存しますか？";
    if (!window.confirm(message)) return;
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/v1/contracts/${contractId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      setOpen(false);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "契約の修正に失敗しました");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        契約内容を修正
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h2 className="mb-1 font-bold text-amber-900">契約内容の修正（署名完了前のみ）</h2>
      <p className="mb-4 text-xs text-amber-800">
        {initial.anySigned
          ? "既に片側の署名があります。修正を保存すると署名は取り消され、双方の再署名が必要になります。"
          : "修正を保存した後、双方の署名により成約となります。"}
      </p>
      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約形態</label>
          <select name="contractType" className={input} defaultValue={initial.contractType}>
            <option value="準委任">準委任</option>
            <option value="請負">請負</option>
            <option value="労働者派遣">労働者派遣</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">月額契約金額（円・税抜）</label>
          <input type="number" name="monthlyRateYen" required min={1} defaultValue={initial.monthlyRateYen} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約開始日</label>
          <input type="date" name="startDate" required defaultValue={initial.startDate} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">業務指示責任者・経路</label>
          <input name="instructionManager" required defaultValue={initial.commandChecklist.instructionManager ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">勤怠・休暇管理主体</label>
          <input name="attendanceManager" required defaultValue={initial.commandChecklist.attendanceManager ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">配置決定主体</label>
          <input name="assignmentDecider" required defaultValue={initial.commandChecklist.assignmentDecider ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">成果・役務の検収方法</label>
          <input name="acceptanceMethod" required defaultValue={initial.commandChecklist.acceptanceMethod ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">再委託承認</label>
          <input name="resubcontractApproval" required defaultValue={initial.commandChecklist.resubcontractApproval ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約終了日（任意）</label>
          <input type="date" name="endDate" defaultValue={initial.endDate ?? ""} className={input} />
        </div>
        <div className="col-span-3">
          <label className="mb-1 block text-xs text-slate-600">備考（任意）</label>
          <textarea name="notes" rows={3} maxLength={2000} defaultValue={initial.notes} className={input} />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {loading ? "保存中..." : "修正を保存"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
