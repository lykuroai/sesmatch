import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// 認証必須のコンソール・管理画面・APIはクロール対象外にする
// （"/privacy$" の $ は完全一致指定。公開ページの /privacy-policy は除外しない）
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: [
        "/api/",
        "/admin",
        "/audit",
        "/billing",
        "/company",
        "/contracts",
        "/engineers",
        "/entries",
        "/ingestions",
        "/manual",
        "/privacy$",
        "/projects",
        "/relationships",
        "/reports",
        "/settings",
        "/support",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
