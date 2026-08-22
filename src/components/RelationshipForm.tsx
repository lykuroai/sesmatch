"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RELATIONSHIP_TYPE_LABELS } from "@/lib/constants";

export type RelationshipItem = {
  id: string;
  partnerName: string;
  type: string;
  contractConfirmed: boolean;
  note: string | null;
  createdAt: string;
};

// 企業間関係の一覧（修正・削除つき）。canManage=false のときは閲覧のみ
export function RelationshipTable({ items, canManage }: { items: RelationshipItem[]; canManage: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveEdit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/v1/relationships/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnerName: f.get("partnerName"),
        type: f.get("type"),
        contractConfirmed: f.get("contractConfirmed") === "on",
        note: f.get("note") || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setEditingId(null);
      router.refresh();
    } else {
      setError("修正に失敗しました");
    }
  }

  async function remove(item: RelationshipItem) {
    if (!window.confirm(`「${item.partnerName}」の関係を削除しますか？\n一社下の提案条件や取引先の企業名表示にも即時反映されます。`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/relationships/${item.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError("削除に失敗しました");
  }

  const input = "rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      {error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-3">相手企業</th>
            <th className="px-4 py-3">種別</th>
            <th className="px-4 py-3">直接契約確認</th>
            <th className="px-4 py-3">備考</th>
            <th className="px-4 py-3">登録日</th>
            {canManage && <th className="px-4 py-3">操作</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((r) =>
            editingId === r.id ? (
              // key を表示行と変えて行ごと再マウントする。同一 key だと React が「修正」ボタンの
              // DOM 要素を「保存(type=submit)」に書き換え、クリックのデフォルト動作で即時送信されてしまう
              <tr key={`${r.id}-edit`} className="border-t border-slate-100 bg-blue-50/40">
                {/* 行内修正フォーム（form 属性で行外のフォームに紐付け） */}
                <td className="px-4 py-2">
                  <form id={`rel-edit-${r.id}`} onSubmit={(e) => saveEdit(r.id, e)} />
                  <input name="partnerName" form={`rel-edit-${r.id}`} defaultValue={r.partnerName} required className={input} />
                </td>
                <td className="px-4 py-2">
                  <select name="type" form={`rel-edit-${r.id}`} defaultValue={r.type} className={input}>
                    {Object.entries(RELATIONSHIP_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" name="contractConfirmed" form={`rel-edit-${r.id}`} defaultChecked={r.contractConfirmed} />
                    確認済み
                  </label>
                </td>
                <td className="px-4 py-2">
                  <input name="note" form={`rel-edit-${r.id}`} defaultValue={r.note ?? ""} className={`${input} w-full`} />
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {new Date(r.createdAt).toLocaleDateString("ja-JP")}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <button
                    type="submit"
                    form={`rel-edit-${r.id}`}
                    disabled={busy}
                    className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="ml-2 rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    キャンセル
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{r.partnerName}</td>
                <td className="px-4 py-3">{RELATIONSHIP_TYPE_LABELS[r.type]}</td>
                <td className="px-4 py-3">
                  {r.contractConfirmed ? "✓ 確認済み" : <span className="text-amber-600">未確認</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.note ?? "-"}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(r.createdAt).toLocaleDateString("ja-JP")}
                </td>
                {canManage && (
                  <td className="whitespace-nowrap px-4 py-3">
                    <button
                      type="button"
                      onClick={() => { setError(null); setEditingId(r.id); }}
                      className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      修正
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={busy}
                      className="ml-2 rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      削除
                    </button>
                  </td>
                )}
              </tr>
            )
          )}
          {items.length === 0 && (
            <tr>
              <td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-slate-400">
                登録された企業間関係はありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function RelationshipForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = await fetch("/api/v1/relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnerName: f.get("partnerName"),
        type: f.get("type"),
        contractConfirmed: f.get("contractConfirmed") === "on",
        note: f.get("note") || undefined,
      }),
    });
    if (res.ok) {
      form.reset();
      router.refresh();
    } else {
      setError("登録に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div>
        <label className="mb-1 block text-xs text-slate-500">相手企業名</label>
        <input name="partnerName" required className="rounded border border-slate-300 px-2 py-1.5" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">種別</label>
        <select name="type" className="rounded border border-slate-300 px-2 py-1.5">
          {Object.entries(RELATIONSHIP_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-1.5 pb-1.5">
        <input type="checkbox" name="contractConfirmed" />
        直接契約を確認済み
      </label>
      <div className="flex-1">
        <label className="mb-1 block text-xs text-slate-500">備考</label>
        <input name="note" className="w-full rounded border border-slate-300 px-2 py-1.5" />
      </div>
      <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700">
        登録
      </button>
    </form>
  );
}
