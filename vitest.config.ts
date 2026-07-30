import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws by design outside a Next server context. The
      // guard stays real in the app build (an accidental client import is a
      // build error); here it resolves to a no-op so the server modules under
      // test can be imported directly.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
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
