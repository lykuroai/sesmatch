import Link from "next/link";
import type { Metadata } from "next";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

// 企業登録のルール・担当者登録・運用の流れ・禁止事項（2026-10-23 に企業申込画面の横から独立ページ化）
// 未ログインで閲覧可能。見た目はログインLPに合わせる
export const metadata: Metadata = {
  title: "企業登録のルール",
  description:
    "SES DirectMatchの企業登録のルール、担当者の登録、運用の流れ、禁止事項。契約主体は企業または個人事業者で、代表メールアドレス宛の登録用URLで本人確認を行います。",
  alternates: { canonical: "/apply/rules" },
  openGraph: { title: "企業登録のルール" },
};

const SECTIONS: { title: string; items: React.ReactNode[] }[] = [
  {
    title: "企業登録のルール",
    items: [
      "契約主体は企業または個人事業者です。個人アカウントでの利用はできません。",
      "申込はまずメールアドレスのみ入力します。代表メールアドレス宛に届く登録用URL（24時間有効）を開き、企業情報・代表者・パスワードを入力すると登録が完了します。同じメールアドレスは1アカウントのみ登録できます。",
      <>
        重複登録は次のとおり防止されます: 同一管轄（都道府県）内に同名の企業が既にある場合は<b>登録できません</b>。
        社名または所在地が既存企業と一致する場合は<b>警告を表示</b>し、内容を確認の上で申込めます。
      </>,
      "既存の登録企業に担当者として参加する場合は、新規申込ではなく既存企業の代表からの招待を受けてください。",
      "所在地は必須です。管轄の判定に使用するため、都道府県から入力してください。",
      "法人番号（13桁）は任意です。入力すると重複判定がより確実になります。",
      "審査は自動で行われ、通過するとその場で利用開始（開通）となります。完了メールが届いたらすぐにログインできます。",
      "基本版は掲載料・月額費用・成約手数料すべて0円です。有料のPRO版（月額39,800円・税別）もあり、お申込は登録後の「お問合せ」から受け付けます。",
      "PRO版の利用企業には、他社の公開案件・公開人材に掲載企業名（案件保有企業・人材所属企業の名称）が表示されます。貴社の掲載企業名もPRO版の利用企業に表示されます。人材本人の氏名・実額単価はプランにかかわらず双方承認後にのみ開示されます。",
    ],
  },
  {
    title: "担当者の登録",
    items: [
      "申込者が「代表」として登録されます。代表は企業情報・担当者・契約のすべてを管理できます。",
      "追加の担当者は、開通後に「設定 > 担当者管理」から代表・企業管理者が招待します。初期パスワードが招待メールで届き、初回ログイン後に変更します。",
      "担当者には役割（企業管理者・営業担当・人材管理担当・案件管理担当・契約担当・経理担当・個人情報管理者・監査担当・閲覧者）を複数割り当てられます。操作できる範囲は役割で決まります。",
    ],
  },
  {
    title: "運用の流れ",
    items: [
      "1. 案件・人材を登録します（画面入力のほか、ファイル・メールの取込に対応。AIが自動整理し、確認画面で確定します）。",
      "2. 双方向マッチングの候補から「商談を申し込む」と、相手企業の承認待ちになります。",
      "3. 双方が承認すると商談開始となり、氏名・実額単価・企業名が相互に同時開示されます（片方の承認だけでは開示されません）。",
      "4. 面談・条件調整ののち条件確認書を取り交わし、双方の署名で成約となります。",
      "5. 稼働開始後は月次の稼働記録が自動で作成されます（成約手数料は無料化中のため0円です）。",
      "詳しい操作方法は、開通後にコンソール内の「ご利用マニュアル」をご覧ください。",
    ],
  },
  {
    title: "禁止事項",
    items: [
      "案件・人材情報の再転載、無承認の再仲介、二社下以降への流通は禁止です（商流は最大一社下まで）。",
      "プラットフォームを介さない直接取引への誘引・迂回は禁止です。",
      "商談開始（双方承認）前のメッセージで連絡先を交換することはできません。",
      "違反が確認された場合、利用停止や登録抹消の対象となります。",
    ],
  },
];

export default function ApplyRulesPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <PublicHeader />
      <section className="relative overflow-hidden bg-gradient-to-b from-sky-50 via-white to-white">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-40 h-96 w-96 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-4 py-10 lg:px-6 lg:py-16">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Rules</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">企業登録のルール</h1>
            <p className="mt-3 text-sm text-slate-600">企業申込の前にご確認ください。</p>
          </div>
          <div className="mt-8 space-y-4">
            {SECTIONS.map((sec) => (
              <section key={sec.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-bold text-slate-900">{sec.title}</h2>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
                  {sec.items.map((item, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/apply"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-700"
            >
              企業登録を申し込む
              <span aria-hidden>→</span>
            </Link>
            <Link href="/login" className="px-4 py-3 text-sm font-medium text-slate-600 hover:text-blue-700">
              ログイン画面へ戻る
            </Link>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
