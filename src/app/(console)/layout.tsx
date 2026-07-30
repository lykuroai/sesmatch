import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { ROLE_LABELS } from "@/lib/constants";
import { LogoutButton } from "@/components/LogoutButton";

// 企業専用コンソール（§8）: ログイン後、所属企業コンソールを自動表示
const MENU = [
  { href: "/", label: "ホーム" },
  { href: "/projects", label: "案件" },
  { href: "/engineers", label: "人材" },
  { href: "/entries", label: "エントリー" },
  { href: "/contracts", label: "契約・稼働" },
  { href: "/billing", label: "請求" },
  { href: "/ingestions", label: "取込" },
  { href: "/privacy", label: "プライバシー" },
  { href: "/relationships", label: "企業間関係" },
  { href: "/reports", label: "通報" },
  { href: "/settings/members", label: "担当者" },
  { href: "/audit", label: "監査" },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <p className="text-sm font-bold">{auth.companyName}</p>
          <p className="mt-1 text-xs text-slate-500">{auth.userName}</p>
          <p className="mt-1 text-xs text-slate-400">
            {auth.roles.map((r) => ROLE_LABELS[r] ?? r).join(" / ")}
          </p>
        </div>
        <nav className="p-2">
          {MENU.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="block rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              {m.label}
            </Link>
          ))}
        </nav>
        <div className="p-4">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
