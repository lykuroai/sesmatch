"use client";

// 企業のセキュリティ設定 UI（PRO版仕様書 §4.12 IP 制限、§4.13 SSO）。company.manage 権限で操作する。
// IP 制限: 許可 IP／CIDR を20件まで。設定者の現在 IP を含まないリストは保存できない（サーバ側でも検証）
// SSO: OIDC または SAML の IdP 設定、SSO 識別子（開始 URL）、必須化（代表は非常用にパスワード可）
import { useState } from "react";
import { useRouter } from "next/navigation";

export type SecurityOverview = {
  ipRestriction: { allowList: string[]; currentIp: string | null; active: boolean; currentIpAllowed: boolean };
  sso: {
    provider: "NONE" | "OIDC" | "SAML";
    slug: string | null;
    required: boolean;
    configured: boolean;
    oidc: { issuer: string; clientId: string; hasSecret: boolean } | null;
    saml: { entryPoint: string; idpIssuer: string; certLength: number } | null;
    sp: { entityId: string; acsUrl: string; redirectUri: string; metadataUrl: string; startUrl: string | null };
  };
};

function ProBadge() {
  return <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRO</span>;
}

export function IpRestrictionPanel({ initial, canManage, pro }: { initial: SecurityOverview["ipRestriction"]; canManage: boolean; pro: boolean }) {
  const router = useRouter();
  const [entries, setEntries] = useState<string[]>(initial.allowList);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(list: string[]) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/v1/company/security/ip", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ipAllowList: list }) });
    const b = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok) {
      setEntries(b.allowList);
      setSaved(true);
      router.refresh();
    } else setError(b?.error?.message ?? "保存に失敗しました");
  }
  function add() {
    const v = draft.trim();
    if (!v) return;
    if (entries.includes(v)) return setDraft("");
    setEntries([...entries, v]);
    setDraft("");
  }
  const disabled = !canManage || !pro || busy;

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <ProBadge />
        IP アドレス制限
      </h2>
      <p className="mb-3 text-xs text-stone-500">
        許可した IP アドレス／CIDR からのみログイン・操作・API 呼び出しができます（20件まで）。
        空にすると制限なし。現在の接続元 IP を含まないリストは保存できません（ロックアウト防止）。
        ローカルサーバ（SES-Connector）の固定 IP も登録してください。
      </p>
      <p className="mb-3 text-xs">
        現在の接続元 IP: <code className="rounded bg-white px-1.5 py-0.5">{initial.currentIp ?? "不明"}</code>
        {initial.active && (initial.currentIpAllowed ? <span className="ml-2 text-emerald-700">（許可済み）</span> : <span className="ml-2 text-red-600">（許可外）</span>)}
      </p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {saved && <p className="mb-2 text-xs text-emerald-700">保存しました</p>}
      <ul className="mb-3 flex flex-wrap gap-2">
        {entries.map((e) => (
          <li key={e} className="flex items-center gap-1 rounded border border-stone-300 bg-white px-2 py-1 font-mono text-xs">
            {e}
            {!disabled && (
              <button type="button" onClick={() => setEntries(entries.filter((x) => x !== e))} className="ml-1 text-stone-400 hover:text-red-600" aria-label="削除">
                ×
              </button>
            )}
          </li>
        ))}
        {entries.length === 0 && <li className="text-xs text-stone-400">制限なし（未設定）</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="例: 203.0.113.10 または 203.0.113.0/24"
          disabled={disabled}
          className="w-72 max-w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs"
        />
        <button type="button" onClick={add} disabled={disabled || !draft.trim()} className="rounded border border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-50">
          追加
        </button>
        {initial.currentIp && !entries.includes(initial.currentIp) && (
          <button type="button" onClick={() => setEntries([...entries, initial.currentIp!])} disabled={disabled} className="rounded border border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-50">
            現在の IP を追加
          </button>
        )}
        <button type="button" onClick={() => save(entries)} disabled={disabled} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          保存
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("IP アドレス制限を解除しますか？")) void save([]);
            }}
            disabled={!canManage || busy}
            className="rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            制限を解除
          </button>
        )}
      </div>
      {!pro && <p className="mt-2 text-xs text-stone-500">PRO 版の機能です。</p>}
    </section>
  );
}

