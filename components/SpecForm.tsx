"use client";

import { useState } from "react";
import {
  InlineDate,
  InlineNumber,
  InlineSelect,
  InlineTags,
  InlineText,
  InlineToggle,
} from "./InlineField";

// Spec-driven forms keep the long tail of entities (companies, contacts,
// offers, skills, references, …) on the same low-friction cockpit behavior:
// a collapsible inline add-panel, and inline click-to-edit with autosave —
// no generic "Edit mode" anywhere.

export interface FieldSpec {
  key: string;
  label: string;
  kind: "text" | "textarea" | "date" | "select" | "number" | "toggle" | "tags";
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
  mono?: boolean;
  /** columns to span in the grid (1 or 2); default 1 */
  span?: 1 | 2;
}

export function SpecAddForm({
  title,
  specs,
  onCreate,
  submitLabel,
}: {
  title: string;
  specs: FieldSpec[];
  onCreate: (values: Record<string, unknown>) => Promise<void>;
  submitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        + {title}
      </button>
    );
  }

  async function submit() {
    for (const s of specs) {
      if (s.required && !String(values[s.key] ?? "").trim()) {
        setError(`${s.label} is required.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(values);
      setValues({});
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  const input = "field-input";
  return (
    <div className="panel border-signal-blue/25 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="microlabel text-signal-blue/80">{title}</span>
        <button className="btn-quiet" onClick={() => setOpen(false)}>cancel · esc</button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {specs.map((s) => (
          <div key={s.key} className={s.span === 2 ? "sm:col-span-2" : ""}>
            <span className="field-label">{s.label}{s.required ? " *" : ""}</span>
            {s.kind === "textarea" ? (
              <textarea className={`${input} min-h-[64px]`} placeholder={s.placeholder} value={String(values[s.key] ?? "")} onChange={(e) => set(s.key, e.target.value)} />
            ) : s.kind === "select" ? (
              <select className={`${input} font-mono text-[12px]`} value={String(values[s.key] ?? "")} onChange={(e) => set(s.key, e.target.value)}>
                <option value="">—</option>
                {(s.options ?? []).map((o) => (
                  <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                ))}
              </select>
            ) : s.kind === "date" ? (
              <input type="date" className={input} value={String(values[s.key] ?? "")} onChange={(e) => set(s.key, e.target.value || undefined)} />
            ) : s.kind === "number" ? (
              <input type="number" className={input} value={String(values[s.key] ?? "")} onChange={(e) => set(s.key, e.target.value === "" ? undefined : Number(e.target.value))} />
            ) : s.kind === "toggle" ? (
              <label className="flex items-center gap-2 py-1.5 text-[12px] text-dim-300">
                <input type="checkbox" className="accent-[#5b9dff]" checked={Boolean(values[s.key])} onChange={(e) => set(s.key, e.target.checked)} />
                {s.placeholder ?? s.label}
              </label>
            ) : s.kind === "tags" ? (
              <input className={input} placeholder="comma, separated" value={String(values[s.key] ?? "")} onChange={(e) => set(s.key, e.target.value)} onBlur={(e) => set(s.key, e.target.value)} />
            ) : (
              <input className={`${input} ${s.mono ? "font-mono" : ""}`} placeholder={s.placeholder} value={String(values[s.key] ?? "")} onChange={(e) => set(s.key, e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-3 border-l-2 border-signal-red pl-2 text-[12px] text-signal-red">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : submitLabel ?? `Add ${title.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

/** Normalizes SpecAddForm values (tags strings → arrays, "" → undefined). */
export function normalizeSpecValues(
  specs: FieldSpec[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of specs) {
    const raw = values[s.key];
    if (raw === undefined || raw === "") continue;
    out[s.key] = s.kind === "tags" ? String(raw).split(",").map((x) => x.trim()).filter(Boolean) : raw;
  }
  return out;
}

export function SpecCard({
  row,
  specs,
  onPatch,
}: {
  row: Record<string, unknown>;
  specs: FieldSpec[];
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
      {specs.map((s) => {
        const v = row[s.key];
        const save = (val: unknown) => onPatch({ [s.key]: val });
        if (s.kind === "select") {
          return (
            <InlineSelect
              key={s.key}
              label={s.label}
              value={String(v ?? "")}
              options={(s.options ?? []) as string[]}
              onSave={(nv) => save(nv)}
            />
          );
        }
        if (s.kind === "date") {
          return <InlineDate key={s.key} label={s.label} value={(v as string | null) ?? null} onSave={(nv) => save(nv)} />;
        }
        if (s.kind === "number") {
          return <InlineNumber key={s.key} label={s.label} value={(v as number | null) ?? null} onSave={(nv) => save(nv)} />;
        }
        if (s.kind === "toggle") {
          return <InlineToggle key={s.key} label={s.label} value={Boolean(v)} caption={s.placeholder ?? s.label} onSave={(nv) => save(nv)} />;
        }
        if (s.kind === "tags") {
          return <InlineTags key={s.key} label={s.label} value={(v as string[]) ?? []} onSave={(nv) => save(nv)} />;
        }
        return (
          <div key={s.key} className={s.kind === "textarea" || s.span === 2 ? "col-span-2 md:col-span-4" : ""}>
            <InlineText
              label={s.label}
              value={String(v ?? "")}
              placeholder={s.placeholder}
              multiline={s.kind === "textarea"}
              mono={s.mono}
              onSave={(nv) => save(nv)}
            />
          </div>
        );
      })}
    </div>
  );
}
