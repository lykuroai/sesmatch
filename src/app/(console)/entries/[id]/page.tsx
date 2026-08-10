import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { getEntry } from "@/server/services/entries";
import { hasPermission } from "@/server/auth/rbac";
import {
  canDecline,
  canMoveToConditions,
  canScheduleInterview,
} from "@/server/entries/logic";
import { ENTRY_STATUS_LABELS, ENTRY_TYPE_LABELS } from "@/lib/constants";
import { ActionButton } from "@/components/ActionButton";
import { MessageForm } from "@/components/MessageForm";
import { InterviewForm } from "@/components/InterviewForm";
import { ContractCreateForm } from "@/components/ContractCreateForm";

const FLOW = [
  "SUBMITTED",
  "SUPPLY_APPROVED/DEMAND_APPROVED",
  "MUTUALLY_APPROVED",
  "INTERVIEW",
  "CONDITIONS",
  "CONTRACTING",
  "CONTRACTED",
];

export default async function EntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { id } = await params;
  const e = await getEntry(auth, id);
  if (!e) notFound();

  const canApprovePerm = hasPermission(auth.roles, "entry.approve");
  const canSubmitPerm = hasPermission(auth.roles, "entry.submit");
  const canMessage = hasPermission(auth.roles, "message.send");
  const canInterview = hasPermission(auth.roles, "interview.manage");

  const myApproved = e.side === "SUPPLY" ? e.supplyApproved : e.demandApproved;
  const approvable =
    canApprovePerm &&
    !myApproved &&
    ["SUBMITTED", "SUPPLY_APPROVED", "DEMAND_APPROVED"].includes(e.status);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            <span className={`mr-2 rounded px-2 py-1 text-sm align-middle ${e.type === "PROPOSAL" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>
              {ENTRY_TYPE_LABELS[e.type]}
            </span>
            {e.project.code} {e.project.name}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            状態: <span className="font-medium text-slate-800">{ENTRY_STATUS_LABELS[e.status]}</span>
            {" ／ 自社の立場: "}
            <span className="font-medium">{e.side === "DEMAND" ? "需要側（案件保有）" : "供給側（人材提案）"}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            供給側承認: {e.supplyApproved ? "✓" : "未"} ／ 需要側承認: {e.demandApproved ? "✓" : "未"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {approvable && (
            <ActionButton
              path={`/api/v1/entries/${e.id}/approvals`}
              label="承認する"
              confirmMessage="承認すると、双方承認が揃った時点で企業名・氏名・実額単価が相互に同時開示されます（Level 2）。よろしいですか？"
            />
          )}
          {canApprovePerm && !e.createdByOwn && canDecline(e.status) && (
            <ActionButton path={`/api/v1/entries/${e.id}/decline`} label="見送る" confirmMessage="このエントリーを見送りますか？" />
          )}
          {canSubmitPerm && e.createdByOwn && canDecline(e.status) && (
            <ActionButton path={`/api/v1/entries/${e.id}/withdraw`} label="辞退する" confirmMessage="このエントリーを辞退しますか？" />
          )}
          {canApprovePerm && canMoveToConditions(e.status) && (
            <ActionButton path={`/api/v1/entries/${e.id}/conditions`} label="条件調整へ進める" />
          )}
        </div>
      </div>

      {/* Level 2 開示パネル（§10, §20.3: 双方承認後のみ） */}
      {e.disclosure ? (
        <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="mb-2 font-bold text-emerald-800">Level 2 開示情報（双方承認済み）</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <p>案件保有企業: <span className="font-medium">{e.disclosure.demandCompanyName}</span></p>
            <p>人材所属企業: <span className="font-medium">{e.disclosure.supplyCompanyName}</span></p>
            <p>人材氏名: <span className="font-medium">{e.disclosure.engineerName}</span></p>
            <p>希望単価（実額）: <span className="font-medium">{e.disclosure.engineerRateYen?.toLocaleString()}円/月</span></p>
          </div>
          <p className="mt-2 text-xs text-emerald-700">
            開示日時: {new Date(e.disclosure.disclosedAt).toLocaleString("ja-JP")}
          </p>
        </section>
      ) : (
        <section className="mb-6 rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-600">
          企業名・氏名・実額単価は双方承認が揃った時点で相互に同時開示されます。現在は Level 1（匿名）表示です。
        </section>
      )}

      <div className="grid grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">対象案件</h2>
          <Link href={`/projects/${e.project.id}`} className="text-sm font-medium text-blue-700 hover:underline">
            {e.project.code} {e.project.name}
          </Link>
          <p className="mt-2 text-sm text-slate-600">{e.project.anonymousSummary}</p>
          <p className="mt-2 text-xs text-slate-500">
            開始: {new Date(e.project.startDate).toLocaleDateString("ja-JP")} ／ 上限:{" "}
            {(e.project.rateMaxYen / 10_000).toLocaleString()}万円 ／ 必須:{" "}
            {e.project.requiredSkills.map((s) => s.name).join(", ")}
          </p>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">対象人材</h2>
          <Link href={`/engineers/${e.engineer.id}`} className="text-sm font-medium text-blue-700 hover:underline">
            {e.engineer.code}
            {e.disclosure?.engineerName ? ` ${e.disclosure.engineerName}` : e.engineer.name ? ` ${e.engineer.name}` : ""}
          </Link>
          <p className="mt-2 text-xs text-slate-500">
            {e.engineer.ageBand} ／ {e.engineer.rateBand} ／ スキル:{" "}
            {e.engineer.skills.map((s) => s.name).join(", ")}
          </p>
          {e.note && <p className="mt-3 rounded bg-slate-50 p-2 text-sm text-slate-600">{e.note}</p>}
        </section>
      </div>

      {/* 契約（§22）: 双方承認後、案件提供側（需要側）の契約担当が条件確認書を作成 */}
      {e.contract ? (
        <section className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm">
          条件確認書が作成されています:{" "}
          <Link href={`/contracts/${e.contract.id}`} className="font-medium text-indigo-700 hover:underline">
            詳細を開く
          </Link>
        </section>
      ) : (
        e.disclosure &&
        ["MUTUALLY_APPROVED", "INTERVIEW", "CONDITIONS"].includes(e.status) &&
        (e.side === "DEMAND" && hasPermission(auth.roles, "contract.create") ? (
          <ContractCreateForm
            entryId={e.id}
            defaultRateYen={e.disclosure.engineerRateYen}
            defaultContractType={e.project.contractType}
          />
        ) : (
          <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            条件確認書は案件提供側（需要側企業）が作成します。
          </section>
        ))
      )}

      {/* 面談（§20.2: 双方承認後） */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-bold">面談</h2>
        {e.interviews.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm">
            {e.interviews.map((iv) => (
              <li key={iv.id} className="flex gap-3">
                <span className="font-medium">{new Date(iv.scheduledAt).toLocaleString("ja-JP")}</span>
                <span>{iv.method}</span>
                <span className="text-slate-500">{iv.note}</span>
                <span className="text-xs text-slate-400">{iv.status}</span>
              </li>
            ))}
          </ul>
        )}
        {canInterview && canScheduleInterview(e.status) ? (
          <InterviewForm entryId={e.id} />
        ) : (
          <p className="text-xs text-slate-400">面談の設定は双方承認後に可能になります。</p>
        )}
      </section>

      {/* メッセージ（§21） */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-bold">メッセージ</h2>
        {!e.disclosure && (
          <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-700">
            相互承認前のため、メール・電話番号・SNS・URL 等の連絡先を含むメッセージは送信できません（自動検出されます）。
          </p>
        )}
        <div className="mb-4 space-y-2">
          {e.messages.map((m) => (
            <div key={m.id} className={`max-w-xl rounded-lg p-3 text-sm ${m.own ? "ml-auto bg-blue-50" : "bg-slate-100"}`}>
              <p className="mb-1 text-xs text-slate-500">
                {m.senderName}（{m.own ? "自社" : "相手企業"}） {new Date(m.createdAt).toLocaleString("ja-JP")}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
          {e.messages.length === 0 && <p className="text-sm text-slate-400">メッセージはまだありません</p>}
        </div>
        {canMessage && <MessageForm entryId={e.id} />}
      </section>
    </div>
  );
}
