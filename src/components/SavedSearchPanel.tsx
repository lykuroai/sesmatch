"use client";

// 保存した検索条件（PRO版仕様書 §4.3）。案件・人材の検索フォーム直下に表示する。
// 現在の条件を名前を付けて保存し、通知方法（都度／1日1回／停止）の変更・削除・条件の呼び出しができる。
// 判定（PRO か・10件/社）はサーバー側 API が行う
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Saved = {
  id: string;
  kind: "PROJECT" | "ENGINEER";
  name: string;
  query: string;
  description: string;
  notify: "IMMEDIATE" | "DAILY" | "OFF";
  own: boolean;
  lastNotifiedAt: string | null;
};

const NOTIFY_LABELS: Record<Saved["notify"], string> = {
  IMMEDIATE: "新着を都度通知",
  DAILY: "1日1回まとめて通知",
  OFF: "通知しない",
};

export function SavedSearchPanel({
  kind,
  basePath,
  currentCriteria,
  currentQuery,
}: {
  kind: "PROJECT" | "ENGINEER";
  basePath: string; // /projects | /engineers
  currentCriteria: Record<string, unknown>; // 現在の検索条件（保存用）
  currentQuery: string; // 現在の条件の URL クエリ（空なら条件なし）
}) {
  const router = useRouter();
  const [items, setItems] = useState<Saved[] | null>(null);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/saved-searches?kind=${kind}`);
    if (res.ok) setItems(((await res.json()) as { items: Saved[] }).items);
    else setItems([]);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/saved-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, name, criteria: currentCriteria, notify: "IMMEDIATE" }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      await load();
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "保存に失敗しました");
    }
  }

  async function setNotify(id: string, notify: Saved["notify"]) {
    setError(null);
    const res = await fetch(`/api/v1/saved-searches/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notify }),
    });
    if (res.ok) await load();
    else setError("通知方法の変更に失敗しました");
  }

  async function remove(id: string) {
    if (!window.confirm("この保存した検索条件を削除しますか？")) return;
    setError(null);
    const res = await fetch(`/api/v1/saved-searches/${id}`, { method: "DELETE" });
    if (res.ok) await load();
    else setError("削除に失敗しました");
  }

  const count = items?.length ?? 0;
  return (
    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 font-medium text-slate-800">
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
          保存した検索条件と新着アラート
          <span className="text-xs text-slate-500">（{count}件）</span>
          <span className="text-xs text-slate-400">{open ? "▲ 閉じる" : "▼ 開く"}</span>
        </button>
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={currentQuery ? "この条件の名前（例: 東京 Java 80万以下）" : "条件なし（すべての新着）の名前"}
            maxLength={100}
            className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            現在の条件を保存
          </button>
        </form>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {open && (
        <div className="mt-3">
          {items === null ? (
            <p className="text-xs text-slate-500">読み込み中...</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-slate-500">
              保存した検索条件はまだありません。検索条件を指定して「現在の条件を保存」を押すと、条件に合う他社の新着
              {kind === "PROJECT" ? "案件" : "人材"}をメールでお知らせします（15分間隔で確認。10件/社まで）。
            </p>
          ) : (
            <ul className="divide-y divide-emerald-100">
              {items.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={s.query ? `${basePath}?${s.query}` : basePath} className="font-medium text-blue-700 hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {s.description}
                      {s.lastNotifiedAt && ` / 最終通知 ${new Date(s.lastNotifiedAt).toLocaleString("ja-JP")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <select
                      value={s.notify}
                      onChange={(e) => setNotify(s.id, e.target.value as Saved["notify"])}
                      className="rounded border border-slate-300 bg-white px-2 py-1"
                    >
                      {(Object.keys(NOTIFY_LABELS) as Saved["notify"][]).map((k) => (
                        <option key={k} value={k}>
                          {NOTIFY_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => remove(s.id)} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">
            通知の宛先は条件を保存した担当者のメールアドレスです。通知には掲載企業名と匿名情報のみ含まれ、人材の氏名・実額単価は含まれません。
          </p>
        </div>
      )}
    </div>
  );
}
