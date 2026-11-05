"use client";

// スキルシート書式（自社テンプレート）の管理（PRO版仕様書 §4.7）。3件/社まで
import { useEffect, useState } from "react";

type Template = {
  id: string;
  name: string;
  title: string;
  showCompanyName: boolean;
  footerNote: string;
  sections: Record<SectionKey, boolean>;
  builtin: boolean;
};
type SectionKey = "summary" | "skills" | "processes" | "roles" | "industries" | "conditions";
const SECTION_LABELS: Record<SectionKey, string> = {
  conditions: "条件（単価・エリア・稼働可能日・在宅）",
  summary: "概要",
  skills: "スキル一覧",
  processes: "経験工程",
  roles: "役割",
  industries: "業種経験",
};
const EMPTY = { name: "", title: "技術者経歴書", showCompanyName: true, footerNote: "", sections: { summary: true, skills: true, processes: true, roles: true, industries: true, conditions: true } };

export function SkillSheetTemplateAdmin() {
  const [items, setItems] = useState<Template[]>([]);
  const [form, setForm] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/v1/skill-sheet-templates");
    if (res.ok) setItems(((await res.json()) as { items: Template[] }).items);
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { id, ...body } = form;
    const res = await fetch(id ? `/api/v1/skill-sheet-templates/${id}` : "/api/v1/skill-sheet-templates", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setForm(EMPTY);
      await load();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "保存に失敗しました");
    }
  }
  async function remove(id: string) {
    if (!window.confirm("このテンプレートを削除しますか？")) return;
    const res = await fetch(`/api/v1/skill-sheet-templates/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }
  const custom = items.filter((t) => !t.builtin);
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-bold">テンプレート一覧</h2>
        <p className="mb-3 text-xs text-stone-500">既定の「標準」「簡易」に加え、自社テンプレートを3件まで登録できます。出力は人材詳細の「スキルシート出力」から。</p>
        <ul className="divide-y divide-stone-100 text-sm">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium">{t.name}</span>
                {t.builtin && <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">既定</span>}
                <p className="text-xs text-stone-500">
                  見出し「{t.title}」／ 自社名 {t.showCompanyName ? "表示" : "非表示"} ／ 項目:{" "}
                  {(Object.keys(SECTION_LABELS) as SectionKey[]).filter((k) => t.sections[k]).map((k) => SECTION_LABELS[k].split("（")[0]).join("・")}
                </p>
              </div>
              {!t.builtin && (
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setForm({ id: t.id, name: t.name, title: t.title, showCompanyName: t.showCompanyName, footerNote: t.footerNote, sections: t.sections })} className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50">編集</button>
                  <button type="button" onClick={() => remove(t.id)} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">削除</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <form onSubmit={save} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm">
        <h2 className="mb-3 font-bold">{form.id ? "テンプレートを編集" : `自社テンプレートを追加（${custom.length}/3）`}</h2>
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 block text-stone-600">テンプレート名</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={50} className="w-full rounded border border-stone-300 bg-white px-2 py-1" />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-stone-600">書式の見出し</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={50} className="w-full rounded border border-stone-300 bg-white px-2 py-1" />
          </label>
          <label className="block text-xs sm:col-span-2">
            <span className="mb-1 block text-stone-600">末尾の注記（任意）</span>
            <textarea value={form.footerNote} onChange={(e) => setForm({ ...form, footerNote: e.target.value })} maxLength={500} rows={2} className="w-full rounded border border-stone-300 bg-white px-2 py-1" />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.showCompanyName} onChange={(e) => setForm({ ...form, showCompanyName: e.target.checked })} /> 自社名をヘッダーに表示
          </label>
        </div>
        <fieldset className="mt-3">
          <legend className="text-xs text-stone-600">表示する項目</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            {(Object.keys(SECTION_LABELS) as SectionKey[]).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={form.sections[k]} onChange={(e) => setForm({ ...form, sections: { ...form.sections, [k]: e.target.checked } })} />
                {SECTION_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={busy} className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {form.id ? "更新" : "追加"}
          </button>
          {form.id && (
            <button type="button" onClick={() => setForm(EMPTY)} className="rounded border border-stone-300 px-4 py-1.5 text-xs hover:bg-white">取消</button>
          )}
        </div>
      </form>
    </div>
  );
}
