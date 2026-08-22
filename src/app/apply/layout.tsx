import type { Metadata } from "next";

// 企業申込ページのSEOメタデータ（page.tsx はクライアントコンポーネントのためここで定義）
export const metadata: Metadata = {
  title: "企業登録の申込",
  description:
    "SES DirectMatchの企業登録申込ページ。法人・個人事業者のSES企業が対象で、基本版は完全無料（掲載料・月額費用・成約手数料0円）。案件票・スキルシートの取込とAIマッチングをすぐに利用できます。",
  alternates: { canonical: "/apply" },
  openGraph: { title: "企業登録の申込" },
};

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
