import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { prisma } from "@/server/db";

// 会社マイページ: 企業に関する管理機能の入口（ヘッダー右の会社名から遷移）
const SECTIONS = [
  { href: "/settings/company", label: "企業情報", desc: "企業名・事業者種別・法人番号の確認と修正" },
  { href: "/settings/members", label: "担当者", desc: "担当者の招待・ロール変更・停止" },
  { href: "/settings/api-tokens", label: "APIトークン", desc: "ローカルサーバ等の外部連携用トークンの発行・失効" },
  { href: "/reports", label: "通報", desc: "再転載・無承認再仲介などの通報" },
  { href: "/audit", label: "監査", desc: "監査ログの閲覧" },
  { href: "/privacy", label: "プライバシー", desc: "本人からの訂正・削除請求の受付と処理" },
  { href: "/relationships", label: "企業間関係", desc: "取引先・一社下・営業委任の関係管理" },
];

export default async function CompanyMyPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const [company, memberCount] = await Promise.all([
    prisma.company.findUnique({ where: { id: auth.companyId } }),
    prisma.companyMember.count({ where: { companyId: auth.companyId, status: "ACTIVE" } }),
  ]);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">{company?.name ?? auth.companyName}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {company?.companyType === "CORPORATION" ? "法人" : "個人事業主"}
        {company?.corporateNumber && ` ／ 法人番号 ${company.corporateNumber}`}
        {company?.address && ` ／ ${company.address}`}
        {` ／ 担当者 ${memberCount}名`}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50 hover:shadow"
          >
            <p className="font-bold">{s.label}</p>
            <p className="mt-1 text-xs text-slate-500">{s.desc}</p>
          </Link>
        ))}
      </div>

      {/* SES-Connector（ローカルサーバ）の紹介（local_server_spec_v0_1.md §9） */}
      <div className="mt-8 rounded-xl border border-blue-200 bg-blue-50 p-6">
        <h2 className="text-lg font-bold text-blue-900">
          SES-Connector（ローカルサーバ）— 案件・人材を自社に置いたまま商談へ
        </h2>
        <p className="mt-2 text-sm text-blue-900">
          案件票・スキルシートを<span className="font-bold">自社のPC・サーバに保管したまま</span>
          管理できる無料のオープンソースツールです。プラットフォームに預けるのは商談に出す分だけ。
          データ主権を自社に残しながら、商談のチャンスは逃しません。
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-blue-900">
          <li>
            <span className="font-bold">データは自社に残る</span> —
            書類の取込・AI解析・在庫管理はすべて自社環境内。解析は自社契約のLLM（社内LLMも可）で行い、外部送信前に匿名化します
          </li>
          <li>
            <span className="font-bold">商談に出す分だけ公開送信</span> —
            在庫から選んだ1件を、内容確認のうえプラットフォームへ登録・公開できます
          </li>
          <li>
            <span className="font-bold">ローカル画面から相手探しまで</span> —
            公開案件・公開人材の検索、自社在庫とのマッチ度表示、人材提案・案件紹介（商談の申込み）まで行えます
          </li>
        </ul>
        <div className="mt-4 rounded-lg border border-blue-200 bg-white p-4 text-sm">
          <p className="font-bold">導入方法（約5分）</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
            <li>
              Node.js 20以上（
              <a href="https://nodejs.org/ja" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                nodejs.org
              </a>
              のLTS版）をインストール
            </li>
            <li>
              Windows:{" "}
              <a
                href="https://raw.githubusercontent.com/lykuroai/lykuro-connector/main/install.bat"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 underline"
              >
                install.bat
              </a>
              {" "}を「名前を付けて保存」でダウンロードして実行 ／ Mac・Linux:{" "}
              <code className="rounded bg-slate-100 px-1">
                curl -fsSL https://raw.githubusercontent.com/lykuroai/lykuro-connector/main/install.sh | bash
              </code>
            </li>
            <li>
              <Link href="/settings/api-tokens" className="text-blue-700 underline">
                APIトークン
              </Link>
              をスコープ「ローカルサーバ連携」で発行し、設定ファイル（config.json）に貼り付け（自社LLMのAPI設定も同じファイルに記入）
            </li>
            <li>start.bat（Mac・Linux は npm start）で起動し、ブラウザで http://127.0.0.1:8787 を開く</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            ソースコード・詳細:{" "}
            <a
              href="https://github.com/lykuroai/lykuro-connector"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline"
            >
              github.com/lykuroai/lykuro-connector
            </a>
            （MITライセンス）。更新はインストーラの再実行、起動し直しで反映されます。
          </p>
        </div>
      </div>
    </div>
  );
}
