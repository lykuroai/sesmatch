"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

// 編集対象として取得する最新の契約内容（GET /api/v1/contracts/:id の応答から使用する項目）
type LatestContract = {
  status: string;
  contractType: string;
  monthlyRateYen: number;
  startDate: string;
  endDate: string | null;
  commandChecklist: Record<string, string>;
  notes: string;
  version: number;
  supplySigned: boolean;
  demandSigned: boolean;
};

const EDITABLE_STATUSES = ["DRAFT", "SIGNED_SUPPLY", "SIGNED_DEMAND"];

// 署名完了前の契約修正（§22）。
// 別々の担当者が同じ契約を扱うため、修正ボタン押下時にサーバーから最新の内容と版数を取得してから
// 編集を開始し、保存はその版数に対してのみ有効（他の担当者の修正を知らないままの上書き防止）
export function ContractEditForm({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [latest, setLatest] = useState<LatestContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [loading, setLoading] = useState(false);

  // 修正ボタン押下時: まず最新の契約内容・版数を取得し、その内容で編集フォームを開く
  async function openForm() {
    setFetching(true);
    setError(null);
    const res = await fetch(`/api/v1/contracts/${contractId}`);
    setFetching(false);
    if (!res.ok) {
      setError("最新の契約内容を取得できませんでした。再読み込みしてください");
      return;
    }
    const c = (await res.json()) as LatestContract;
    if (!EDITABLE_STATUSES.includes(c.status)) {
      setError("契約は既に署名が完了しているため修正できません");
      router.refresh();
      return;
    }
    setLatest(c);
    router.refresh(); // 画面上の契約表示も最新に揃える
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!latest) return;
    const anySigned = latest.supplySigned || latest.demandSigned;
    const message = anySigned
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
        version: latest.version, // 編集開始時に取得した版数に対してのみ保存できる
      }),
    });
    setLoading(false);
    if (res.ok) {
      setLatest(null);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "契約の修正に失敗しました");
    }
  }

  if (!latest) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          onClick={openForm}
          disabled={fetching}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {fetching ? "最新の内容を取得中..." : "契約内容を修正"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </span>
    );
  }

  const anySigned = latest.supplySigned || latest.demandSigned;
  return (
    // key=version: 版数が変わったら（最新を読み込み直したら）フォームの初期値を作り直す
    <form key={latest.version} onSubmit={submit} className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h2 className="mb-1 font-bold text-amber-900">契約内容の修正（第{latest.version}版を編集中）</h2>
      <p className="mb-4 text-xs text-amber-800">
        {anySigned
          ? "既に片側の署名があります。修正を保存すると署名は取り消され、双方の再署名が必要になります。"
          : "修正を保存した後、双方の署名により成約となります。"}
        保存時に他の担当者の修正と競合した場合は保存されません（最新の内容を読み込み直してください）。
      </p>
      {error && (
        <p className="mb-3 flex items-center gap-3 rounded bg-red-50 p-2 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={openForm}
            className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          >
            最新の内容を読み込み直す
          </button>
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約形態</label>
          <select name="contractType" className={input} defaultValue={latest.contractType}>
            <option value="準委任">準委任</option>
            <option value="請負">請負</option>
            <option value="労働者派遣">労働者派遣</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">月額契約金額（円・税抜）</label>
          <input type="number" name="monthlyRateYen" required min={1} defaultValue={latest.monthlyRateYen} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約開始日</label>
          <input type="date" name="startDate" required defaultValue={latest.startDate.slice(0, 10)} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">業務指示責任者・経路</label>
          <input name="instructionManager" required defaultValue={latest.commandChecklist.instructionManager ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">勤怠・休暇管理主体</label>
          <input name="attendanceManager" required defaultValue={latest.commandChecklist.attendanceManager ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">配置決定主体</label>
          <input name="assignmentDecider" required defaultValue={latest.commandChecklist.assignmentDecider ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">成果・役務の検収方法</label>
          <input name="acceptanceMethod" required defaultValue={latest.commandChecklist.acceptanceMethod ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">再委託承認</label>
          <input name="resubcontractApproval" required defaultValue={latest.commandChecklist.resubcontractApproval ?? ""} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">契約終了日（任意）</label>
          <input type="date" name="endDate" defaultValue={latest.endDate ? latest.endDate.slice(0, 10) : ""} className={input} />
        </div>
        <div className="sm:col-span-3">
          <label className="mb-1 block text-xs text-slate-600">備考（任意）</label>
          <textarea name="notes" rows={3} maxLength={2000} defaultValue={latest.notes} className={input} />
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
          onClick={() => setLatest(null)}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
