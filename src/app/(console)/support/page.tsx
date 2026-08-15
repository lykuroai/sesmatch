import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";
import { InquiryForm } from "@/components/InquiryForm";
import { InquiryReplyForm } from "@/components/InquiryReplyForm";

// お問合せ: Q&A集（よくある質問）と運営への問い合わせフォーム・履歴
const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "案件や人材を登録するには？",
    a: (
      <>
        案件・人材画面の「案件を登録」「人材を登録」から画面入力するか、「取込」ボタンから案件票・スキルシートを貼り付け／アップロードしてください。AIが内容を自動抽出し、人手確認のうえ下書きとして登録されます。
      </>
    ),
  },
  {
    q: "スマホで撮影した書類を取り込めますか？",
    a: (
      <>
        取り込めます。スマホで取込パネルを開くと「カメラで撮影して取込」ボタンが表示され、複数ページの書類は1ページずつ続けて撮影して1件にまとめられます（最大10ページ）。手書きや不鮮明な写真は認識精度が落ちるため、明るい場所で真上から撮影してください。
      </>
    ),
  },
  {
    q: "1通の紹介メールに複数の案件が入っている場合は？",
    a: (
      <>
        そのまま貼り付ければ、【案件名】の見出しごとに自動で分割され、案件ごとに人手確認できます（最大10件）。
      </>
    ),
  },
  {
    q: "取込がエラーになった／人手確認待ちにならない",
    a: (
      <>
        取込は受付後に裏で解析され、1分ほどで取込履歴に反映されます。失敗した場合は取込履歴にエラー内容が表示され、「再実行」ボタンで再処理できます。解決しない場合は下のフォームからお問合せください。
      </>
    ),
  },
  {
    q: "他社の案件・人材の企業名や氏名が見えないのはなぜ？",
    a: (
      <>
        検索・マッチング段階（Level 1）では匿名情報のみ公開されます。商談を申し込み、双方が承認して商談開始になると、企業名・氏名・実額単価が相互に同時開示されます（Level 2）。
      </>
    ),
  },
  {
    q: "登録した案件・人材が他社に表示されない",
    a: (
      <>
        公開状態が「下書き」のままだと自社にしか表示されません。詳細画面の「公開する」で公開してください。人材は有効な本人同意の登録が公開の条件です。公開をやめたい場合は「非公開にする」で下書きに戻せます。
      </>
    ),
  },
  {
    q: "マッチングに候補が出ない",
    a: (
      <>
        案件・人材が公開状態か、人材の本人同意が有効かをご確認ください。既定では必須スキルを100%満たす候補のみ表示されるため、マッチングパネルの「必須スキル適合」を90%以上などに下げると、一部不足の候補も抽出できます。
      </>
    ),
  },
  {
    q: "メッセージで連絡先を送れない",
    a: (
      <>
        商談開始（双方承認）前は、メール・電話番号・SNS・URL等の連絡先を含むメッセージは自動検出されて送信できません。商談開始後は制限されません。
      </>
    ),
  },
  {
    q: "手数料はいくらかかりますか？",
    a: (
      <>
        登録・掲載・商談は無料です。成約した契約金額の3%（税別・需要側企業負担）を、実稼働開始から最大12稼働月お支払いいただきます。13稼働月目以降は無料、稼働前キャンセルは0円、稼働開始後14日以内の離脱は全額返金です。
      </>
    ),
  },
  {
    q: "案件・人材の状態を手動で変更したい",
    a: (
      <>
        自社の案件・人材の詳細画面で変更できます。「公開状態」の横の「公開する」「非公開にする」ボタンで公開⇄下書きを切り替えられます。「案件状況」（募集中／商談中／成約／終了）と「稼働状況」（紹介中／商談中／成約／稼働中）は、状態表示のプルダウンから手動で変更できます。商談開始・成約の際は自動でも更新されます。
      </>
    ),
  },
  {
    q: "担当者を追加・変更したい",
    a: (
      <>
        ヘッダーの会社名から会社マイページを開き、担当者管理から招待・権限変更ができます（代表・管理者権限が必要です）。
      </>
    ),
  },
];

const STATUS_LABELS: Record<string, string> = {
  OPEN: "受付済み",
  REVIEWING: "対応中",
  RESOLVED: "対応済み",
};

export default async function SupportPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const inquiries = await prisma.inquiry.findMany({
    where: { tenantCompanyId: auth.companyId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold">お問合せ</h1>
      <p className="mb-6 text-xs text-slate-500">
        まずは下のよくある質問（Q&amp;A）をご確認ください。解決しない場合はフォームからお問合せいただけます。
        操作手順の全体は{" "}
        <Link href="/manual" className="text-blue-600 hover:underline">
          操作マニュアル
        </Link>{" "}
        をご覧ください。
      </p>

      {/* Q&A集 */}
      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-bold">よくある質問（Q&amp;A）</h2>
        <div className="divide-y divide-slate-100">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-2">
              <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-blue-700">
                Q. {f.q}
              </summary>
              <p className="mt-2 pl-4 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 問い合わせフォーム */}
      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-bold">運営へのお問合せ</h2>
        <p className="mb-4 text-xs text-slate-500">
          Q&amp;Aで解決しない場合はこちらからご連絡ください。内容を確認のうえ、運営からご登録のメールアドレス宛にご連絡します。
        </p>
        <InquiryForm />
      </section>

      {/* 自社のお問合せ履歴 */}
      {inquiries.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">お問合せ履歴</h2>
          <ul className="divide-y divide-slate-100">
            {inquiries.map((q) => (
              <li key={q.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">{q.code}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{q.category}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      q.status === "RESOLVED"
                        ? "bg-emerald-50 text-emerald-700"
                        : q.status === "REVIEWING"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {STATUS_LABELS[q.status] ?? q.status}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(q.createdAt).toLocaleString("ja-JP")}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{q.body}</p>
                {/* スレッド（運営の回答・自社の追記） */}
                {q.messages.length > 0 && (
                  <div className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
                    {q.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded-lg p-2.5 text-sm ${m.fromOperator ? "bg-blue-50" : "bg-slate-50"}`}
                      >
                        <p className="mb-1 text-xs text-slate-500">
                          {m.fromOperator ? "運営" : "自社"} ・ {new Date(m.createdAt).toLocaleString("ja-JP")}
                        </p>
                        <p className="whitespace-pre-wrap text-slate-700">{m.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                <InquiryReplyForm inquiryId={q.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
