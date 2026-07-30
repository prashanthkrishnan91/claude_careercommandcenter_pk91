"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import RowList from "@/components/RowList";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { archiveRow, createRow, listRows } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase";
import type { TargetArchetype } from "@/lib/entities";

const SPECS: FieldSpec[] = [
  { key: "name", label: "Archetype name", kind: "text", required: true, placeholder: 'e.g. "Director, Analytics @ Tier-1 Tech"' },
  { key: "source_type", label: "Source", kind: "select", options: ["user_defined", "jd_derived", "hybrid"] },
  { key: "required_skills", label: "Required skills", kind: "tags", span: 2 },
  { key: "expected_metrics", label: "Expected metrics", kind: "tags", span: 2 },
  { key: "seniority_signals", label: "Seniority signals", kind: "tags", span: 2 },
];

export default function ArchetypesPage() {
  const router = useRouter();
  const { bump } = useShell();
  const loader = useCallback(
    (db: SupabaseClient) => listRows<TargetArchetype>(db, "target_archetypes", { includeArchived: true }),
    [],
  );
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  return (
    <main>
      <PageHeader
        crumb="intelligence / target archetypes"
        title="Archetypes"
        count={data.length}
        action={
          <SpecAddForm
            title="New archetype"
            specs={SPECS}
            onCreate={async (values) => {
              await createRow(getSupabase(), "target_archetypes", normalizeSpecValues(SPECS, values));
              bump();
            }}
          />
        }
      />
      <div className="px-4 py-5 md:px-8">
        {data.length === 0 ? (
          <p className="max-w-xl border border-dashed border-ink-600 px-6 py-8 text-[13px] leading-relaxed text-dim-400">
            No target archetypes. Author one manually, or create one and paste 5–10 representative
            JDs on its detail page for extraction. The Comparator only runs against archetypes you
            have approved.
          </p>
        ) : (
          <RowList<TargetArchetype>
            rows={data}
            rowKey={(a) => a.id}
            status={(a) => a.status}
            onOpen={(a) => router.push(`/intelligence/archetypes/${a.id}`)}
            onArchive={(a) => void archiveRow(getSupabase(), "target_archetypes", a.id).then(bump)}
            render={(a) => (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{a.name}</span>
                <span className="font-mono text-[10px] uppercase text-dim-500">{a.source_type}</span>
                {a.visa_friendliness_score !== null && (
                  <span className="font-mono text-[10px] text-dim-500">visa {a.visa_friendliness_score}/5</span>
                )}
                <span className={`font-mono text-[10px] uppercase ${a.approved_by_user_bool ? "text-signal-green" : "text-signal-amber"}`}>
                  {a.approved_by_user_bool ? "approved" : "unapproved"}
                </span>
                <StatusBadge value={a.status} />
              </span>
            )}
          />
        )}
      </div>
    </main>
  );
}
