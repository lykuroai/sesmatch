import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SES DirectMatch — AI人材・案件ダイレクトマッチング",
  description: "企業間SES案件・人材マッチング 企業コンソール",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "DirectMatch", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
