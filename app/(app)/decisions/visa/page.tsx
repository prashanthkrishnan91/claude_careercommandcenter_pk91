"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InlineDate, InlineTags, InlineText } from "@/components/InlineField";
import PageHeader from "@/components/PageHeader";
import { useShell } from "@/components/ShellContext";
import { updateRow } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase";
import { contiguousCompletedGate, ensureVisaChecklist } from "@/lib/visa";
import type { VisaChecklistItem } from "@/lib/entities";

// Visa Decision Checklist (v2 §6): eight gates, explicit assumptions and
// risks, attorney confirmation where required. The app never shows a single
// "safe to jump" date, and nothing here is legal advice.

const STATUSES = ["not_started", "in_progress", "complete", "blocked"] as const;

export default function VisaPage() {
  const { bump } = useShell();
  const db = getSupabase();
  const loader = useCallback((dbc: SupabaseClient) => ensureVisaChecklist(dbc), []);
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;
  const gate = contiguousCompletedGate(data);

  return (
    <main>
      <PageHeader crumb="decisions" title="Visa Decision Checklist" count={gate}>
        <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-dim-500">
          <Link href="/decisions/visa" className="text-signal-blue">visa</Link>
          <Link href="/decisions/offers" className="hover:text-dim-300">offers</Link>
          <Link href="/decisions/benchmarks" className="hover:text-dim-300">benchmarks</Link>
        </div>
      </PageHeader>
      <div className="space-y-3 px-4 py-5 md:px-8">
        <p className="max-w-2xl text-[12px] leading-relaxed text-dim-400">
          Eight gates in order; downstream actions unlock as gates complete (job-search actions at
          Gate 5, offer acceptance behind Gates 6 and 7). This checklist records state — it does
          not interpret immigration law, and nothing in this app is legal advice. Attorney
          consultations happen externally and are recorded here.
        </p>
        {data.map((g) => (
          <details key={g.id} className={`panel px-4 py-3 ${g.status === "blocked" ? "border-signal-red/40" : ""}`}>
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`font-mono text-[13px] ${g.status === "complete" ? "text-signal-green" : "text-dim-300"}`}>
                {g.status === "complete" ? "■" : "□"} Gate {g.ordinal}
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-dim-100">{g.state_name}</span>
              {g.attorney_confirmation_required_bool && (
                <span className={`font-mono text-[10px] uppercase ${g.attorney_confirmed_at ? "text-signal-green" : "text-signal-amber"}`}>
                  attorney {g.attorney_confirmed_at ? `confirmed ${g.attorney_confirmed_at.slice(0, 10)}` : "required"}
                </span>
              )}
              {g.ordinal === 7 && (
                <span className={`font-mono text-[10px] uppercase ${g.qualifying_offer_fk ? "text-signal-green" : "text-signal-amber"}`}>
                  {g.qualifying_offer_fk ? "qualifying offer linked" : "no qualifying offer — link one from the Offer Workbench"}
                </span>
              )}
              <select
                className="rounded-sm border border-ink-600 bg-ink-900 px-1 py-0.5 font-mono text-[10px] uppercase text-dim-300"
                value={g.status}
                onClick={(e) => e.preventDefault()}
                onChange={async (e) => {
                  const { error: err } = await db.from("visa_checklist_items").update({ status: e.target.value }).eq("id", g.id).select();
                  if (err) window.alert(err.message);
                  bump();
                }}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-4 border-t border-ink-700 pt-3 md:grid-cols-2">
              <InlineTags label="Assumptions — what must remain true" value={g.assumptions} onSave={(v) => updateRow(db, "visa_checklist_items", g.id, { assumptions: v }).then(() => {})} />
              <InlineTags label="Risks" value={g.risks} onSave={(v) => updateRow(db, "visa_checklist_items", g.id, { risks: v }).then(() => {})} />
              <InlineTags label="Required documents" value={g.required_documents} onSave={(v) => updateRow(db, "visa_checklist_items", g.id, { required_documents: v }).then(() => {})} />
              {g.attorney_confirmation_required_bool && (
                <div className="grid grid-cols-2 gap-3">
                  <InlineDate
                    label="Attorney confirmed"
                    value={g.attorney_confirmed_at ? g.attorney_confirmed_at.slice(0, 10) : null}
                    onSave={(v) => updateRow(db, "visa_checklist_items", g.id, { attorney_confirmed_at: v ? `${v}T00:00:00Z` : null }).then(() => {})}
                  />
                  <InlineText label="Confirmation doc ref" value={g.attorney_confirmation_doc_ref} onSave={(v) => updateRow(db, "visa_checklist_items", g.id, { attorney_confirmation_doc_ref: v }).then(() => {})} />
                </div>
              )}
              <div className="md:col-span-2">
                <InlineText label="Notes" multiline value={g.notes} onSave={(v) => updateRow(db, "visa_checklist_items", g.id, { notes: v }).then(() => {})} />
              </div>
              {g.do_not_act_until_confirmed_bool && (
                <p className="font-mono text-[10px] uppercase text-signal-red md:col-span-2">
                  do-not-act flag: dependent actions stay locked until this gate is attorney-confirmed
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
