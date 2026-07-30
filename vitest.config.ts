import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // CRUD integration tests share two live test accounts; run files serially
    // so cleanup in one file can't race creates in another.
    fileParallelism: false,
  },
});
