"use client";

// お問合せフォーム（企業→運営）
import { useState } from "react";
import { useRouter } from "next/navigation";

export const INQUIRY_CATEGORIES = [
  "操作方法",
  "不具合・エラー",
  "取込・AI解析",
  "商談・契約",
  "手数料・請求",
  "アカウント・担当者",
  "その他",
];

export function InquiryForm() {
  const router = useRouter();
  const [category, setCategory] = useState(INQUIRY_CATEGORIES[0]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    const res = await fetch("/api/v1/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, body }),
    });
    setLoading(false);
    if (res.ok) {
      setBody("");
      setInfo("お問合せを受け付けました。運営からの回答はメールまたはお電話でご連絡します");
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "送信に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {info && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{info}</p>}
      <div>
        <label className="mb-1 block text-xs text-slate-600">分類</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {INQUIRY_CATEGORIES.map((cg) => (
            <option key={cg} value={cg}>
              {cg}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-600">お問合せ内容</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={5000}
          required
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder={"お困りの内容をできるだけ具体的にご記入ください。\n（発生した画面、操作の手順、表示されたエラーメッセージなど）"}
        />
      </div>
      <button
        type="submit"
        disabled={loading || !body.trim()}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "送信中..." : "送信する"}
      </button>
    </form>
  );
}
