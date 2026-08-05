import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { hasPermission } from "@/server/auth/rbac";
import { getContract } from "@/server/services/contracts";
import { CONTRACT_STATUS_LABELS, FEE_STATUS_LABELS } from "@/lib/constants";
import { ActionButton } from "@/components/ActionButton";
import { WorkControls } from "@/components/WorkControls";
import { ContractEditForm } from "@/components/ContractEditForm";

const CHECKLIST_LABELS: Record<string, string> = {
  instructionManager: "業務指示責任者・経路",
  attendanceManager: "勤怠・休暇管理主体",
  assignmentDecider: "配置決定主体",
  acceptanceMethod: "成果・役務の検収方法",
  resubcontractApproval: "再委託承認",
};

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { id } = await params;
  const c = await getContract(auth, id);
  if (!c) notFound();

  const canSign = hasPermission(auth.roles, "contract.sign");
  const mySigned = c.side === "DEMAND" ? c.demandSigned : c.supplySigned;
  const preExecuted = ["DRAFT", "SIGNED_SUPPLY", "SIGNED_DEMAND"].includes(c.status);
  const signable = canSign && !mySigned && preExecuted;
  // 署名完了（成約）前は契約担当が内容を修正できる。修正すると既存署名は取り消される（§22）
  const editable = hasPermission(auth.roles, "contract.create") && preExecuted;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">個別契約 {c.projectCode} × {c.engineerCode}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {CONTRACT_STATUS_LABELS[c.status]} ／ 自社の立場: {c.side === "DEMAND" ? "需要側（手数料負担 §23）" : "供給側"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            供給側署名: {c.supplySigned ? "✓" : "未"} ／ 需要側署名: {c.demandSigned ? "✓" : "未"}
            ／ 第{c.version}版（最終更新: {new Date(c.updatedAt).toLocaleString("ja-JP")}）
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {signable && (
            <ActionButton
              path={`/api/v1/contracts/${c.id}/sign`}
              body={{ version: c.version }}
              label="署名する"
              confirmMessage={`第${c.version}版の契約内容に署名しますか？双方の署名が揃った時点で成約となります。相手方が内容を修正していた場合、署名は拒否されます。`}
            />
          )}
          {canSign && <WorkControls contract={{ id: c.id, status: c.status, workStartedAt: c.workStartedAt != null }} />}
        </div>
      </div>

      {editable && (
        <div className="mb-6">
          <ContractEditForm
            contractId={c.id}
            initial={{
              contractType: c.contractType,
              monthlyRateYen: c.monthlyRateYen,
              startDate: new Date(c.startDate).toISOString().slice(0, 10),
              endDate: c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : null,
              commandChecklist: c.commandChecklist,
              notes: c.notes,
              anySigned: c.supplySigned || c.demandSigned,
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">契約条件（Level 3）</h2>
          <dl className="space-y-2 text-sm">
            <Row label="案件保有企業（需要側）" value={c.demandCompanyName} />
            <Row label="人材所属企業（供給側）" value={c.supplyCompanyName} />
            <Row label="人材" value={`${c.engineerCode} ${c.engineerName}`} />
            <Row label="契約形態" value={c.contractType} />
            <Row label="月額契約金額（税抜）" value={`${c.monthlyRateYen.toLocaleString()}円`} />
            <Row label="契約期間" value={`${new Date(c.startDate).toLocaleDateString("ja-JP")} 〜 ${c.endDate ? new Date(c.endDate).toLocaleDateString("ja-JP") : "（更新制）"}`} />
            <Row label="実稼働開始日" value={c.workStartedAt ? new Date(c.workStartedAt).toLocaleDateString("ja-JP") : "未開始"} />
            {c.terminatedAt && <Row label="終了日" value={new Date(c.terminatedAt).toLocaleDateString("ja-JP")} />}
          </dl>
          {c.notes && (
            <div className="mt-3 rounded bg-slate-50 p-3">
              <p className="mb-1 text-xs font-medium text-slate-600">備考</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{c.notes}</p>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">
            エントリー: <Link href={`/entries/${c.entryId}`} className="text-blue-600 hover:underline">詳細を見る</Link>
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold">指揮命令・検収の確認（§22）</h2>
          <dl className="space-y-2 text-sm">
            {Object.entries(CHECKLIST_LABELS).map(([key, label]) => (
              <Row key={key} label={label} value={c.commandChecklist[key] ?? "-"} />
            ))}
          </dl>
          <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-500">
            準委任・請負では案件保有企業から本人への直接指揮命令を禁止します（§22）。
          </p>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* 手数料は需要側企業の負担（§23）のため、供給側には金額・状態を表示しない */}
        <h2 className="mb-1 font-bold">{c.side === "DEMAND" ? "月次稼働・手数料（§23）" : "月次稼働"}</h2>
        {c.side === "DEMAND" && (
          <p className="mb-4 text-xs text-slate-500">
            手数料 = 確定契約金額の3%（切り捨て）。実稼働開始から最大12稼働月、13稼働月目以降は無料。
            稼働前キャンセルは0円、開始後14日以内の離脱は全額返金。
          </p>
        )}
        <table className="mb-4 w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-2">対象月</th>
              <th className="py-2">確定契約金額</th>
              {c.side === "DEMAND" && (
                <>
                  <th className="py-2">手数料（税抜）</th>
                  <th className="py-2">稼働月</th>
                  <th className="py-2">状態</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {c.workMonths.map((wm) => (
              <tr key={wm.id} className="border-t border-slate-100">
                <td className="py-2 font-medium">{wm.month}</td>
                <td className="py-2">{wm.confirmedAmountYen.toLocaleString()}円</td>
                {c.side === "DEMAND" && (
                  <>
                    <td className="py-2">{wm.fee ? `${wm.fee.feeExTaxYen.toLocaleString()}円` : "-"}</td>
                    <td className="py-2">{wm.fee ? `${wm.fee.chargeableMonthIndex}稼働月目` : "-"}</td>
                    <td className="py-2 text-xs">{wm.fee ? FEE_STATUS_LABELS[wm.fee.status] : "-"}</td>
                  </>
                )}
              </tr>
            ))}
            {c.workMonths.length === 0 && (
              <tr>
                <td colSpan={c.side === "DEMAND" ? 5 : 2} className="py-4 text-center text-slate-400">
                  月次稼働はまだありません（稼働開始後に自動計算されます）
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {c.side === "DEMAND" && c.status === "ACTIVE" && (
          <p className="text-xs text-slate-400">
            月次稼働と手数料は、稼働開始月から当月分まで月額契約金額をもとに自動計算されます。
          </p>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
