"use client";

// 案件・人材画面に埋め込む取込パネル（§9）。ボタンで開閉し、貼り付け/ファイルの両方に対応。
// 取込後の人手確認・確定は /ingestions（取込履歴）で行う
import { useState } from "react";
import Link from "next/link";
import { IngestPaste } from "./IngestPaste";
import { IngestUpload } from "./IngestUpload";

export function IngestPanel({
  label,
  hint,
  note,
  title,
  action,
  expectedKind,
}: {
  label: string;
  hint: string;
  note?: string; // 取込の注意書き（複数案件の分割の制限など）
  title?: string; // 指定時は画面見出し行ごと描画し、取込ボタンを action と同じ行に並べる
  action?: React.ReactNode; // 「案件を登録」等の主ボタン
  // 取込の期待種別（案件画面=PROJECT_DESCRIPTION / 人材画面=ENGINEER_SHEET）。
  // サーバー側でAI判定結果と突き合わせ、不一致の書類は取り込まない
  expectedKind: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION";
}) {
  const [open, setOpen] = useState(false);
  const toggle = (
    <button
      onClick={() => setOpen(!open)}
      className="rounded border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50"
    >
      {open ? "取込を閉じる" : label}
    </button>
  );
  return (
    <div className="mb-6">
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">{title}</h1>
          <div className="flex items-center gap-2">
            {toggle}
            {action}
          </div>
        </div>
      ) : (
        toggle
      )}
      {open && (
        <div className="mt-3 space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">
            {hint}
            PII匿名化 → AI正規化 → 人手確認を経て登録されます。この取込では
            {expectedKind === "PROJECT_DESCRIPTION" ? "案件" : "人材"}
            のみを受け付け、異なる種別と判定された書類は取り込まれません（取込履歴にエラーとして記録されます）。
          </p>
          {note && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              {note}
            </div>
          )}
          <div>
            <h3 className="mb-2 text-sm font-bold">テキスト貼り付け</h3>
            <IngestPaste expectedKind={expectedKind} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold">ファイル取込</h3>
            <IngestUpload expectedKind={expectedKind} />
          </div>
          <p className="text-xs text-slate-500">
            取込後の確認・確定は{" "}
            <Link href="/ingestions" className="text-blue-600 hover:underline">
              取込履歴
            </Link>{" "}
            から行えます。
          </p>
        </div>
      )}
    </div>
  );
}
