"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/PageHeader";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, SpecCard, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { createRow, getRow, listRows, updateRow } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase";
import { acceptOfferActionsUnlocked, ensureVisaChecklist } from "@/lib/visa";
import type { CounterProposal, Offer, OfferScenario } from "@/lib/entities";

// Offer Workbench (v2.2.1 §3): record-keeping and decision-staging, not a
// compensation calculator. Scenario totals are user-entered snapshots.
// Acceptance is enforced twice: here and by the database trigger.

const OFFER_SPECS: FieldSpec[] = [
  { key: "role_title", label: "Role title", kind: "text" },
  { key: "received_at", label: "Received", kind: "date" },
  { key: "expiration_date", label: "Expires", kind: "date" },
  { key: "decision_due_by", label: "Decision due", kind: "date" },
  { key: "base_salary", label: "Base salary", kind: "number" },
  { key: "base_currency", label: "Currency", kind: "text", mono: true },
  { key: "bonus_target_pct", label: "Bonus target %", kind: "number" },
  { key: "equity_grant_value", label: "Equity grant value", kind: "number" },
  { key: "signing_bonus", label: "Signing bonus", kind: "number" },
  { key: "relocation_package", label: "Relocation", kind: "text" },
  { key: "bonus_structure_notes", label: "Bonus structure notes", kind: "textarea", span: 2 },
  { key: "equity_vest_schedule_notes", label: "Vest schedule notes", kind: "textarea", span: 2 },
  { key: "benefits_summary", label: "Benefits summary", kind: "textarea", span: 2 },
  { key: "other_comp_notes", label: "Other comp notes", kind: "textarea", span: 2 },
];

const SCENARIO_SPECS: FieldSpec[] = [
  { key: "scenario_name", label: "Scenario name", kind: "text", required: true, placeholder: "e.g. conservative / stock flat" },
  { key: "total_comp_yr1", label: "Total comp yr 1 (your number)", kind: "number" },
  { key: "total_comp_yr4", label: "Total comp yr 4 (your number)", kind: "number" },
  { key: "assumptions", label: "Assumptions", kind: "tags", span: 2 },
  { key: "notes", label: "Notes", kind: "textarea", span: 2 },
];

const COUNTER_SPECS: FieldSpec[] = [
  { key: "rationale", label: "Rationale", kind: "textarea", required: true, span: 2 },
  { key: "sent_at", label: "Sent (externally, by you)", kind: "date" },
  { key: "response_at", label: "Response received", kind: "date" },
  { key: "response_summary", label: "Response summary", kind: "textarea", span: 2 },
  { key: "outcome", label: "Outcome", kind: "select", options: ["accepted", "partially_accepted", "rejected", "countered", "no_response"] },
];

