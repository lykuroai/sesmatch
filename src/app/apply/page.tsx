"use client";

// 企業申込（§6.4）。申込後は運営審査を経てコンソール開通。
import { useState } from "react";
import Link from "next/link";

const input = "w-full rounded border border-slate-300 px-3 py-2 text-sm";
const label = "mb-1 block text-sm font-medium";

// 申込画面の横に表示する企業登録ルール・担当者登録・運用方法の説明（画面用語は統一ルールに準拠）
function ApplyGuide() {
  const h = "mb-2 text-sm font-bold text-slate-800";
  const ul = "space-y-1.5 text-xs leading-relaxed text-slate-600";
  return (
    <aside className="w-[28rem] max-w-full space-y-5 rounded-xl border border-slate-200 bg-slate-50 p-6">
      <div>
        <h2 className={h}>企業登録のルール</h2>
        <ul className={ul}>
          <li>・契約主体は企業または個人事業者です。個人アカウントでの利用はできません。</li>
          <li>・代表メールアドレス宛の確認コード（15分有効）で本人確認を行います。同じメールアドレスは1アカウントのみ登録できます。</li>
          <li>
            ・重複登録は次のとおり防止されます:
            同一管轄（都道府県）内に同名の企業が既にある場合は<b>登録できません</b>。
            社名または所在地のどちらかが既存企業と一致する場合は<b>警告を表示</b>し、内容を確認の上で申込めます。
          </li>
          <li>・既存の登録企業に担当者として参加する場合は、新規申込ではなく既存企業の代表からの招待を受けてください。</li>
          <li>・法人番号（13桁）は任意です。入力すると重複判定に使用され、審査がスムーズになります。</li>
          <li>・申込後は運営審査を行い、承認されるとメールでお知らせします。審査完了までログインはできません。</li>
          <li>・利用開始（承認）から30日間は成約手数料が無料です。</li>
        </ul>
      </div>
      <div>
        <h2 className={h}>担当者の登録</h2>
        <ul className={ul}>
          <li>・申込者が「代表」として登録されます。代表は企業情報・担当者・契約のすべてを管理できます。</li>
          <li>・追加の担当者は、開通後に「設定 &gt; 担当者管理」から代表・企業管理者が招待します。初期パスワードが招待メールで届き、初回ログイン後に変更します。</li>
          <li>・担当者には役割（企業管理者・営業担当・人材管理担当・案件管理担当・契約担当・経理担当・個人情報管理者・監査担当・閲覧者）を複数割り当てられます。操作できる範囲は役割で決まります。</li>
        </ul>
      </div>
      <div>
        <h2 className={h}>運用の流れ</h2>
        <ul className={ul}>
          <li>1. 案件・人材を登録します（画面入力のほか、ファイル・メールの取込に対応。個人情報は匿名化してから自動整理し、確認画面で確定します）。</li>
          <li>2. 双方向マッチングの候補から「商談を申し込む」と、相手企業の承認待ちになります。</li>
          <li>3. 双方が承認すると商談開始となり、氏名・実額単価・企業名が相互に同時開示されます（片方の承認だけでは開示されません）。</li>
          <li>4. 面談・条件調整ののち条件確認書を取り交わし、双方の署名で成約となります。</li>
          <li>5. 稼働開始後は月次確認を行い、成約手数料（需要側企業負担・確定契約金額の3%・最大12稼働月）が確定します。</li>
          <li>・詳しい操作方法は、開通後にコンソール内の「ご利用マニュアル」をご覧ください。</li>
        </ul>
      </div>
      <div>
        <h2 className={h}>禁止事項</h2>
        <ul className={ul}>
          <li>・案件・人材情報の再転載、無承認の再仲介、二社下以降への流通は禁止です（商流は最大一社下まで）。</li>
          <li>・プラットフォームを介さない直接取引への誘引・迂回は禁止です。</li>
          <li>・商談開始（双方承認）前のメッセージで連絡先を交換することはできません。</li>
          <li>・違反が確認された場合、利用停止や登録抹消の対象となります。</li>
        </ul>
      </div>
    </aside>
  );
}

type ApplyPayload = Record<string, unknown>;

