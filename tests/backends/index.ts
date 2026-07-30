import type { TestBackend } from "./types";
import { createPgliteBackend } from "./pglite";

export type { TestBackend, TestUserCtx } from "./types";

export async function createBackend(): Promise<TestBackend> {
  if (process.env.TEST_LIVE === "1") {
    const { createLiveBackend } = await import("./live");
    return createLiveBackend();
  }
  return createPgliteBackend();
}