export default function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { bump } = useShell();
  const db = getSupabase();
  const [notice, setNotice] = useState<string | null>(null);

  const loader = useCallback(
    async (dbc: SupabaseClient) => {
      const [offer, scenarios, counters, gates] = await Promise.all([
        getRow<Offer>(dbc, "offers", id),
        listRows<OfferScenario>(dbc, "offer_scenarios", { eq: { offer_fk: id } }),
        listRows<CounterProposal>(dbc, "counter_proposals", { eq: { offer_fk: id } }),
        ensureVisaChecklist(dbc),
      ]);
      return { offer, scenarios, counters, gates };
    },
    [id],
  );
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data?.offer) return <p className="p-8 text-[13px] text-signal-red">{error ?? "Not found."}</p>;
  const o = data.offer;
  const gatesReady = acceptOfferActionsUnlocked(data.gates);
  const commitmentsReady = o.visa_sponsorship_committed_bool && o.priority_date_retention_committed_bool && o.attorney_reviewed_at;

  async function setStatus(status: string) {
    const { error: err } = await db.from("offers").update({ status }).eq("id", o.id).select();
    if (err) setNotice(err.message);
    else setNotice(null);
    bump();
  }

  return (
    <main>
      <PageHeader
        crumb="decisions / offers"
        title={o.role_title || "Offer"}
        action={
          <div className="flex gap-2">
            {["negotiating", "declined", "withdrawn"].map((s) => (
              <button key={s} className="btn" onClick={() => void setStatus(s)} disabled={o.status === s}>
                {s}
              </button>
            ))}
            <button
              className="btn-primary"
              title="Blocked until Visa Gate 7 is complete and this offer carries both commitments + attorney review"
              onClick={() => void setStatus("accepted")}
              disabled={o.status === "accepted"}
            >
              Accept
            </button>
          </div>
        }
      />
      <div className="space-y-6 px-4 py-5 md:px-8">
        {notice && <p className="border-l-2 border-signal-red pl-2 text-[12px] text-signal-red">{notice}</p>}
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim-500">
          status: {o.status} · counters are staged and recorded here — the app never sends them
        </p>

        {/* Gate 7 panel */}
        <section className={`panel p-4 ${commitmentsReady && gatesReady ? "border-signal-green/30" : "border-signal-amber/40"}`}>
          <h2 className="microlabel mb-2">gate 7 — sponsorship &amp; priority-date retention (attorney-reviewed)</h2>
          <div className="grid grid-cols-1 gap-2 text-[12px] text-dim-300 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="accent-[#5b9dff]" checked={o.visa_sponsorship_committed_bool}
                onChange={(e) => void updateRow(db, "offers", o.id, { visa_sponsorship_committed_bool: e.target.checked }).then(bump)} />
              GC sponsorship committed in writing
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="accent-[#5b9dff]" checked={o.priority_date_retention_committed_bool}
                onChange={(e) => void updateRow(db, "offers", o.id, { priority_date_retention_committed_bool: e.target.checked }).then(bump)} />
              Priority-date retention committed in writing
            </label>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <span className="microlabel">attorney review</span>
              {o.attorney_reviewed_at ? (
                <span className="font-mono text-[11px] text-signal-green">reviewed {o.attorney_reviewed_at.slice(0, 10)}</span>
              ) : (
                <button className="btn" onClick={() => void updateRow(db, "offers", o.id, { attorney_reviewed_at: new Date().toISOString() }).then(bump)}>
                  Record attorney review
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-dim-500">
            Acceptance requires all three above AND Visa Checklist Gate 7 complete ({gatesReady ? "gates 6+7 confirmed" : "gates 6/7 not yet confirmed"}).
            The database enforces this independently of the UI. Not legal advice — your attorney interprets the terms.
          </p>
        </section>

        <SpecCard row={o as never} specs={OFFER_SPECS} onPatch={async (p) => { await updateRow(db, "offers", o.id, p); }} />

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="microlabel">scenarios · {data.scenarios.length} · snapshots, not formulas</h2>
            <SpecAddForm title="Add scenario" specs={SCENARIO_SPECS} onCreate={async (v) => { await createRow(db, "offer_scenarios", { offer_fk: o.id, ...normalizeSpecValues(SCENARIO_SPECS, v) }); bump(); }} />
          </div>
          {data.scenarios.length > 0 && (
            <ul className="panel divide-y divide-ink-700/70">
              {data.scenarios.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{s.scenario_name}</span>
                  <span className="font-mono text-[12px] text-dim-300">yr1 {s.total_comp_yr1 ? Number(s.total_comp_yr1).toLocaleString() : "—"}</span>
                  <span className="font-mono text-[12px] text-dim-300">yr4 {s.total_comp_yr4 ? Number(s.total_comp_yr4).toLocaleString() : "—"}</span>
                  <span className="text-[11px] text-dim-500">{s.assumptions.join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="microlabel">counter-proposals · {data.counters.length}</h2>
            <SpecAddForm title="Stage counter" specs={COUNTER_SPECS} onCreate={async (v) => { await createRow(db, "counter_proposals", { offer_fk: o.id, ...normalizeSpecValues(COUNTER_SPECS, v) }); bump(); }} />
          </div>
          {data.counters.length > 0 && (
            <div className="space-y-2">
              {data.counters.map((c) => (
                <details key={c.id} className="panel px-4 py-2">
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-dim-200">{c.rationale.slice(0, 100)}</span>
                    <span className="font-mono text-[10px] text-dim-500">{c.sent_at ? `sent ${c.sent_at}` : "not sent"}</span>
                    {c.outcome && <span className="font-mono text-[10px] uppercase text-dim-400">{c.outcome.replace("_", " ")}</span>}
                  </summary>
                  <div className="mt-3 border-t border-ink-700 pt-3">
                    <SpecCard row={c as never} specs={COUNTER_SPECS} onPatch={async (p) => { await updateRow(db, "counter_proposals", c.id, p); }} />
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>

        <p className="text-[11px] text-dim-500">
          <Link href="/decisions/benchmarks" className="text-signal-blue">Comp benchmarks →</Link> feed counter-proposals; no tax engine, no Monte Carlo, by design.
        </p>
      </div>
    </main>
  );
}
