"use client";

// ブラウザの印刷ダイアログを開く（PDF保存にも使える）
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 print:hidden"
    >
      印刷 / PDF保存
    </button>
  );
}
