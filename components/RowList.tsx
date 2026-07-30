"use client";

import { useEffect, useRef, useState } from "react";
import { useShell } from "./ShellContext";

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true;
}

// Keyboard-first list: J/K move, Enter/E open, ⌘⇧A archives the focused row.
// Lifecycle treatment (v2.2): draft = dashed/italic, archived = muted.
export default function RowList<T>({
  rows,
  rowKey,
  status,
  render,
  onOpen,
  onArchive,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  status: (row: T) => string;
  render: (row: T) => React.ReactNode;
  onOpen: (row: T) => void;
  onArchive?: (row: T) => void;
}) {
  const { helpOpen } = useShell();
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (sel >= rows.length) setSel(Math.max(0, rows.length - 1));
  }, [rows.length, sel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (helpOpen || rows.length === 0) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "a" && onArchive) {
        e.preventDefault();
        if (rows[sel]) onArchive(rows[sel]);
        return;
      }
      if (isEditableTarget(e) || meta || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "j") {
        e.preventDefault();
        setSel((s) => Math.min(rows.length - 1, s + 1));
      } else if (key === "k") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      } else if (key === "enter" || key === "e" || key === "o") {
        e.preventDefault();
        if (rows[sel]) onOpen(rows[sel]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel, helpOpen, onOpen, onArchive]);

  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <ul ref={listRef} className="panel divide-y divide-ink-700/70">
      {rows.map((row, i) => {
        const s = status(row);
        return (
          <li key={rowKey(row)} className={s === "archived" ? "row-archived" : ""}>
            <button
              onClick={() => {
                setSel(i);
                onOpen(row);
              }}
              className={`block w-full px-4 py-2.5 text-left transition-colors ${
                s === "draft" ? "border-l-2 border-dashed border-l-signal-amber/50 italic" : "border-l-2 border-l-transparent"
              } ${i === sel ? "bg-ink-800" : "hover:bg-ink-800/40"}`}
            >
              {render(row)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