export default function ApplyPage() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [companyType, setCompanyType] = useState("CORPORATION");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  // 類似企業の警告（社名 or 所在地の片方一致）。確認の上で再送すると申込が確定する
  const [warning, setWarning] = useState<{ matchedName: string; matchedField: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<ApplyPayload | null>(null);

  // 代表メールへ確認コードを送付する
  async function sendCode() {
    if (!email.trim()) {
      setError("メールアドレスを入力してから確認コードを送信してください");
      return;
    }
    setSendingCode(true);
    setError(null);
    const res = await fetch("/api/v1/companies/applications/email-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setSendingCode(false);
    if (res.ok) setCodeSent(true);
    else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "確認コードの送信に失敗しました");
    }
  }

  async function post(payload: ApplyPayload) {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/companies/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    const b = await res.json().catch(() => null);
    if (res.ok && b?.duplicateWarning) {
      // 類似企業あり → 警告を表示し、確認の上で再送できるよう入力内容を保持する
      setWarning(b.duplicateWarning);
      setPendingPayload(payload);
    } else if (res.ok) {
      setDone(true);
    } else {
      setError(b?.error?.message ?? "申込に失敗しました");
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setWarning(null);
    setPendingPayload(null);
    const f = new FormData(e.currentTarget);
    await post({
      companyName: f.get("companyName"),
      companyType: f.get("companyType"),
      corporateNumber: f.get("corporateNumber") || undefined,
      address: f.get("address"),
      ownerName: f.get("ownerName"),
      email: f.get("email"),
      password: f.get("password"),
      agreedToTerms: f.get("agreedToTerms") === "on",
      emailVerificationCode: f.get("emailVerificationCode"),
    });
  }

  // 警告を確認した上で申込を確定する
  async function confirmAndSubmit() {
    if (!pendingPayload) return;
    await post({ ...pendingPayload, duplicateWarningConfirmed: true });
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="w-[28rem] rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-3 text-xl font-bold">申込を受け付けました</h1>
          <p className="text-sm text-slate-600">
            運営審査ののち、企業コンソールが開通します。開通後、登録したメールアドレスとパスワードでログインしてください。
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
            ログインページへ
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10 lg:flex-row lg:items-start">
      <form onSubmit={submit} className="w-[28rem] max-w-full rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-bold">企業申込</h1>
        <p className="mb-6 text-sm text-slate-500">
          契約主体は企業または個人事業者です（個人アカウントでの利用はできません）
        </p>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {warning && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">類似する企業が既に登録されています</p>
            <p className="mt-1">
              {warning.matchedField === "address"
                ? `同じ所在地の企業（${warning.matchedName}）が登録済みです。`
                : `同名または類似名の企業（${warning.matchedName}）が登録済みです。`}
              既存企業の担当者として参加する場合は、そのまま申込まず既存企業の代表から招待を受けてください。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={confirmAndSubmit}
                disabled={loading}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {loading ? "送信中..." : "別企業として申込む"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWarning(null);
                  setPendingPayload(null);
                }}
                className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                入力を修正する
              </button>
            </div>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className={label}>企業形態</label>
            <select
              name="companyType"
              value={companyType}
              onChange={(e) => setCompanyType(e.target.value)}
              className={input}
            >
              <option value="CORPORATION">法人</option>
              <option value="SOLE_PROPRIETOR">個人事業者</option>
            </select>
          </div>
          <div>
            <label className={label}>{companyType === "CORPORATION" ? "企業名" : "屋号・事業者名"}</label>
            <input name="companyName" required className={input} />
          </div>
          {companyType === "CORPORATION" && (
            <div>
              <label className={label}>法人番号（13桁・任意）</label>
              <input name="corporateNumber" pattern="\d{13}" className={input} placeholder="1234567890123" />
            </div>
          )}
          <div>
            <label className={label}>所在地</label>
            <input name="address" required className={input} placeholder="例: 東京都台東区上野1-1-1" />
          </div>
          <div>
            <label className={label}>代表者氏名</label>
            <input name="ownerName" required className={input} />
          </div>
          <div>
            <label className={label}>メールアドレス</label>
            <div className="flex gap-2">
              <input
                type="email"
                name="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={input}
              />
              <button
                type="button"
                onClick={sendCode}
                disabled={sendingCode}
                className="shrink-0 rounded border border-blue-600 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                {sendingCode ? "送信中..." : codeSent ? "コード再送" : "確認コード送信"}
              </button>
            </div>
            {codeSent && (
              <p className="mt-1 text-xs text-emerald-700">
                確認コードを送信しました。メールを確認して下に入力してください（15分有効）
              </p>
            )}
          </div>
          <div>
            <label className={label}>メール確認コード（6桁）</label>
            <input
              name="emailVerificationCode"
              required
              pattern="\d{6}"
              maxLength={6}
              className={input}
              placeholder="メールで届いた6桁の数字"
            />
          </div>
          <div>
            <label className={label}>パスワード（8文字以上）</label>
            <input type="password" name="password" required minLength={8} className={input} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="agreedToTerms" required className="mt-0.5" />
            <span>
              <Link href="/terms" target="_blank" className="text-blue-600 hover:underline">利用規約</Link>・
              <Link href="/agreement" target="_blank" className="text-blue-600 hover:underline">基本契約</Link>・
              <Link href="/privacy-policy" target="_blank" className="text-blue-600 hover:underline">プライバシーポリシー</Link>
              に同意します（案件・人材の再転載、無承認の再仲介、二社下以降の流通、
              直接取引の迂回は禁止されています）
            </span>
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "送信中..." : "申込む（運営審査へ）"}
        </button>
        <p className="mt-4 text-center text-xs text-slate-400">
          既にアカウントをお持ちの方は <Link href="/login" className="text-blue-600 hover:underline">ログイン</Link>
        </p>
      </form>
      <ApplyGuide />
    </main>
  );
}
