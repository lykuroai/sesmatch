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
  { href: "/contracts", label: "成約・稼働" },
  { href: "/billing", label: "成約手数料" },
];
// 企業情報・担当者・通報・監査・プライバシー・企業間関係は
// 会社マイページ（/company、ヘッダー右の会社名から）に集約

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 print:hidden">
        <Link href="/" className="flex items-center gap-2 text-sm font-bold text-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" className="h-6 w-6" />
          SES DirectMatch
        </Link>
        <p className="text-sm text-slate-700">
          <Link href="/company" className="font-bold hover:underline" title="会社マイページ">
            {auth.companyName}
          </Link>
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
