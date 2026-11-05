"use client";

// 2要素認証（TOTP）の設定 UI（PRO版仕様書 §4.11）。本人の設定と、企業の必須化（PRO・company.manage）
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Status = { enabled: boolean; pendingSetup: boolean; backupCodesLeft: number };

export function MfaSetup({ required = false }: { required?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/v1/auth/mfa");
    if (res.ok) setStatus(await res.json());
  }
  useEffect(() => {
    void load();
  }, []);

  async function begin() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/mfa/setup", { method: "POST" });
    setBusy(false);
    const b = await res.json().catch(() => null);
    if (res.ok) setSetup(b);
    else setError(b?.error?.message ?? "設定を開始できませんでした");
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/mfa/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    setBusy(false);
    const b = await res.json().catch(() => null);
    if (res.ok) {
      setBackup(b.backupCodes);
      setSetup(null);
      setCode("");
      await load();
      router.refresh();
    } else setError(b?.error?.message ?? "コードを確認できませんでした");
  }
  async function disable(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm("2要素認証を無効にしますか？")) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/mfa", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    setBusy(false);
    const b = await res.json().catch(() => null);
    if (res.ok) {
      setCode("");
      await load();
      router.refresh();
    } else setError(b?.error?.message ?? "無効化できませんでした");
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-bold">2要素認証（認証アプリ）</h2>
      <p className="mb-3 text-xs text-stone-500">
        Google Authenticator・Microsoft Authenticator 等の認証アプリで、ログイン時に6桁のコードを入力します。
        {required && <span className="ml-1 font-medium text-amber-700">貴社では2要素認証が必須です。設定が完了するまで他の画面は開けません。</span>}
      </p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {backup && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-bold text-amber-800">バックアップコード（この画面でしか表示されません。安全な場所に保管してください）</p>
          <p className="mt-1 text-xs text-stone-600">認証アプリが使えないときに1回ずつ使えます。</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
            {backup.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setBackup(null)} className="mt-2 text-xs text-stone-600 hover:underline">保管しました（閉じる）</button>
        </div>
      )}
      {status?.enabled ? (
        <form onSubmit={disable} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">有効</span>
          <span className="text-xs text-stone-500">バックアップコード残り {status.backupCodesLeft}</span>
          {!required && (
            <>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="コード" className="w-32 rounded border border-stone-300 px-2 py-1 text-xs" />
              <button type="submit" disabled={busy || code.length < 6} className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">無効化</button>
            </>
          )}
        </form>
      ) : setup ? (
        <form onSubmit={verify} className="text-sm">
          <ol className="list-decimal space-y-2 pl-5 text-xs text-stone-700">
            <li>認証アプリで下の QR コードを読み取るか、キーを手入力します。</li>
            <li>アプリに表示された6桁のコードを入力して「有効にする」を押します。</li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="認証アプリ用 QR コード" width={160} height={160} className="rounded border border-stone-200" />
            <div className="text-xs">
              <p className="text-stone-500">手入力用キー</p>
              <p className="font-mono text-sm tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(" ")}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="6桁のコード" className="w-36 rounded border border-stone-300 px-2 py-1" />
            <button type="submit" disabled={busy || code.length < 6} className="rounded bg-orange-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-800 disabled:opacity-50">
              有効にする
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={begin} disabled={busy} className="rounded bg-orange-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-800 disabled:opacity-50">
          2要素認証を設定する
        </button>
      )}
    </section>
  );
}

// 企業の必須化（PRO・company.manage）
export function MfaRequirementToggle({ initial, members, canManage, pro }: { initial: boolean; members: { name: string; mfaEnabled: boolean }[]; canManage: boolean; pro: boolean }) {
  const router = useRouter();
  const [required, setRequired] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  async function toggle(next: boolean) {
    setError(null);
    const res = await fetch("/api/v1/company/security", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mfaRequired: next }) });
    const b = await res.json().catch(() => null);
    if (res.ok) {
      setRequired(next);
      router.refresh();
    } else setError(b?.error?.message ?? "更新に失敗しました");
  }
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>
        全担当者に2要素認証を必須にする
      </h2>
      <p className="mb-3 text-xs text-stone-500">有効にすると、未設定の担当者は次回ログイン後に設定画面へ誘導され、設定完了まで他の操作ができません。</p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={required} disabled={!canManage || !pro} onChange={(e) => toggle(e.target.checked)} />
        必須にする{!pro && <span className="text-xs text-stone-500">（PRO 版の機能です）</span>}
      </label>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        {members.map((m) => (
          <li key={m.name}>
            {m.name}: {m.mfaEnabled ? <span className="text-emerald-700">設定済み</span> : <span className="text-amber-700">未設定</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// 必須化されているが未設定のときにコンソール全体の代わりに表示する
export function MfaRequiredGate() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">2要素認証の設定が必要です</h1>
      <p className="mb-6 text-sm text-stone-600">貴社の設定により、2要素認証を有効にするまで企業コンソールをご利用いただけません。</p>
      <MfaSetup required />
    </div>
  );
}
