"use client";

import { useEffect, useRef } from "react";

// Base modal: Esc closes, Cmd/Ctrl+Enter submits (wired by forms via the
// onSubmitShortcut prop), click-outside closes, focus lands inside.
export default function Modal({
  title,
  subtitle,
  onClose,
  onSubmitShortcut,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmitShortcut?: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmitShortcut) {
        e.preventDefault();
        onSubmitShortcut();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onSubmitShortcut]);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(
      "input, textarea, select, button",
    );
    first?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-8 backdrop-blur-[2px] sm:py-16"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={ref}
        className={`panel w-full ${wide ? "max-w-2xl" : "max-w-lg"} border-ink-600 bg-ink-900 shadow-[0_20px_60px_rgba(0,0,0,0.6)]`}
      >
        <header className="hairline-b flex items-baseline justify-between px-5 py-3">
          <div>
            <h2 className="font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-dim-100">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-dim-500">{subtitle}</p>}
          </div>
          <span className="hidden items-center gap-2 sm:flex">
            <kbd>esc</kbd>
            <span className="text-[10px] text-dim-500">close</span>
          </span>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
