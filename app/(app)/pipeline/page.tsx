"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PrivacyBadge, StatusBadge, TruthBadge } from "@/components/Badges";
import { ArchivedEmpty, PipelineEmpty } from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import PageHeader from "@/components/PageHeader";
import RowList from "@/components/RowList";
import { useShell } from "@/components/ShellContext";
import { achievementMatches, EMPTY_FILTERS, type FilterState } from "@/lib/filters";
import { useVaultData } from "@/lib/hooks";
import {
  archiveAchievement,
  listArchived,
  listDraftAchievements,
  listProjects,
  listRecentActivity,
  restoreAchievement,
  restoreEvidenceItem,
  restoreMetric,
  restoreProject,
} from "@/lib/repos";
import { getSupabase } from "@/lib/supabase";
import type { Achievement } from "@/lib/types";

// Pipeline — the working layer (v2.2 §4): drafts awaiting promotion, the
// last 20 entries across all entities, and archived items with restore.

export default function PipelinePage() {
  const router = useRouter();
  const { bump } = useShell();
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const loader = useCallback(async (db: SupabaseClient) => {
    const [drafts, recent, archived, projects] = await Promise.all([
      listDraftAchievements(db),
      listRecentActivity(db),
      listArchived(db),
      listProjects(db, { includeArchived: true }),
    ]);
    return { drafts, recent, archived, projects };
  }, []);
  const { data, loading, error } = useVaultData(loader);

  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  const projectsById = new Map(data.projects.map((p) => [p.id, p]));
  const drafts = data.drafts.filter((d) => achievementMatches(filters, d, projectsById.get(d.project_fk)));
  const archivedCount =
    data.archived.projects.length + data.archived.achievements.length +
    data.archived.metrics.length + data.archived.evidence_items.length;
  const empty = drafts.length === 0 && data.recent.length === 0;
  const db = getSupabase();

  return (
    <main>
      <PageHeader crumb="pipeline · working layer" title="Pipeline">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          employers={[...new Set(data.projects.map((p) => p.employer).filter(Boolean))]}
          statusOptions={["draft", "active", "archived"]}
        />
      </PageHeader>

      <div className="space-y-8 px-4 py-5 md:px-8">
        {empty && <PipelineEmpty />}

        {!empty && (
          <section>
            <h2 className="microlabel mb-2">drafts awaiting promotion · {drafts.length}</h2>
            {drafts.length === 0 ? (
              <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">No drafts match.</p>
            ) : (
              <RowList<Achievement>
                rows={drafts}
                rowKey={(a) => a.id}
                status={(a) => a.status}
                onOpen={(a) => router.push(`/vault/achievements/${a.id}`)}
                onArchive={(a) => void archiveAchievement(db, a.id).then(bump)}
                render={(a) => (
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{a.headline}</span>
                    <span className="text-[12px] text-dim-400">{projectsById.get(a.project_fk)?.name}</span>
                    <span className="font-mono text-[11px] text-dim-500">{a.created_at.slice(0, 10)}</span>
                    <TruthBadge value={a.truth_status} />
                    <PrivacyBadge value={a.privacy_class} />
                  </span>
                )}
              />
            )}
          </section>
        )}

        {!empty && (
          <section>
            <h2 className="microlabel mb-2">recent activity · newest {data.recent.length}</h2>
            <ul className="panel divide-y divide-ink-700/70">
              {data.recent.map((r) => (
                <li key={`${r.kind}:${r.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                  <span className="w-24 font-mono text-[10px] uppercase tracking-[0.1em] text-dim-500">{r.kind.replace("_", " ")}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-200">{r.label}</span>
                  <StatusBadge value={r.status} />
                  <span className="font-mono text-[11px] text-dim-500">{r.created_at.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="microlabel mb-2">archived · {archivedCount} · recoverable</h2>
          {archivedCount === 0 ? (
            <ArchivedEmpty />
          ) : (
            <ul className="panel divide-y divide-ink-700/70">
              {data.archived.projects.map((p) => (
                <li key={p.id} className="flex items-baseline gap-3 px-4 py-2 row-archived">
                  <span className="w-24 font-mono text-[10px] uppercase text-dim-500">project</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-300">{p.name}</span>
                  <button className="btn-quiet" onClick={() => void restoreProject(db, p.id).then(bump)}>restore</button>
                </li>
              ))}
              {data.archived.achievements.map((a) => (
                <li key={a.id} className="flex items-baseline gap-3 px-4 py-2 row-archived">
                  <span className="w-24 font-mono text-[10px] uppercase text-dim-500">achievement</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-300">{a.headline}</span>
                  <button className="btn-quiet" onClick={() => void restoreAchievement(db, a.id).then(bump)}>restore → draft</button>
                </li>
              ))}
              {data.archived.metrics.map((m) => (
                <li key={m.id} className="flex items-baseline gap-3 px-4 py-2 row-archived">
                  <span className="w-24 font-mono text-[10px] uppercase text-dim-500">metric</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-300">{m.metric_name}: {m.value}</span>
                  <button className="btn-quiet" onClick={() => void restoreMetric(db, m.id).then(bump)}>restore</button>
                </li>
              ))}
              {data.archived.evidence_items.map((e) => (
                <li key={e.id} className="flex items-baseline gap-3 px-4 py-2 row-archived">
                  <span className="w-24 font-mono text-[10px] uppercase text-dim-500">evidence</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-300">{e.content_summary}</span>
                  <button className="btn-quiet" onClick={() => void restoreEvidenceItem(db, e.id).then(bump)}>restore</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
