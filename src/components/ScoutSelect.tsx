"use client";

// 一斉スカウトの人材選択（PRO版仕様書 §4.6）。人材一覧（サーバー描画）の各行に置くチェックボックスと、
// 選択状態を集約して送信する BulkScoutPanel。行と panel はサーバーコンポーネントの中で別々に描画されるため、
// document のカスタムイベントで選択状態を同期する
import { useEffect, useState } from "react";
import Link from "next/link";

const EVENT = "sesmatch:scout-select";
type SelectDetail = { id: string; code: string; selected: boolean };

export function ScoutCheckbox({ id, code }: { id: string; code: string }) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const onClear = () => setChecked(false);
    document.addEventListener("sesmatch:scout-clear", onClear);
    return () => document.removeEventListener("sesmatch:scout-clear", onClear);
  }, []);
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={`${code} を一斉スカウトの対象に選択`}
      title="一斉スカウトの対象に選択（PRO）"
      onChange={(e) => {
        setChecked(e.target.checked);
        document.dispatchEvent(new CustomEvent<SelectDetail>(EVENT, { detail: { id, code, selected: e.target.checked } }));
      }}
      className="h-4 w-4 accent-emerald-600"
    />
  );
}

const DEFAULT_TEMPLATE = `はじめまして。貴社の人材のご経歴を拝見し、弊社案件「{案件名}」をご紹介したくご連絡しました。
勤務地: {勤務地} / {在宅} / 開始時期: {開始時期} / 単価上限: {単価上限}

ご興味をお持ちいただけましたら、本商談をご承認のうえ詳細をご相談できれば幸いです。`;

export function BulkScoutPanel({ projects }: { projects: { id: string; label: string }[] }) {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [projectId, setProjectId] = useState("");
  const [body, setBody] = useState(DEFAULT_TEMPLATE);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<{
    batchId: string;
    created: { entryId: string; engineerCode: string }[];
    skipped: { engineerCode: string; reason: string }[];
  } | null>(null);

  useEffect(() => {
    const onSelect = (ev: Event) => {
      const d = (ev as CustomEvent<SelectDetail>).detail;
      setSelected((prev) => {
        const next = new Map(prev);
        if (d.selected) next.set(d.id, d.code);
        else next.delete(d.id);
        return next;
      });
    };
    document.addEventListener(EVENT, onSelect);
    return () => document.removeEventListener(EVENT, onSelect);
  }, []);

  const ids = [...selected.keys()];
  const codes = [...selected.values()];

  async function draft() {
    if (!projectId) return setError("自社案件を選択してください");
    setBusy("draft");
    setError(null);
    setWarnings([]);
    const res = await fetch("/api/v1/scouts/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, engineerIds: ids }),
    });
    setBusy(null);
    const b = await res.json().catch(() => null);
    if (res.ok) {
      setBody(b.body);
      setWarnings(b.warnings ?? []);
    } else setError(b?.error?.message ?? "下書きの生成に失敗しました");
  }

  async function send() {
    setBusy("send");
    setError(null);
    const res = await fetch("/api/v1/scouts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, engineerIds: ids, body }),
    });
    setBusy(null);
    const b = await res.json().catch(() => null);
    if (res.ok) {
      setResult(b);
      setConfirming(false);
      setSelected(new Map());
      document.dispatchEvent(new Event("sesmatch:scout-clear"));
    } else setError(b?.error?.message ?? "送信に失敗しました");
  }

  if (result) {
    return (
      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm">
        <p className="font-medium text-slate-800">
          一斉スカウトを送信しました: {result.created.length}件作成、{result.skipped.length}件スキップ
        </p>
        {result.skipped.length > 0 && (
          <ul className="mt-1 text-xs text-slate-600">
            {result.skipped.map((s) => (
              <li key={s.engineerCode}>・{s.engineerCode}: {s.reason}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs">
          <Link href={`/entries/scouts/${result.batchId}`} className="text-blue-700 hover:underline">反応状況を見る</Link>
          <button type="button" onClick={() => setResult(null)} className="ml-3 text-slate-500 hover:underline">閉じる</button>
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium text-slate-800">
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
          一斉スカウト
          <span className="text-xs text-slate-500">
            {ids.length === 0 ? "一覧のチェックで他社人材を選択（最大20名/回、50件/日）" : `${ids.length}名を選択中: ${codes.join("、")}`}
          </span>
        </p>
        <Link href="/entries/scouts" className="text-xs text-blue-700 hover:underline">送信履歴と反応率</Link>
      </div>
      {ids.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-600">自社案件</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
              <option value="">選択してください</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <button type="button" onClick={draft} disabled={busy != null || !projectId} className="rounded border border-emerald-600 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              {busy === "draft" ? "生成中..." : "AI で下書き"}
            </button>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
          />
          <p className="text-xs text-slate-500">
            変数 {"{案件名} {勤務地} {在宅} {開始時期} {単価上限}"} は送信時に案件の内容へ置き換わります。連絡先（メール・電話・URL）は書けません。送信前に内容をご確認ください。
          </p>
          {warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700">{w}</p>
          ))}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {!confirming ? (
            <button type="button" onClick={() => { setError(null); if (!projectId) return setError("自社案件を選択してください"); setConfirming(true); }} className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
              送信内容を確認する
            </button>
          ) : (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-slate-700">
              <p className="font-medium">以下の {ids.length} 名へ、選択した案件のスカウトを送信します。本文を確認しましたか？</p>
              <p className="mt-1">{codes.join("、")}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={send} disabled={busy != null} className="rounded bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busy === "send" ? "送信中..." : "確認済み・送信する"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded border border-slate-300 px-4 py-1.5 hover:bg-white">戻る</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
