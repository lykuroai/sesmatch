// エントリー状態遷移の純粋ロジック（§20.2）
// DB 非依存でテスト可能にする。承認の永続化・開示レコード作成は services 側で
// 同一トランザクションにて行う（§20.3）。

export type Side = "SUPPLY" | "DEMAND";

export type EntryStateInput = {
  status: string;
  supplyApprovedAt: Date | null;
  demandApprovedAt: Date | null;
  demandCompanyId: string;
  supplyCompanyId: string;
};

// 閲覧企業がどちらの立場か（§6.3: 需要側・供給側は取引ごとに決定）
export function sideOf(entry: EntryStateInput, companyId: string): Side | null {
  if (entry.demandCompanyId === companyId) return "DEMAND";
  if (entry.supplyCompanyId === companyId) return "SUPPLY";
  return null;
}

const APPROVABLE_STATUSES = ["SUBMITTED", "SUPPLY_APPROVED", "DEMAND_APPROVED"];

export type ApprovalResult =
  | { ok: true; nextStatus: "SUPPLY_APPROVED" | "DEMAND_APPROVED" | "MUTUALLY_APPROVED"; mutual: boolean }
  | { ok: false; error: "NOT_APPROVABLE" | "ALREADY_APPROVED" };

// 承認を適用した場合の遷移先を返す。mutual=true のとき呼び出し側は
// 同一トランザクションで Level 2 開示レコードを作成しなければならない（§20.3）。
export function applyApproval(entry: EntryStateInput, side: Side): ApprovalResult {
  if (!APPROVABLE_STATUSES.includes(entry.status)) return { ok: false, error: "NOT_APPROVABLE" };
  const already = side === "SUPPLY" ? entry.supplyApprovedAt : entry.demandApprovedAt;
  if (already) return { ok: false, error: "ALREADY_APPROVED" };
  const other = side === "SUPPLY" ? entry.demandApprovedAt : entry.supplyApprovedAt;
  if (other) return { ok: true, nextStatus: "MUTUALLY_APPROVED", mutual: true };
  return {
    ok: true,
    nextStatus: side === "SUPPLY" ? "SUPPLY_APPROVED" : "DEMAND_APPROVED",
    mutual: false,
  };
}

// 見送り（相手側）・辞退（申請側）が可能な状態
export function canDecline(status: string): boolean {
  return [...APPROVABLE_STATUSES, "MUTUALLY_APPROVED", "INTERVIEW", "CONDITIONS", "ON_HOLD"].includes(status);
}

// 面談は双方承認後のみ（§20.2）
export function canScheduleInterview(status: string): boolean {
  return ["MUTUALLY_APPROVED", "INTERVIEW"].includes(status);
}

// 条件調整への遷移は面談後
export function canMoveToConditions(status: string): boolean {
  return status === "INTERVIEW";
}

// Level 2 開示済みか（開示レコードの有無で判定するのが正だが、状態でも制約する）
export function isDisclosedStatus(status: string): boolean {
  return ["MUTUALLY_APPROVED", "INTERVIEW", "CONDITIONS", "CONTRACTING", "CONTRACTED"].includes(status);
}
