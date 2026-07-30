"use client";

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/PageHeader";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, SpecCard, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { archiveRow, createRow, listRows, updateRow } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase";
import type { StoryBankEntry } from "@/lib/entities";

const THEMES = ["leadership", "conflict", "ambiguity", "scale", "metric_impact", "influence", "failure", "other"] as const;
const SPECS: FieldSpec[] = [
  { key: "theme", label: "Theme", kind: "select", options: THEMES, required: true },
  { key: "situation", label: "Situation", kind: "textarea", span: 2 },
  { key: "task", label: "Task", kind: "textarea", span: 2 },
  { key: "action", label: "Action", kind: "textarea", span: 2 },
  { key: "result", label: "Result", kind: "textarea", span: 2 },
];

export default function StoryBankPage() {
  const { bump } = useShell();
  const db = getSupabase();
  const loader = useCallback(
    (dbc: SupabaseClient) => listRows<StoryBankEntry>(dbc, "story_bank", { includeArchived: true }),
    [],
  );
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  return (
    <main>
      <PageHeader
        crumb="intelligence / story bank"
        title="Story bank"
        count={data.length}
        action={
          <SpecAddForm
            title="New STAR story"
            specs={SPECS}
            onCreate={async (values) => {
              await createRow(db, "story_bank", normalizeSpecValues(SPECS, values));
              bump();
            }}
          />
        }
      />
      <div className="space-y-2 px-4 py-5 md:px-8">
        {data.length === 0 && (
          <p className="max-w-xl border border-dashed border-ink-600 px-6 py-8 text-[13px] leading-relaxed text-dim-400">
            No stories banked. A STAR story is interview-ready narrative built on vault evidence —
            Leadership and Scope/Scale themes are the ones the maturity gates look for.
          </p>
        )}
        {data.map((s) => (
          <details key={s.id} className={`panel px-4 py-2 ${s.status === "archived" ? "row-archived" : ""}`}>
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="w-28 font-mono text-[10px] uppercase text-dim-400">{s.theme.replace("_", " ")}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{s.situation.slice(0, 100) || "(untitled situation)"}</span>
              {s.last_practiced_at && <span className="font-mono text-[10px] text-dim-500">practiced {s.last_practiced_at.slice(0, 10)}</span>}
              {s.approved_by_user_bool ? (
                <span className="font-mono text-[10px] uppercase text-signal-green">approved</span>
              ) : (
                <button
                  className="btn-quiet"
                  onClick={(e) => {
                    e.preventDefault();
                    void updateRow(db, "story_bank", s.id, { approved_by_user_bool: true, approved_at: new Date().toISOString() }).then(bump);
                  }}
                >
                  approve
                </button>
              )}
              <button
                className="btn-quiet"
                onClick={(e) => {
                  e.preventDefault();
                  void (s.status === "archived"
                    ? updateRow(db, "story_bank", s.id, { status: "active" })
                    : archiveRow(db, "story_bank", s.id)
                  ).then(bump);
                }}
              >
                {s.status === "archived" ? "restore" : "archive"}
              </button>
              <button
                className="btn-quiet"
                onClick={(e) => {
                  e.preventDefault();
                  void updateRow(db, "story_bank", s.id, { last_practiced_at: new Date().toISOString() }).then(bump);
                }}
              >
                practiced
              </button>
            </summary>
            <div className="mt-3 border-t border-ink-700 pt-3">
              <SpecCard row={s as never} specs={SPECS} onPatch={async (patch) => { await updateRow(db, "story_bank", s.id, patch); }} />
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
