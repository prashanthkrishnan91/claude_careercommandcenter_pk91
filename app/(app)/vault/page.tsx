"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CandidateBadge, PrivacyBadge, StatusBadge, TruthBadge } from "@/components/Badges";
import { VaultEmpty } from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import PageHeader from "@/components/PageHeader";
import QuickLogBar from "@/components/QuickLogBar";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { achievementMatches, EMPTY_FILTERS, projectMatches, type FilterState } from "@/lib/filters";
import { useVaultData } from "@/lib/hooks";
import { archiveAchievement, createProject, listAchievements, listProjects } from "@/lib/repos";
import { getSupabase } from "@/lib/supabase";
import type { Achievement, Project } from "@/lib/types";

// Vault: the canonical hierarchy — Employer → Project → Achievement →
// Metrics/Evidence (v2.2 §4). Achievements open into the central detail page.

const PROJECT_SPECS: FieldSpec[] = [
  { key: "name", label: "Project name", kind: "text", required: true, placeholder: "A body of work — a system, a problem, a function" },
  { key: "employer", label: "Employer", kind: "text", placeholder: "e.g. DIRECTV" },
  { key: "role_at_time", label: "Role at the time", kind: "text" },
  { key: "start_date", label: "Started", kind: "date" },
  { key: "end_date", label: "Ended", kind: "date" },
  { key: "team_size", label: "Team size", kind: "number" },
  { key: "description", label: "Description", kind: "textarea", span: 2 },
];

export default function VaultPage() {
  const router = useRouter();
  const { bump } = useShell();
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const loader = useCallback(async (db: SupabaseClient) => {
    const [projects, achievements] = await Promise.all([
      listProjects(db, { includeArchived: true }),
      listAchievements(db, { includeArchived: true }),
    ]);
    return { projects, achievements };
  }, []);
  const { data, loading, error } = useVaultData(loader);

  const grouped = useMemo(() => {
    if (!data) return [];
    const projectsById = new Map(data.projects.map((p) => [p.id, p]));
    const visibleProjects = data.projects.filter(
      (p) => (filters.status ? true : p.status !== "archived") && projectMatches({ ...filters, status: null, truth: null, candidateOnly: false }, p) || false,
    );
    // Achievements filter independently; a project stays visible if it matches
    // or if any of its achievements match.
    const achByProject = new Map<string, Achievement[]>();
    for (const a of data.achievements) {
      if (!filters.status && a.status === "archived") continue;
      if (!achievementMatches(filters, a, projectsById.get(a.project_fk))) continue;
      const list = achByProject.get(a.project_fk) ?? [];
      list.push(a);
      achByProject.set(a.project_fk, list);
    }
    const projects = data.projects.filter(
      (p) => visibleProjects.includes(p) || achByProject.has(p.id),
    );
    const employers = new Map<string, Project[]>();
    for (const p of projects) {
      const key = p.employer || "(no employer)";
      const list = employers.get(key) ?? [];
      list.push(p);
      employers.set(key, list);
    }
    return [...employers.entries()].map(([employer, list]) => ({
      employer,
      projects: list.map((p) => ({ project: p, achievements: achByProject.get(p.id) ?? [] })),
    }));
  }, [data, filters]);

  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  const employers = [...new Set(data.projects.map((p) => p.employer).filter(Boolean))];

  return (
    <main>
      <PageHeader
        crumb="vault · employer → project → achievement"
        title="Vault"
        count={data.achievements.filter((a) => a.status !== "archived").length}
        action={
          <SpecAddForm
            title="Add project"
            specs={PROJECT_SPECS}
            onCreate={async (values) => {
              await createProject(getSupabase(), normalizeSpecValues(PROJECT_SPECS, values) as never);
              bump();
            }}
          />
        }
      >
        <FilterBar filters={filters} onChange={setFilters} employers={employers} statusOptions={["draft", "active", "archived"]} />
      </PageHeader>

      <div className="space-y-6 px-4 py-5 md:px-8">
        <QuickLogBar />

        {data.projects.length === 0 && <VaultEmpty />}

        {grouped.map(({ employer, projects }) => (
          <section key={employer}>
            <h2 className="microlabel mb-2 text-dim-300">{employer}</h2>
            <div className="space-y-3">
              {projects.map(({ project, achievements }) => (
                <div key={project.id} className={`panel ${project.status === "archived" ? "row-archived" : ""}`}>
                  <div className="hairline-b flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                    <Link href={`/vault/projects/${project.id}`} className="min-w-0 flex-1 truncate text-[14px] font-medium text-dim-100 hover:text-signal-blue">
                      {project.name}
                    </Link>
                    {project.role_at_time && <span className="text-[12px] text-dim-400">{project.role_at_time}</span>}
                    <span className="font-mono text-[11px] text-dim-500">
                      {project.start_date ?? "…"} → {project.end_date ?? "ongoing"}
                    </span>
                    <PrivacyBadge value={project.privacy_class} />
                    <StatusBadge value={project.status} />
                  </div>
                  {achievements.length === 0 ? (
                    <p className="px-4 py-2.5 text-[12px] text-dim-500">No achievements match — log one with Quick Log above.</p>
                  ) : (
                    <ul className="divide-y divide-ink-700/60">
                      {achievements.map((a) => (
                        <li key={a.id} className={a.status === "archived" ? "row-archived" : ""}>
                          <button
                            onClick={() => router.push(`/vault/achievements/${a.id}`)}
                            className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 pl-7 text-left hover:bg-ink-800/40 ${
                              a.status === "draft" ? "border-l-2 border-dashed border-l-signal-amber/50 italic" : "border-l-2 border-l-transparent"
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{a.headline}</span>
                            <span className="font-mono text-[11px] text-dim-500">{a.end_date ?? a.start_date ?? "—"}</span>
                            <StatusBadge value={a.status} />
                            <TruthBadge value={a.truth_status} />
                            <PrivacyBadge value={a.privacy_class} />
                            <CandidateBadge value={a.candidate_for_external_bool} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
