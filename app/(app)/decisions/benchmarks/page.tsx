"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/PageHeader";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { archiveRow, createRow, listRows } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase";
import type { CompBenchmark } from "@/lib/entities";

const SPECS: FieldSpec[] = [
  { key: "role_title", label: "Role", kind: "text", required: true },
  { key: "source", label: "Source", kind: "text", required: true, placeholder: "Levels.fyi, published report — public sources only" },
  { key: "total_comp_low", label: "Total comp low", kind: "number" },
  { key: "total_comp_high", label: "Total comp high", kind: "number" },
  { key: "as_of", label: "As of", kind: "date" },
  { key: "notes", label: "Notes", kind: "textarea", span: 2 },
];

export default function BenchmarksPage() {
  const { bump } = useShell();
  const loader = useCallback((db: SupabaseClient) => listRows<CompBenchmark>(db, "comp_benchmarks", {}), []);
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  return (
    <main>
      <PageHeader
        crumb="decisions"
        title="Comp benchmarks"
        count={data.length}
        action={
          <SpecAddForm title="Add benchmark" specs={SPECS} onCreate={async (v) => { await createRow(getSupabase(), "comp_benchmarks", normalizeSpecValues(SPECS, v)); bump(); }} />
        }
      >
        <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-dim-500">
          <Link href="/decisions/visa" className="hover:text-dim-300">visa</Link>
          <Link href="/decisions/offers" className="hover:text-dim-300">offers</Link>
          <Link href="/decisions/benchmarks" className="text-signal-blue">benchmarks</Link>
        </div>
      </PageHeader>
      <div className="px-4 py-5 md:px-8">
        {data.length === 0 ? (
          <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
            No benchmarks. Public sources only — benchmark research is permitted at every visa gate.
          </p>
        ) : (
          <ul className="panel divide-y divide-ink-700/70">
            {data.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{b.role_title}</span>
                <span className="font-mono text-[12px] text-dim-300">
                  {b.total_comp_low ? Number(b.total_comp_low).toLocaleString() : "—"} – {b.total_comp_high ? Number(b.total_comp_high).toLocaleString() : "—"}
                </span>
                <span className="text-[11px] text-dim-500">{b.source}{b.as_of ? ` · ${b.as_of}` : ""}</span>
                <button className="btn-quiet" onClick={() => void archiveRow(getSupabase(), "comp_benchmarks", b.id).then(bump)}>archive</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