export function SsoSettingsPanel({ initial, canManage, pro }: { initial: SecurityOverview["sso"]; canManage: boolean; pro: boolean }) {
  const router = useRouter();
  const [provider, setProvider] = useState<"NONE" | "OIDC" | "SAML">(initial.provider);
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [required, setRequired] = useState(initial.required);
  const [issuer, setIssuer] = useState(initial.oidc?.issuer ?? "");
  const [clientId, setClientId] = useState(initial.oidc?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [entryPoint, setEntryPoint] = useState(initial.saml?.entryPoint ?? "");
  const [idpIssuer, setIdpIssuer] = useState(initial.saml?.idpIssuer ?? "");
  const [idpCert, setIdpCert] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const disabled = !canManage || !pro || busy;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const body = {
      provider,
      slug: slug || null,
      required,
      oidc: provider === "OIDC" ? { issuer, clientId, clientSecret: clientSecret || undefined } : undefined,
      saml: provider === "SAML" ? { entryPoint, idpCert, idpIssuer: idpIssuer || undefined } : undefined,
    };
    const res = await fetch("/api/v1/company/security/sso", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const b = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setClientSecret("");
      setIdpCert("");
      router.refresh();
    } else setError(b?.error?.message ?? "保存に失敗しました");
  }

  const input = "w-full rounded border border-stone-300 px-2 py-1 text-xs disabled:bg-stone-100";
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-sm">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <ProBadge />
        SSO（シングルサインオン）
      </h2>
      <p className="mb-3 text-xs text-stone-500">
        Google Workspace・Microsoft Entra ID などの IdP でログインできます（OIDC または SAML 2.0）。
        IdP のメールアドレスと一致する登録済み担当者のみログインでき、担当者の自動作成は行いません。
      </p>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-stone-600">方式</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} disabled={disabled} className={input}>
              <option value="NONE">使用しない</option>
              <option value="OIDC">OIDC（OpenID Connect）</option>
              <option value="SAML">SAML 2.0</option>
            </select>
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-stone-600">SSO 識別子（ログイン時に入力・英小文字と数字・3〜32文字）</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} disabled={disabled || provider === "NONE"} placeholder="例: example-inc" className={input} />
          </label>
        </div>
        {provider === "OIDC" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs sm:col-span-2">
              <span className="mb-1 block font-medium text-stone-600">Issuer（例: https://accounts.google.com ／ https://login.microsoftonline.com/{"{テナントID}"}/v2.0）</span>
              <input value={issuer} onChange={(e) => setIssuer(e.target.value)} disabled={disabled} className={input} />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-stone-600">クライアント ID</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={disabled} className={input} />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-stone-600">クライアントシークレット{initial.oidc?.hasSecret && "（設定済み。変更時のみ入力）"}</span>
              <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} disabled={disabled} autoComplete="new-password" className={input} />
            </label>
            <p className="text-xs text-stone-500 sm:col-span-2">
              IdP に登録するリダイレクト URI: <code className="rounded bg-white px-1">{initial.sp.redirectUri}</code>
            </p>
          </div>
        )}
        {provider === "SAML" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs sm:col-span-2">
              <span className="mb-1 block font-medium text-stone-600">IdP の SSO URL（ログイン URL）</span>
              <input value={entryPoint} onChange={(e) => setEntryPoint(e.target.value)} disabled={disabled} className={input} />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-stone-600">IdP の Entity ID（任意）</span>
              <input value={idpIssuer} onChange={(e) => setIdpIssuer(e.target.value)} disabled={disabled} className={input} />
            </label>
            <label className="block text-xs sm:col-span-2">
              <span className="mb-1 block font-medium text-stone-600">IdP の署名証明書（PEM）{initial.saml && "（設定済み。変更時のみ貼り付け）"}</span>
              <textarea value={idpCert} onChange={(e) => setIdpCert(e.target.value)} disabled={disabled} rows={4} className={`${input} font-mono`} placeholder="-----BEGIN CERTIFICATE----- ..." />
            </label>
            <p className="text-xs text-stone-500 sm:col-span-2">
              IdP に登録する値 — Entity ID: <code className="rounded bg-white px-1">{initial.sp.entityId}</code> ／ ACS URL（応答先）: <code className="rounded bg-white px-1">{initial.sp.acsUrl}</code> ／
              SP メタデータ: <a href={initial.sp.metadataUrl} className="text-orange-800 underline" target="_blank" rel="noopener noreferrer">XML</a>
            </p>
          </div>
        )}
        {provider !== "NONE" && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={required} disabled={disabled} onChange={(e) => setRequired(e.target.checked)} />
            SSO を必須にする（パスワードログインを禁止。代表は非常用にパスワードでログインできます）
          </label>
        )}
        {initial.sp.startUrl && initial.configured && (
          <p className="text-xs text-stone-600">
            ログイン開始 URL: <code className="rounded bg-white px-1">{initial.sp.startUrl}</code>（ログイン画面の「SSO でログイン」から識別子を入力しても開始できます）
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {saved && <p className="text-xs text-emerald-700">保存しました</p>}
        <div className="flex items-center gap-2">
          <button type="submit" disabled={disabled} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            保存
          </button>
          {!pro && <span className="text-xs text-stone-500">PRO 版の機能です。</span>}
        </div>
      </form>
    </section>
  );
}
