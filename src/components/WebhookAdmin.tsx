"use client";

// Slack／Teams Webhook の管理（PRO版仕様書 §4.9）。5件/社。URL は末尾のみ表示
import { useEffect, useState } from "react";

type Hook = {
  id: string;
  name: string;
  urlHint: string;
  provider: "SLACK" | "TEAMS" | "GENERIC";
  events: string[];
  status: "ACTIVE" | "SUSPENDED";
  failCount: number;
  lastDeliveredAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};
const EVENT_LABELS: Record<string, string> = {
  "alert.new": "新着アラート",
  "entry.received": "商談申込みの受信",
  "entry.approved": "双方承認（商談開始）",
  "interview.scheduled": "面談の設定",
  "message.received": "メッセージの受信",
  "contract.sign_requested": "契約の署名依頼",
};
const EMPTY = { name: "", url: "", provider: "SLACK" as Hook["provider"], events: Object.keys(EVENT_LABELS) };

export function WebhookAdmin() {
  const [items, setItems] = useState<Hook[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/v1/webhooks");
    if (res.ok) setItems(((await res.json()) as { items: Hook[] }).items);
  }
  useEffect(() => {
    void load();
  }, []);

  async function call(path: string, method: string, body?: object) {
    setError(null);
    setInfo(null);
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const b = await res.json().catch(() => null);
    if (!res.ok) setError(b?.error?.message ?? "操作に失敗しました");
    return { ok: res.ok, body: b };
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call("/api/v1/webhooks", "POST", form);
    setBusy(false);
    if (r.ok) {
      setForm(EMPTY);
      await load();
    }
  }
  async function test(id: string) {
    const r = await call(`/api/v1/webhooks/${id}/test`, "POST");
    if (r.ok) setInfo(r.body.ok ? "テスト送信に成功しました" : `テスト送信に失敗しました（${r.body.attempts}回）`);
    await load();
  }
  async function resume(id: string) {
    if ((await call(`/api/v1/webhooks/${id}`, "PUT", { resume: true })).ok) await load();
  }
  async function remove(id: string) {
    if (!window.confirm("この通知先を削除しますか？")) return;
    if ((await call(`/api/v1/webhooks/${id}`, "DELETE")).ok) await load();
  }
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-bold">通知先一覧（{items.length}/5）</h2>
        <p className="mb-3 text-xs text-slate-500">通知には件名・匿名情報・コンソールへのリンクのみ含まれ、人材の氏名・実額単価・メッセージ本文は送られません。連続10回失敗すると停止します。</p>
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        {info && <p className="mb-2 text-xs text-emerald-700">{info}</p>}
        {items.length === 0 ? (
          <p className="text-sm text-slate-400">通知先はまだありません</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {items.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium">{h.name}</span>
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{h.provider}</span>
                  <span className="ml-2 text-xs text-slate-500">{h.urlHint}</span>
                  {h.status === "SUSPENDED" && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">停止中</span>}
                  <p className="text-xs text-slate-500">
                    {h.events.map((e) => EVENT_LABELS[e] ?? e).join("・")}
                    {h.lastDeliveredAt && ` ／ 最終送信 ${new Date(h.lastDeliveredAt).toLocaleString("ja-JP")}`}
                    {h.lastError && ` ／ 直近の失敗: ${h.lastError}（${h.failCount}回連続）`}
                  </p>
                </div>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => test(h.id)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">テスト送信</button>
                  {h.status === "SUSPENDED" && (
                    <button type="button" onClick={() => resume(h.id)} className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50">再開</button>
                  )}
                  <button type="button" onClick={() => remove(h.id)} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">削除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form onSubmit={create} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm">
        <h2 className="mb-3 font-bold">通知先を追加</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs">
            <span className="mb-1 block text-slate-600">名前</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={50} className="w-full rounded border border-slate-300 bg-white px-2 py-1" />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-slate-600">種別</span>
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as Hook["provider"] })} className="w-full rounded border border-slate-300 bg-white px-2 py-1">
              <option value="SLACK">Slack（Incoming Webhook）</option>
              <option value="TEAMS">Microsoft Teams（Incoming Webhook）</option>
              <option value="GENERIC">汎用（JSON POST）</option>
            </select>
          </label>
          <label className="block text-xs sm:col-span-3">
            <span className="mb-1 block text-slate-600">Webhook URL（https）</span>
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required type="url" placeholder="https://hooks.slack.com/services/..." className="w-full rounded border border-slate-300 bg-white px-2 py-1" />
          </label>
        </div>
        <fieldset className="mt-3">
          <legend className="text-xs text-slate-600">通知するイベント</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            {Object.entries(EVENT_LABELS).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.events.includes(k)}
                  onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, k] : form.events.filter((x) => x !== k) })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={busy || form.events.length === 0} className="mt-3 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          追加
        </button>
      </form>
    </div>
  );
}
