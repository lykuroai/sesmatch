"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 本人同意登録（§11.3）
export function ConsentForm({ engineerId }: { engineerId: string }) {
  const router = useRouter();
  const [method, setMethod] = useState("メール");
  const [validUntil, setValidUntil] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(`/api/v1/engineers/${engineerId}/consents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method,
        documentVersion: "v1.0",
        purposes: ["マッチング", "段階開示", "LLM匿名化処理"],
        validUntil: validUntil || undefined,
      }),
    });
    if (res.ok) {
      setMsg("同意を登録しました");
      router.refresh();
    } else {
      setMsg("登録に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-4 text-sm">
      <div>
        <label className="mb-1 block text-xs text-slate-500">同意方法</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        >
          <option>メール</option>
          <option>書面</option>
          <option>Webフォーム</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">有効期限（任意）</label>
        <input
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        />
      </div>
      <button
        type="submit"
        className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
      >
        同意を登録
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </form>
  );
}
