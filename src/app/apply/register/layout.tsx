import type { Metadata } from "next";

// 登録用URL（トークン付き）から開く第2段階の画面。検索エンジンには載せない
export const metadata: Metadata = {
  title: "企業登録",
  robots: { index: false, follow: false },
};

export default function ApplyRegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
