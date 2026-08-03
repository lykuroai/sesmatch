import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { LogoutButton } from "@/components/LogoutButton";
import { ResizableSidebar } from "@/components/ResizableSidebar";

// 企業専用コンソール（§8）: ログイン後、所属企業コンソールを自動表示
const MENU = [
  { href: "/", label: "ホーム" },
  { href: "/projects", label: "案件" },
  { href: "/engineers", label: "人材" },
  { href: "/ingestions", label: "取込履歴" },
  { href: "/entries", label: "エントリー" },
  { href: "/contracts", label: "契約・稼働" },
  { href: "/billing", label: "請求" },
  { href: "/privacy", label: "プライバシー" },
  { href: "/relationships", label: "企業間関係" },
  { href: "/reports", label: "通報" },
  { href: "/settings/members", label: "担当者" },
  { href: "/settings/company", label: "企業情報" },
  { href: "/audit", label: "監査" },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 print:hidden">
        <Link href="/" className="text-sm font-bold text-slate-800">
          Ai-SESマッチング
        </Link>
        <p className="text-sm text-slate-700">
          <span className="font-bold">{auth.companyName}</span>
          <span className="ml-3 text-slate-500">{auth.userName}</span>
        </p>
      </header>
      <div className="flex flex-1">
        <ResizableSidebar>
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
        </ResizableSidebar>
        <main className="min-w-0 flex-1 p-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
