"use client";

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import QuickLogBar from "@/components/QuickLogBar";
import { useShell } from "@/components/ShellContext";
import { listRows, updateRow } from "@/lib/genericRepo";
import { setOverride } from "@/lib/maturity";
import { useVaultData } from "@/lib/hooks";
import { listDraftAchievements } from "@/lib/repos";
import {
  buildCandidateActions,
  getOrCreateBrief,
  markBriefReviewed,
  saveCandidateActions,
  weekOf,
  type BriefType,
} from "@/lib/rhythm";
import { getSupabase } from "@/lib/supabase";
import { actionPermitted, contiguousCompletedGate, outwardActionMenu } from "@/lib/visa";
import type { ActionItem, SkillDevelopmentPlan, VisaChecklistItem, WeeklyBrief } from "@/lib/entities";

// The Weekly Operating System (v2.1 §14): Friday Capture, Sunday Review with
// top-5 candidates → top-3 selection, Monthly Board, Quarterly Narrative.
// Outward actions respect the Visa gate; overrides are logged.

const REVIEWS: Array<{ type: BriefType; label: string; blurb: string }> = [
  { type: "friday_capture", label: "Friday Capture", blurb: "15 min — log 1–5 achievements while memory is fresh. Truth defaults to NEEDS_PROOF; promote deliberately." },
  { type: "sunday_review", label: "Sunday Review", blurb: "30 min — graded achievements, comparator gaps, visa deltas, then pick the top 3 actions." },
  { type: "monthly_board", label: "Monthly Board", blurb: "60 min — evidence trajectory, archetype coverage, collection currency, visa assessment, stale plans, re-briefing." },
  { type: "quarterly_narrative", label: "Quarterly Narrative", blurb: "90 min — positioning accuracy, differentiators, story bank rebalance, skill plan adjustments." },
];

