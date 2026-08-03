import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Docker デプロイ用（自己完結の server.js を生成）
  // pdf-parse / mammoth / xlsx はバンドルすると実行時エラーになるためサーバー外部依存として扱う
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pdf-parse", "mammoth", "xlsx"],
};

export default nextConfig;
