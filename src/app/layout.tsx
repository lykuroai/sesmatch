import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lykuro DirectMatch — AI人材・案件ダイレクトマッチング",
  description: "企業間SES案件・人材マッチング 企業コンソール",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