export default function RhythmPage() {
  const { bump } = useShell();
  const db = getSupabase();
  const week = weekOf(new Date());
  const [notice, setNotice] = useState<string | null>(null);

  const loader = useCallback(async (dbc: SupabaseClient) => {
    const [briefs, actions, visa, drafts, plans] = await Promise.all([
      listRows<WeeklyBrief>(dbc, "weekly_briefs", { includeArchived: true, limit: 24 }),
      listRows<ActionItem>(dbc, "action_items", { includeArchived: true, limit: 60 }),
      listRows<VisaChecklistItem>(dbc, "visa_checklist_items", { orderBy: "ordinal", ascending: true, includeArchived: true }),
      listDraftAchievements(dbc),
      listRows<SkillDevelopmentPlan>(dbc, "skill_development_plans", {}),
    ]);
    return { briefs, actions, visa, drafts, plans };
  }, []);
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  const gate = contiguousCompletedGate(data.visa);
  const weekActions = data.actions.filter((a) => a.week_of === week && a.status !== "archived");
  const selectedCount = weekActions.filter((a) => a.status === "selected" || a.status === "completed").length;
  const stalePlans = data.plans.filter(
    (p) => p.status === "in_progress" && Date.now() - Date.parse(p.updated_at) > 60 * 86400_000,
  );
  const menu = outwardActionMenu(gate);

  async function runSunday() {
    const candidates = await buildCandidateActions(db);
    await saveCandidateActions(db, week, candidates);
    await getOrCreateBrief(
      db,
      "sunday_review",
      week,
      `# Sunday Review — ${week}\n\nGate level: ${gate}. Drafts open: ${data!.drafts.length}. Candidates generated: ${candidates.length}.`,
    );
    bump();
  }

  async function selectAction(a: ActionItem) {
    if (!actionPermitted(a, gate)) {
      const reason = window.prompt(
        `This outward action requires Gate ${a.visa_gate_required_minimum} (you are at ${gate}). ` +
          "Type a reason to override — the override is logged.",
      );
      if (!reason) return;
      await setOverride(db, "market_motion_override", true, `${a.title}: ${reason}`);
    }
    if (selectedCount >= 3 && a.status === "candidate") {
      setNotice("Top 3 already selected — drop one before adding another.");
      return;
    }
    await updateRow(db, "action_items", a.id, { status: a.status === "candidate" ? "selected" : "candidate" });
    bump();
  }

  return (
    <main>
      <PageHeader crumb={`operating rhythm · week of ${week} · visa gate ${gate}`} title="Rhythm" />
      <div className="space-y-8 px-4 py-5 md:px-8">
        {/* reviews */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {REVIEWS.map((r) => {
            const brief = data.briefs.find((b) => b.week_of === week && b.brief_type === r.type)
              ?? data.briefs.filter((b) => b.brief_type === r.type).sort((a, b) => (a.week_of < b.week_of ? 1 : -1))[0];
            const doneThisWeek = brief?.week_of === week && brief.reviewed_at;
            return (
              <div key={r.type} className="panel flex flex-col p-4">
                <h2 className="microlabel mb-1">{r.label}</h2>
                <p className="flex-1 text-[12px] leading-relaxed text-dim-400">{r.blurb}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase text-dim-500">
                    {doneThisWeek ? "done this week" : brief ? `last: ${brief.week_of}` : "never run"}
                  </span>
                  {r.type === "sunday_review" ? (
                    <button className="btn" onClick={() => void runSunday()}>Run</button>
                  ) : (
                    <button
                      className="btn"
                      onClick={async () => {
                        const b = await getOrCreateBrief(db, r.type, week, `# ${r.label} — ${week}\n`);
                        await markBriefReviewed(db, b.id);
                        bump();
                      }}
                    >
                      {doneThisWeek ? "Re-mark" : "Complete"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* friday capture */}
        <section>
          <h2 className="microlabel mb-2">friday capture — what did you accomplish this week worth capturing?</h2>
          <QuickLogBar />
          <div className="mt-2 flex items-center gap-3">
            <button
              className="btn"
              onClick={async () => {
                const b = await getOrCreateBrief(db, "friday_capture", week, `# Friday Capture — ${week}`);
                await markBriefReviewed(db, b.id);
                bump();
              }}
            >
              Mark capture complete
            </button>
            <span className="text-[12px] text-dim-500">{data.drafts.length} draft(s) open for triage in the Pipeline.</span>
          </div>
        </section>

        {/* action queue */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="microlabel">
              action queue · week of {week} · {selectedCount}/3 selected
            </h2>
            {weekActions.length === 0 && (
              <button className="btn-primary" onClick={() => void runSunday()}>
                Generate top-5 candidates
              </button>
            )}
          </div>
          {notice && <p className="mb-2 border-l-2 border-signal-amber pl-2 text-[12px] text-signal-amber">{notice}</p>}
          {weekActions.length === 0 ? (
            <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
              No actions for this week yet — run Sunday Review. At least one candidate is always outward-facing, drawn from the gate-appropriate menu.
            </p>
          ) : (
            <ul className="panel divide-y divide-ink-700/70">
              {weekActions
                .sort((a, b) => a.priority_rank - b.priority_rank)
                .map((a) => {
                  const permitted = actionPermitted(a, gate);
                  return (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="font-mono text-[11px] text-dim-500">#{a.priority_rank}</span>
                      <span className="min-w-0 flex-1 text-[13px] text-dim-100">
                        {a.title}
                        <span className="ml-2 text-[11px] text-dim-500">{a.rationale}</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase text-dim-500">{a.category}</span>
                      {a.outward_facing_bool && (
                        <span className={`font-mono text-[10px] uppercase ${permitted ? "text-signal-green" : "text-signal-red"}`}>
                          outward{a.visa_gate_required_minimum ? ` · gate ≥${a.visa_gate_required_minimum}` : ""}
                        </span>
                      )}
                      <StatusBadge value={a.status} />
                      {a.status !== "completed" && (
                        <>
                          <button className="btn-quiet" onClick={() => void selectAction(a)}>
                            {a.status === "selected" ? "deselect" : "select"}
                          </button>
                          {a.status === "selected" && (
                            <button
                              className="btn-quiet text-signal-green"
                              onClick={() =>
                                void updateRow(db, "action_items", a.id, { status: "completed", completed_at: new Date().toISOString() }).then(bump)
                              }
                            >
                              done
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </section>

        {/* market motion + monthly surfacing */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="panel p-4">
            <h2 className="microlabel mb-2">market motion permitted at gate {gate}</h2>
            <ul className="list-inside list-disc space-y-0.5 text-[12px] text-dim-300">
              {menu.allowed.map((x) => <li key={x}>{x}</li>)}
            </ul>
            {menu.stillDisallowed.length > 0 && (
              <>
                <h3 className="microlabel mb-1 mt-3 text-signal-red/80">dormant until later gates</h3>
                <ul className="list-inside list-disc space-y-0.5 text-[12px] text-dim-500">
                  {menu.stillDisallowed.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </>
            )}
          </div>
          <div className="panel p-4">
            <h2 className="microlabel mb-2">monthly board watchlist</h2>
            <ul className="space-y-1 text-[12px] text-dim-300">
              <li>{data.drafts.length} draft(s) awaiting promote-or-archive triage</li>
              <li>
                {stalePlans.length} skill plan(s) stale (no update in 60+ days)
                {stalePlans.length > 0 && `: ${stalePlans.map((p) => p.method).join(", ")}`}
              </li>
              <li>Gate transitions since last board review — check the Visa checklist</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
