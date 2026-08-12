import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Docker デプロイ用（自己完結の server.js を生成）
  // pdf-parse / mammoth / xlsx はバンドルすると実行時エラーになるためサーバー外部依存として扱う
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pdf-parse", "mammoth", "xlsx", "word-extractor"],
  // 注: pdf-parse が DOMMatrix 等のポリフィルに使う @napi-rs/canvas はオプション依存のため
  // standalone のトレースに含まれない（"DOMMatrix is not defined"）。Dockerfile で明示的にコピーしている
};

export default nextConfig;
