import Link from "next/link";
import { getEmailVerificationByToken } from "@/server/services/companies";
import ApplyShell from "@/app/apply/ApplyShell";
import RegisterForm from "@/app/apply/register/RegisterForm";

export const dynamic = "force-dynamic";

// 企業申込の第2段階（§6.4.1、2026-11-04 変更）: メールで届いた登録用URL（?token=）から開き、
// 企業情報・代表者・パスワードを入力して登録を完了する。トークンはサーバー側で検証し、メールアドレスは変更不可
export default async function ApplyRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const tokenValue = typeof token === "string" ? token : "";
  const verification = tokenValue ? await getEmailVerificationByToken(tokenValue) : null;

  if (!verification) {
    return (
      <ApplyShell>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/10">
          <h1 className="mb-3 text-xl font-bold">登録用URLが無効か期限切れです</h1>
          <p className="text-sm text-slate-600">
            登録用URLの有効期限は送信から 24 時間です。期限が切れた場合や URL が正しく開けない場合は、
            申込画面からメールアドレスをもう一度送信してください（新しい URL が届きます）。
          </p>
          <Link
            href="/apply"
            className="mt-6 inline-block w-full rounded-full bg-blue-600 py-3 text-center text-sm font-bold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-700"
          >
            申込画面へ戻る
          </Link>
        </div>
      </ApplyShell>
    );
  }

  return (
    <ApplyShell>
      <RegisterForm token={tokenValue} email={verification.email} />
    </ApplyShell>
  );
}
