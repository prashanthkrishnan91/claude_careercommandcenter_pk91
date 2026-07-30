"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/PageHeader";
import { directorSignal } from "@/lib/grader";
import { useVaultData } from "@/lib/hooks";
import { listRows } from "@/lib/genericRepo";
import { listAchievements } from "@/lib/repos";
import type { AiOutput, CareerAsset, GraderEvaluation, StoryBankEntry, TargetArchetype } from "@/lib/entities";

// Intelligence: grader coverage, archetypes/comparator, assets, story bank —
// plus the AI output audit trail (every model call, blocked or not).

export default function IntelligencePage() {
  const loader = useCallback(async (db: SupabaseClient) => {
    const [achievements, evaluations, archetypes, assets, stories, aiOutputs] = await Promise.all([
      listAchievements(db),
      listRows<GraderEvaluation>(db, "grader_evaluations", {}),
      listRows<TargetArchetype>(db, "target_archetypes", {}),
      listRows<CareerAsset>(db, "career_assets", {}),
      listRows<StoryBankEntry>(db, "story_bank", {}),
      listRows<AiOutput>(db, "ai_outputs", { limit: 12, includeArchived: true }),
    ]);
    return { achievements, evaluations, archetypes, assets, stories, aiOutputs };
  }, []);
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  const gradedIds = new Set(data.evaluations.map((e) => e.achievement_fk));
  const directorCount = new Set(
    data.evaluations.filter((e) => directorSignal(e.dimensions).qualifies).map((e) => e.achievement_fk),
  ).size;

  const card = "panel p-4";
  return (
    <main>
      <PageHeader crumb="intelligence" title="Intelligence" />
      <div className="grid grid-cols-1 gap-3 px-4 py-5 sm:grid-cols-2 lg:grid-cols-4 md:px-8">
        <Link href="/vault" className={`${card} hover:border-dim-500`}>
          <h2 className="microlabel mb-2">grader coverage</h2>
          <div className="font-mono text-xl text-dim-100">{gradedIds.size}<span className="text-[11px] text-dim-500"> / {data.achievements.length} graded</span></div>
          <p className="mt-1 text-[12px] text-dim-400">{directorCount} director-signal. Grade from any achievement detail page.</p>
        </Link>
        <Link href="/intelligence/archetypes" className={`${card} hover:border-dim-500`}>
          <h2 className="microlabel mb-2">target archetypes</h2>
          <div className="font-mono text-xl text-dim-100">{data.archetypes.filter((a) => a.approved_by_user_bool).length}<span className="text-[11px] text-dim-500"> approved / {data.archetypes.length}</span></div>
          <p className="mt-1 text-[12px] text-dim-400">JD-derived or user-defined; comparator + gap reports →</p>
        </Link>
        <Link href="/intelligence/assets" className={`${card} hover:border-dim-500`}>
          <h2 className="microlabel mb-2">career assets</h2>
          <div className="font-mono text-xl text-dim-100">{data.assets.length}</div>
          <p className="mt-1 text-[12px] text-dim-400">Versioned, truth/privacy-gated generation, collections →</p>
        </Link>
        <Link href="/intelligence/stories" className={`${card} hover:border-dim-500`}>
          <h2 className="microlabel mb-2">story bank</h2>
          <div className="font-mono text-xl text-dim-100">{data.stories.length}</div>
          <p className="mt-1 text-[12px] text-dim-400">STAR stories by theme, sourced from achievements →</p>
        </Link>
      </div>

      <section className="px-4 pb-8 md:px-8">
        <h2 className="microlabel mb-2">ai output audit · last {data.aiOutputs.length}</h2>
        {data.aiOutputs.length === 0 ? (
          <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
            No AI calls yet. Every future call — including blocked ones — is recorded here with model, inputs, classifications, and block reason.
          </p>
        ) : (
          <ul className="panel divide-y divide-ink-700/70">
            {data.aiOutputs.map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                <span className="w-40 font-mono text-[10px] uppercase text-dim-400">{o.output_type}</span>
                <span className="font-mono text-[10px] text-dim-500">{o.model_used || "—"}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-dim-300">
                  {o.blocked_bool ? o.block_reason : o.output_text.slice(0, 120) || "(structured)"}
                </span>
                <span className={`font-mono text-[10px] uppercase ${o.blocked_bool ? "text-signal-red" : "text-signal-green"}`}>
                  {o.blocked_bool ? "blocked" : "ok"}
                </span>
                <span className="font-mono text-[10px] text-dim-500">{o.created_at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
