"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PrivacyBadge, StatusBadge, TruthBadge } from "@/components/Badges";
import { ProjectNoAchievements } from "@/components/EmptyState";
import { InlineDate, InlineNumber, InlineSelect, InlineTags, InlineText } from "@/components/InlineField";
import PageHeader from "@/components/PageHeader";
import QuickLogBar from "@/components/QuickLogBar";
import { useShell } from "@/components/ShellContext";
import { useVaultData } from "@/lib/hooks";
import { archiveProject, getProject, listAchievements, restoreProject, updateProject } from "@/lib/repos";
import { getSupabase } from "@/lib/supabase";
import { PRIVACY_CLASSES, type ProjectPatch } from "@/lib/types";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { bump } = useShell();

  const loader = useCallback(
    async (db: SupabaseClient) => {
      const [project, achievements] = await Promise.all([
        getProject(db, id),
        listAchievements(db, { projectId: id, includeArchived: true }),
      ]);
      return { project, achievements };
    },
    [id],
  );
  const { data, loading, error } = useVaultData(loader);

  const save = useCallback(async (patch: ProjectPatch) => {
    await updateProject(getSupabase(), id, patch);
  }, [id]);

  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;
  if (!data?.project) return <p className="p-8 text-[13px] text-dim-400">Not in the vault.</p>;
  const p = data.project;
  const live = data.achievements.filter((a) => a.status !== "archived");

  return (
    <main className="px-4 py-5 md:px-8">
      <div className="mb-1 flex items-center justify-between">
        <Link href="/vault" className="microlabel hover:text-dim-300">
          vault / {p.employer || "(no employer)"}
        </Link>
        <button
          className="btn"
          onClick={async () => {
            if (p.status === "archived") await restoreProject(getSupabase(), p.id);
            else await archiveProject(getSupabase(), p.id);
            bump();
          }}
        >
          {p.status === "archived" ? "Restore" : "Archive"} project
        </button>
      </div>

      <InlineText big value={p.name} placeholder="Project name" onSave={(v) => save({ name: v })} />

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <InlineText label="Employer" value={p.employer} onSave={(v) => save({ employer: v })} />
        <InlineText label="Role at the time" value={p.role_at_time} onSave={(v) => save({ role_at_time: v })} />
        <InlineDate label="Started" value={p.start_date} onSave={(v) => save({ start_date: v })} />
        <InlineDate label="Ended" value={p.end_date} onSave={(v) => save({ end_date: v })} />
        <InlineSelect label="Privacy" value={p.privacy_class} options={PRIVACY_CLASSES} onSave={(v) => save({ privacy_class: v })} />
        <InlineNumber label="Team size" value={p.team_size} onSave={(v) => save({ team_size: v })} />
        <div className="col-span-2">
          <InlineTags label="Stakeholders" value={p.stakeholders} onSave={(v) => save({ stakeholders: v })} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <InlineText label="Description" multiline value={p.description} onSave={(v) => save({ description: v })} />
        <InlineText label="Business context" multiline value={p.business_context} placeholder="Why this mattered to the business" onSave={(v) => save({ business_context: v })} />
        <InlineText label="My scope" multiline value={p.my_scope} placeholder="What you personally owned" onSave={(v) => save({ my_scope: v })} />
      </div>

      <section className="mt-8 space-y-3">
        <h2 className="microlabel">achievements · {live.length}</h2>
        <QuickLogBar presetProjectId={p.id} />
        {live.length === 0 ? (
          <ProjectNoAchievements name={p.name} />
        ) : (
          <ul className="panel divide-y divide-ink-700/70">
            {data.achievements.map((a) => (
              <li key={a.id} className={a.status === "archived" ? "row-archived" : ""}>
                <button
                  onClick={() => router.push(`/vault/achievements/${a.id}`)}
                  className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-ink-800/40 ${
                    a.status === "draft" ? "border-l-2 border-dashed border-l-signal-amber/50 italic" : "border-l-2 border-l-transparent"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{a.headline}</span>
                  <StatusBadge value={a.status} />
                  <TruthBadge value={a.truth_status} />
                  <PrivacyBadge value={a.privacy_class} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
