import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { LogoutButton } from "@/components/LogoutButton";
import { ResizableSidebar } from "@/components/ResizableSidebar";

// 企業専用コンソール（§8）: ログイン後、所属企業コンソールを自動表示
// アイコンは自己完結のインラインSVG（heroicons outline 相当のパス）
const MENU: { href: string; label: string; icon: string }[] = [
  {
    href: "/",
    label: "ホーム",
    icon: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75",
  },
  {
    href: "/projects",
    label: "案件",
    icon: "M20.25 14.15v4.073c0 1.313-.936 2.44-2.235 2.63-1.933.284-3.916.43-5.933.43-2.017 0-4-.146-5.933-.43-1.299-.19-2.235-1.318-2.235-2.63V14.15M18 18.75h-.008v.008H18v-.008zM3.75 9.776c.53-.16 1.09-.276 1.67-.34m0 0A24.301 24.301 0 0112 9c2.291 0 4.545.16 6.75.47m-13.5 0c1.01-.143 2.02-.257 3.03-.34m10.47.34V6.75c0-1.243-1.007-2.25-2.25-2.25H9c-1.243 0-2.25 1.007-2.25 2.25v2.126m10.5 0a24.301 24.301 0 013.03.34",
  },
  {
    href: "/engineers",
    label: "人材",
    icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  },
  {
    href: "/ingestions",
    label: "取込履歴",
    icon: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
  },
  {
    href: "/entries",
    label: "商談管理",
    icon: "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155",
  },
  {
    href: "/contracts",
    label: "成約・稼働",
    icon: "M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z",
  },
  {
    href: "/billing",
    label: "成約手数料",
    icon: "M9 7.5l3 4.5m0 0l3-4.5M12 12v5.25M15 12H9m6 3H9m12-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
];

// 操作マニュアルは画面最下部（ログアウトの上）に固定表示する
const MANUAL_ITEM = {
  href: "/manual",
  label: "操作マニュアル",
  icon: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25",
};

// メニュー項目の共通描画（アイコン＋ラベル）
function MenuLink({ item }: { item: { href: string; label: string; icon: string } }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-2.5 rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px] flex-none text-slate-400"
      >
        <path d={item.icon} />
      </svg>
      <span>{item.label}</span>
    </Link>
  );
}
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
          <div className="flex h-full min-h-full flex-col">
            <nav className="p-2">
              {MENU.map((m) => (
                <MenuLink key={m.href} item={m} />
              ))}
            </nav>
            {/* 画面最下部に操作マニュアルとログアウトを固定 */}
            <div className="mt-auto p-2">
              <div className="border-t border-slate-100 pt-2">
                <MenuLink item={MANUAL_ITEM} />
              </div>
            </div>
            <div className="px-4 pb-4">
              <LogoutButton />
            </div>
          </div>
        </ResizableSidebar>
        <main className="min-w-0 flex-1 p-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
