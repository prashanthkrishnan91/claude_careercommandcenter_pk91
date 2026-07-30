"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import Modal from "./Modal";
import { QUICKLOG_EVENT, ShellContext, type ShellApi } from "./ShellContext";
import ShortcutHelp from "./ShortcutHelp";

// One coherent command center: restrained rail, module per operating concern.
const NAV = [
  { href: "/home", label: "Home", glyph: "◇" },
  { href: "/vault", label: "Vault", glyph: "▤" },
  { href: "/pipeline", label: "Pipeline", glyph: "▷" },
  { href: "/intelligence", label: "Intelligence", glyph: "◎" },
  { href: "/rhythm", label: "Rhythm", glyph: "↻" },
  { href: "/career", label: "Career", glyph: "⇗" },
  { href: "/decisions", label: "Decisions", glyph: "⚖" },
  { href: "/development", label: "Development", glyph: "△" },
  { href: "/settings", label: "Settings", glyph: "⚙" },
] as const;

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    router.replace("/login");
  }, [router]);

  const requestQuickLog = useCallback(() => {
    const handled = window.dispatchEvent(new CustomEvent(QUICKLOG_EVENT, { cancelable: true }));
    // No Quick Log surface mounted on this page → go to the Vault and focus it.
    if (handled) router.push("/vault?ql=1");
  }, [router]);

  // Global keys: N / Cmd+N → Quick Log in context; ? → help.
  // Cmd+Enter (promote) and Cmd+Shift+A (archive) are handled by the pages
  // that own the focused record.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (helpOpen) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        requestQuickLog();
        return;
      }
      if (isEditableTarget(e) || meta || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        requestQuickLog();
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, requestQuickLog]);

  const api = useMemo<ShellApi>(
    () => ({
      version,
      bump,
      helpOpen,
      openHelp: () => setHelpOpen(true),
      closeHelp: () => setHelpOpen(false),
      requestQuickLog,
      signOut,
    }),
    [version, bump, helpOpen, requestQuickLog, signOut],
  );

  return (
    <ShellContext.Provider value={api}>
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-52 flex-col border-r border-ink-700 bg-ink-900 md:flex">
          <div className="px-4 pb-3 pt-5">
            <div className="microlabel">career</div>
            <div className="font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-dim-100">
              Command
              <br />
              Center
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-2">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`mb-0.5 flex items-center gap-2.5 rounded-sm border-l-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? "border-signal-blue bg-signal-blue/5 text-dim-100"
                      : "border-transparent text-dim-400 hover:bg-ink-800 hover:text-dim-200"
                  }`}
                >
                  <span aria-hidden className={active ? "text-signal-blue" : "text-dim-500"}>
                    {item.glyph}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="space-y-2 border-t border-ink-700 p-3">
            <button onClick={requestQuickLog} className="btn-primary w-full justify-center py-2">
              Quick log <span className="ml-1 opacity-70"><kbd>N</kbd></span>
            </button>
            <div className="flex items-center justify-between px-1">
              <button onClick={() => setHelpOpen(true)} className="btn-quiet">
                <kbd>?</kbd> keys
              </button>
              <button onClick={() => void signOut()} className="btn-quiet hover:text-signal-red">
                sign out
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-20 md:ml-52 md:pb-0">{children}</div>

        {/* Mobile: capture-first bottom bar (v2.2 §5). */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-ink-600 bg-ink-900/95 backdrop-blur md:hidden">
          {[NAV[1], NAV[2]].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
                pathname.startsWith(item.href) ? "text-signal-blue" : "text-dim-400"
              }`}
            >
              <span className="text-base leading-none" aria-hidden>{item.glyph}</span>
              {item.label}
            </Link>
          ))}
          <button
            onClick={requestQuickLog}
            aria-label="Quick log achievement"
            className="-mt-4 mx-1 flex h-12 w-12 items-center justify-center self-center rounded-full border border-signal-blue/60 bg-ink-800 text-xl text-signal-blue"
          >
            +
          </button>
          {[NAV[0], NAV[8]].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
                pathname.startsWith(item.href) ? "text-signal-blue" : "text-dim-400"
              }`}
            >
              <span className="text-base leading-none" aria-hidden>{item.glyph}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {helpOpen && (
        <Modal title="Keyboard" onClose={() => setHelpOpen(false)}>
          <ShortcutHelp />
        </Modal>
      )}
    </ShellContext.Provider>
  );
}
