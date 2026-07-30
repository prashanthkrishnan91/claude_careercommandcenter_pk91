"use client";

import { createContext, useContext } from "react";

export interface ShellApi {
  /** Bumps after any mutation; pages reload on change. */
  version: number;
  bump(): void;
  helpOpen: boolean;
  openHelp(): void;
  closeHelp(): void;
  /** N / Cmd+N: focus the nearest Quick Log surface (event-based). */
  requestQuickLog(): void;
  signOut(): Promise<void>;
}

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside AppShell");
  return ctx;
}

export const QUICKLOG_EVENT = "ccc:quicklog";
