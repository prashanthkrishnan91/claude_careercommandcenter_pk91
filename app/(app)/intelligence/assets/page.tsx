"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PrivacyBadge, StatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import RowList from "@/components/RowList";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { archiveRow, createRow, listRows, updateRow } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { listAchievements } from "@/lib/repos";
import { getSupabase } from "@/lib/supabase";
import type { AssetCollection, CareerAsset, TargetArchetype } from "@/lib/entities";

const ASSET_TYPES = ["resume_bullet", "story", "li_post", "cover_letter", "positioning", "interview_answer"] as const;
const COLLECTION_SPECS: FieldSpec[] = [
  { key: "name", label: "Collection name", kind: "text", required: true },
  { key: "collection_type", label: "Type", kind: "select", options: ["resume_version", "interview_pack", "li_profile_draft", "promotion_packet"], required: true },
  { key: "notes", label: "Notes", kind: "textarea", span: 2 },
];

export default function AssetsPage() {
  const router = useRouter();
  const { bump } = useShell();
  const db = getSupabase();
  const loader = useCallback(async (dbc: SupabaseClient) => {
    const [assets, collections, achievements, archetypes] = await Promise.all([
      listRows<CareerAsset>(dbc, "career_assets", { includeArchived: true }),
      listRows<AssetCollection>(dbc, "asset_collections", {}),
      listAchievements(dbc),
      listRows<TargetArchetype>(dbc, "target_archetypes", {}),
    ]);
    return { assets, collections, achievements, archetypes };
  }, []);
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  const ASSET_SPECS: FieldSpec[] = [
    { key: "asset_type", label: "Asset type", kind: "select", options: ASSET_TYPES, required: true },
    { key: "source_achievement", label: "Source achievement", kind: "select", options: data.achievements.map((a) => a.id), required: true },
    { key: "target_archetype_fk", label: "Target archetype (variant)", kind: "select", options: data.archetypes.map((a) => a.id) },
  ];
  const achName = new Map(data.achievements.map((a) => [a.id, a.headline]));
  const archName = new Map(data.archetypes.map((a) => [a.id, a.name]));

  return (
    <main>
      <PageHeader
        crumb="intelligence / career assets"
        title="Assets"
        count={data.assets.length}
        action={
          <SpecAddForm
            title="New asset"
            specs={ASSET_SPECS.map((s) =>
              s.key === "source_achievement"
                ? { ...s, options: data.achievements.map((a) => a.id) }
                : s,
            )}
            onCreate={async (values) => {
              const v = normalizeSpecValues(ASSET_SPECS, values) as Record<string, unknown>;
              await createRow(db, "career_assets", {
                asset_type: v.asset_type,
                source_achievement_refs: v.source_achievement ? [v.source_achievement] : [],
                target_archetype_fk: v.target_archetype_fk ?? null,
              });
              bump();
            }}
          />
        }
      />
      <div className="space-y-8 px-4 py-5 md:px-8">
        {data.assets.length === 0 ? (
          <p className="max-w-xl border border-dashed border-ink-600 px-6 py-8 text-[13px] leading-relaxed text-dim-400">
            No career assets. An asset is generated only from sources that pass the truth/privacy
            gate — VERIFIED or ATTESTED claims, PUBLIC_SAFE only. Blocked generations are recorded
            with the failing claim named.
          </p>
        ) : (
          <RowList<CareerAsset>
            rows={data.assets}
            rowKey={(a) => a.id}
            status={(a) => a.status}
            onOpen={(a) => router.push(`/intelligence/assets/${a.id}`)}
            onArchive={(a) => void archiveRow(db, "career_assets", a.id).then(bump)}
            render={(a) => (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="w-32 font-mono text-[10px] uppercase text-dim-400">{a.asset_type.replace("_", " ")}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">
                  {a.source_achievement_refs.map((r) => achName.get(r) ?? "?").join(" + ") || "(no sources)"}
                </span>
                {a.target_archetype_fk && <span className="text-[11px] text-dim-500">→ {archName.get(a.target_archetype_fk)}</span>}
                {a.used_externally_bool && <span className="font-mono text-[10px] uppercase text-signal-blue">used externally</span>}
                <PrivacyBadge value={a.privacy_class} />
                <StatusBadge value={a.status} />
              </span>
            )}
          />
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="microlabel">collections · {data.collections.length}</h2>
            <SpecAddForm
              title="New collection"
              specs={COLLECTION_SPECS}
              onCreate={async (values) => {
                await createRow(db, "asset_collections", normalizeSpecValues(COLLECTION_SPECS, values));
                bump();
              }}
            />
          </div>
          {data.collections.length === 0 ? (
            <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
              Collections package approved asset versions: resume version, interview pack, LinkedIn profile draft, promotion packet. Exactly one resume version and one profile draft can be current.
            </p>
          ) : (
            <ul className="panel divide-y divide-ink-700/70">
              {data.collections.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                  <span className="w-36 font-mono text-[10px] uppercase text-dim-400">{c.collection_type.replace("_", " ")}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{c.name}</span>
                  <span className="font-mono text-[10px] text-dim-500">{c.asset_refs.length} asset(s)</span>
                  {c.current_bool ? (
                    <span className="font-mono text-[10px] uppercase text-signal-green">current</span>
                  ) : (
                    <button
                      className="btn-quiet"
                      onClick={async () => {
                        // one-current rule: clear the sibling first, then set.
                        for (const sib of data.collections.filter((x) => x.collection_type === c.collection_type && x.current_bool)) {
                          await updateRow(db, "asset_collections", sib.id, { current_bool: false });
                        }
                        await updateRow(db, "asset_collections", c.id, { current_bool: true });
                        bump();
                      }}
                    >
                      make current
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
