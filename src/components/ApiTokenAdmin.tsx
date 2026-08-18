"use client";

// APIトークン（PAT）の発行・失効UI（local_server_spec_v0_1.md §4.1）。
// 発行された平文トークンはこの画面で一度だけ表示され、以後再表示できない
import { useState } from "react";
import { useRouter } from "next/navigation";

const SCOPE_LABELS: Record<string, string> = {
  ingest: "取込のみ",
  "ingest-register": "取込＋案件・人材の登録",
  connector: "ローカルサーバ連携（取込・公開送信・検索・提案）",
};

export function IssueTokenForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("ingest");
  const [expires, setExpires] = useState("365");
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        scope,
        expiresInDays: expires === "null" ? null : parseInt(expires),
      }),
    });
    setLoading(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error?.message ?? "発行に失敗しました");
      return;
    }
    setIssued(body.token);
    setName("");
    router.refresh();
  }

  if (issued) {
    return (
      <div className="space-y-3">
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          トークンを発行しました。<b>この画面を離れると二度と表示できません。</b>
          今すぐコピーしてローカルサーバ等の設定に保存してください。
        </p>
        <div className="flex items-center gap-2">
          <code className="block flex-1 overflow-x-auto rounded border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs">
            {issued}
          </code>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(issued);
              setCopied(true);
            }}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {copied ? "コピーしました" : "コピー"}
          </button>
        </div>
        <button onClick={() => setIssued(null)} className="text-sm text-blue-600 hover:underline">
          閉じる（保存済みであることを確認してください）
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      {error && <p className="w-full rounded bg-red-50 p-2 text-red-700">{error}</p>}
      <div>
        <label className="mb-1 block text-xs text-slate-500">用途名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 本社ローカルサーバ"
          className="w-64 rounded border border-slate-300 px-2 py-1.5"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">権限スコープ</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        >
          {Object.entries(SCOPE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">有効期限</label>
        <select
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        >
          <option value="90">90日</option>
          <option value="365">1年</option>
          <option value="null">無期限</option>
        </select>
      </div>
      <button
        disabled={loading || !name.trim()}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        発行
      </button>
    </form>
  );
}

export function RevokeTokenButton({ tokenId, tokenName }: { tokenId: string; tokenName: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <button
      disabled={loading}
      onClick={async () => {
        if (!confirm(`「${tokenName}」を失効しますか？このトークンを使う連携は即座に停止します。`)) return;
        setLoading(true);
        await fetch(`/api/v1/api-tokens/${tokenId}`, { method: "DELETE" });
        setLoading(false);
        router.refresh();
      }}
      className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      失効
    </button>
  );
}

export { SCOPE_LABELS };
