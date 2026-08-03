import Link from "next/link";
import { LIST_PAGE_SIZE } from "@/lib/constants";

// 一覧共通のページネーション（50件/ページ、?page=N 方式）
const PAGE_SIZE = LIST_PAGE_SIZE;

export function Pager({
  total,
  page,
  basePath,
  params = {},
}: {
  total: number;
  page: number; // 1始まり
  basePath: string;
  params?: Record<string, string | undefined>; // page 以外の検索条件（リンクに引き継ぐ）
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const to = Math.min(current * PAGE_SIZE, total);

  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const btn = "rounded border px-3 py-1 text-sm";
  const enabled = `${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const disabled = `${btn} border-slate-200 bg-slate-50 text-slate-300 pointer-events-none`;

  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
      <span>
        全{total.toLocaleString()}件中 {from.toLocaleString()}〜{to.toLocaleString()}件
      </span>
      {totalPages > 1 && (
        <span className="flex items-center gap-2">
          <Link href={href(current - 1)} className={current <= 1 ? disabled : enabled}>
            前へ
          </Link>
          <span>
            {current} / {totalPages}
          </span>
          <Link href={href(current + 1)} className={current >= totalPages ? disabled : enabled}>
            次へ
          </Link>
        </span>
      )}
    </div>
  );
}

// searchParams の page を 1 始まりの整数に正規化
export function parsePage(v: string | undefined): number {
  const n = parseInt(v ?? "1");
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// 配列をページ分割する（DBレベルで分割しない小規模一覧用）
export function slicePage<T>(items: T[], page: number): T[] {
  return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}
