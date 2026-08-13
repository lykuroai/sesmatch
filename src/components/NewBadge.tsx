// 新着印（登録から24時間以内 §8.1）: 小さな赤丸アイコンで表示する
export function NewBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="新着（24時間以内）"
      aria-label="新着"
      className={`inline-block h-2 w-2 shrink-0 rounded-full bg-rose-500 align-middle ${className}`}
    />
  );
}
