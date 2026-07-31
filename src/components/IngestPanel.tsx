"use client";

// 案件・人材画面に埋め込む取込パネル（§9）。ボタンで開閉し、貼り付け/ファイルの両方に対応。
// 取込後の人手確認・確定は /ingestions（取込履歴）で行う
import { useState } from "react";
import Link from "next/link";
import { IngestPaste } from "./IngestPaste";
import { IngestUpload } from "./IngestUpload";

export function IngestPanel({ label, hint }: { label: string; hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="rounded border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50"
      >
        {open ? "取込を閉じる" : label}
      </button>
      {open && (
        <div className="mt-3 space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">
            {hint}
            PII匿名化 → AI正規化 → 人手確認を経て登録されます（種別は自動判定）。
          </p>
          <div>
            <h3 className="mb-2 text-sm font-bold">テキスト貼り付け</h3>
            <IngestPaste />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold">ファイル取込</h3>
            <IngestUpload />
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
