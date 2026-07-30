import { defineConfig } from "vitest/config";
import path from "path";

// 統合テスト（§34）: 専用DB sesmatch_test に対して実行する
// 実行: npm run test:integration
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false, // DBを共有するため直列実行
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 設定ファイル側でもテストDBを強制し、開発DBへの誤接続を防ぐ
    env: {
      DATABASE_URL: "postgresql://sesmatch:sesmatch@localhost:5433/sesmatch_test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
