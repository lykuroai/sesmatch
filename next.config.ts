import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Docker デプロイ用（自己完結の server.js を生成）
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;
