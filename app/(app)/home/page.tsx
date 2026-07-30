"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/PageHeader";
import { StatusBadge } from "@/components/Badges";
import { useVaultData } from "@/lib/hooks";
import { listRows } from "@/lib/genericRepo";
import { computeMaturity } from "@/lib/maturity";
import { listAchievements, listProjects } from "@/lib/repos";
import { weekOf } from "@/lib/rhythm";
import { contiguousCompletedGate } from "@/lib/visa";
import type { ActionItem, TargetArchetype, VisaChecklistItem, WeeklyBrief } from "@/lib/entities";

// Home / Command view: current evidence health, next actions, visa state,
// maturity progress, upcoming review, active targets. No vanity metrics —
// every number here is an operating signal.

export default function HomePage() {
  const loader = useCallback(async (db: SupabaseClient) => {
    const week = weekOf(new Date());
    const [achievements, projects, visa, actions, briefs, archetypes, maturity] = await Promise.all([
      listAchievements(db, { includeArchived: true }),
      listProjects(db),
      listRows<VisaChecklistItem>(db, "visa_checklist_items", { orderBy: "ordinal", ascending: true, includeArchived: true }),
      listRows<ActionItem>(db, "action_items", { eq: { week_of: week } }),
      listRows<WeeklyBrief>(db, "weekly_briefs", { eq: { week_of: week }, includeArchived: true }),
      listRows<TargetArchetype>(db, "target_archetypes", {}),
      computeMaturity(db),
    ]);
    return { achievements, projects, visa, actions, briefs, archetypes, maturity, week };
  }, []);
  const { data, loading, error } = useVaultData(loader);

  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  const live = data.achievements.filter((a) => a.status !== "archived");
  const drafts = live.filter((a) => a.status === "draft");
  const needsProof = live.filter((a) => a.truth_status === "NEEDS_PROOF");
  const gate = contiguousCompletedGate(data.visa);
  const selected = data.actions.filter((a) => a.status === "selected" || a.status === "completed");
  const metCount = data.maturity.criteria.filter((c) => c.met).length;
  const fridayDone = data.briefs.some((b) => b.brief_type === "friday_capture" && b.reviewed_at);
  const sundayDone = data.briefs.some((b) => b.brief_type === "sunday_review" && b.reviewed_at);

  const cell = "panel p-4";
  return (
    <main>
      <PageHeader crumb="command" title="Home" />
      <div className="grid grid-cols-1 gap-3 px-4 py-5 sm:grid-cols-2 lg:grid-cols-3 md:px-8">
        <section className={cell}>
          <h2 className="microlabel mb-3">evidence health</h2>
          <div className="grid grid-cols-3 gap-2 font-mono">
            <div><div className="text-xl text-dim-100">{live.length}</div><div className="microlabel">achievements</div></div>
            <div><div className="text-xl text-signal-amber">{drafts.length}</div><div className="microlabel">drafts</div></div>
            <div><div className="text-xl text-signal-amber">{needsProof.length}</div><div className="microlabel">needs proof</div></div>
          </div>
          <p className="mt-3 text-[12px] text-dim-400">
            {data.projects.length} active project{data.projects.length === 1 ? "" : "s"} across{" "}
            {new Set(data.projects.map((p) => p.employer).filter(Boolean)).size} employer(s).{" "}
            <Link href="/vault" className="text-signal-blue">Open the vault →</Link>
          </p>
        </section>

        <section className={cell}>
          <h2 className="microlabel mb-3">this week · {data.week}</h2>
          {selected.length === 0 ? (
            <p className="text-[12px] text-dim-400">
              No actions selected. Run <Link href="/rhythm" className="text-signal-blue">Sunday Review</Link> to pick the top 3.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {selected.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-[12px] text-dim-200">
                  <StatusBadge value={a.status} />
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 font-mono text-[10px] uppercase text-dim-500">
            friday capture: {fridayDone ? "done" : "open"} · sunday review: {sundayDone ? "done" : "open"}
          </p>
        </section>

        <section className={cell}>
          <h2 className="microlabel mb-3">visa state</h2>
          <div className="font-mono text-xl text-dim-100">Gate {gate} <span className="text-[11px] text-dim-500">/ 8 contiguous</span></div>
          <ul className="mt-2 space-y-1">
            {data.visa.slice(0, 8).map((g) => (
              <li key={g.id} className="flex items-center gap-2 font-mono text-[10px] uppercase">
                <span className={g.status === "complete" ? "text-signal-green" : g.status === "blocked" ? "text-signal-red" : "text-dim-500"}>
                  {g.status === "complete" ? "■" : "□"}
                </span>
                <span className="truncate text-dim-400">{g.ordinal}. {g.state_name}</span>
              </li>
            ))}
          </ul>
          <Link href="/decisions/visa" className="mt-2 block text-[12px] text-signal-blue">Checklist →</Link>
        </section>

        <section className={cell}>
          <h2 className="microlabel mb-3">maturity gates (P1 unlock)</h2>
          <div className="font-mono text-xl text-dim-100">
            {metCount}<span className="text-[11px] text-dim-500"> / {data.maturity.criteria.length} met</span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-sm bg-ink-700">
            <div className="h-1.5 rounded-sm bg-signal-blue" style={{ width: `${(metCount / data.maturity.criteria.length) * 100}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-dim-400">
            {data.maturity.unlocked
              ? data.maturity.allMet
                ? "All gates met — distribution layer unlocked."
                : "Unlocked by DEV OVERRIDE — gates are not actually met."
              : "Distribution layer locked until every gate is met."}{" "}
            <Link href="/career" className="text-signal-blue">Detail →</Link>
          </p>
        </section>

        <section className={cell}>
          <h2 className="microlabel mb-3">active targets</h2>
          {data.archetypes.filter((a) => a.approved_by_user_bool).length === 0 ? (
            <p className="text-[12px] text-dim-400">
              No approved archetypes. <Link href="/intelligence/archetypes" className="text-signal-blue">Define or derive one →</Link>
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.archetypes.filter((a) => a.approved_by_user_bool).map((a) => (
                <li key={a.id} className="text-[12px] text-dim-200">
                  <Link href={`/intelligence/archetypes/${a.id}`} className="hover:text-signal-blue">{a.name}</Link>
                  <span className="ml-2 font-mono text-[10px] uppercase text-dim-500">{a.source_type}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cell}>
          <h2 className="microlabel mb-3">upcoming reviews</h2>
          <ul className="space-y-1.5 text-[12px] text-dim-300">
            <li>Friday Capture — end of workday Friday {fridayDone ? "(done this week)" : ""}</li>
            <li>Sunday Review — 30 min, pick top 3 {sundayDone ? "(done this week)" : ""}</li>
            <li>Monthly Board — last Sunday of the month</li>
          </ul>
          <Link href="/rhythm" className="mt-2 block text-[12px] text-signal-blue">Operating rhythm →</Link>
        </section>
      </div>
    </main>
  );
}
