import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// 公開ページのみ掲載する（コンソール・管理画面は認証必須のため除外）
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: { path: string; priority: number }[] = [
    { path: "/login", priority: 1.0 },
    { path: "/about", priority: 0.9 },
    { path: "/apply", priority: 0.9 },
    { path: "/terms", priority: 0.3 },
    { path: "/agreement", priority: 0.3 },
    { path: "/privacy-policy", priority: 0.3 },
  ];
  return pages.map((p) => ({
    url: `${SITE_URL}${p.path}`,
    changeFrequency: "monthly",
    priority: p.priority,
  }));
}
