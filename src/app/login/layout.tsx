import type { Metadata } from "next";

// ログイン + LPページのSEOメタデータ（page.tsx はクライアントコンポーネントのためここで定義）
// タイトル・descriptionはサイト既定値（ルートレイアウト）を継承する
export const metadata: Metadata = {
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
