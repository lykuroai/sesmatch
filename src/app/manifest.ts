import type { MetadataRoute } from "next";

// PWA マニフェスト（スマホのホーム画面追加に対応）
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SES DirectMatch",
    short_name: "DirectMatch",
    description: "企業間SES案件・人材マッチング 企業コンソール",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
