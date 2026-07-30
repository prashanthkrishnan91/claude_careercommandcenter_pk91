"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PrivacyBadge, StatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import RowList from "@/components/RowList";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { archiveRow, createRow, listRows } from "@/lib/genericRepo";
import { addVersionToCollection, approveCollection, AssetGateError, revalidateCollection, setCurrentCollection } from "@/lib/assetService";
import { useVaultData } from "@/lib/hooks";
import { listAchievements } from "@/lib/repos";
import { getSupabase } from "@/lib/supabase";
import type { AssetCollection, AssetVersion, CareerAsset, TargetArchetype } from "@/lib/entities";

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
    const [assets, collections, achievements, archetypes, sourceLinks, memberships, versions] = await Promise.all([
      listRows<CareerAsset>(dbc, "career_assets", { includeArchived: true }),
      listRows<AssetCollection>(dbc, "asset_collections", {}),
      listAchievements(dbc),
      listRows<TargetArchetype>(dbc, "target_archetypes", {}),
      listRows<{ asset_fk: string; achievement_fk: string }>(dbc, "asset_source_achievements", { includeArchived: true }),
      listRows<{ id: string; collection_fk: string; asset_fk: string; version_fk: string; membership_stale_bool: boolean; membership_stale_reason: string }>(dbc, "collection_assets", { includeArchived: true }),
      listRows<AssetVersion>(dbc, "asset_versions", { includeArchived: true }),
    ]);
    return { assets, collections, achievements, archetypes, sourceLinks, memberships, versions };
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
              const created = await createRow<CareerAsset>(db, "career_assets", {
                asset_type: v.asset_type,
                target_archetype_fk: v.target_archetype_fk ?? null,
              });
              if (v.source_achievement) {
                await createRow(db, "asset_source_achievements", {
                  asset_fk: created.id,
                  achievement_fk: v.source_achievement,
                });
              }
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
                  {(data.sourceLinks.filter((l) => l.asset_fk === a.id).map((l) => achName.get(l.achievement_fk) ?? "?").join(" + ")) || "(no sources)"}
                </span>
                {a.eligibility_stale_bool && <span className="font-mono text-[10px] uppercase text-signal-red">stale sources</span>}
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
                  <span className="font-mono text-[10px] text-dim-500">{data.memberships.filter((m) => m.collection_fk === c.id).length} asset(s)</span>
                  {data.memberships.some((m) => m.collection_fk === c.id && m.membership_stale_bool) && (
                    <span className="font-mono text-[10px] uppercase text-signal-red" title="A packaged version or one of its sources changed">stale contents</span>
                  )}
                  {c.approved_by_user_bool ? (
                    <span className="font-mono text-[10px] uppercase text-signal-green">approved</span>
                  ) : (
                    <button
                      className="btn-quiet"
                      onClick={async () => {
                        try {
                          await approveCollection(db, c.id);
                        } catch (e) {
                          window.alert(e instanceof AssetGateError ? e.message : "approval blocked");
                        }
                        bump();
                      }}
                    >
                      approve
                    </button>
                  )}
                  <button
                    className="btn-quiet"
                    title="Re-check every packaged version against its current sources"
                    onClick={async () => {
                      const invalid = await revalidateCollection(db, c.id);
                      if (invalid > 0) window.alert(`${invalid} packaged version(s) are no longer valid.`);
                      bump();
                    }}
                  >
                    revalidate
                  </button>
                  <button
                    className="btn-quiet"
                    title="Collections package an exact approved version"
                    onClick={async () => {
                      const approved = data.versions.filter((v) => v.approved_by_user_bool && !v.blocked_bool);
                      if (approved.length === 0) {
                        window.alert("No approved versions yet — approve one first.");
                        return;
                      }
                      const menu = approved
                        .map((v) => `${achName.get(data.sourceLinks.find((l) => l.asset_fk === v.asset_fk)?.achievement_fk ?? "") ?? "asset"} v${v.version_number}`)
                        .join("\n");
                      const pick = window.prompt(`Package which approved version?\n${menu}`);
                      const chosen = approved.find(
                        (v) =>
                          `${achName.get(data.sourceLinks.find((l) => l.asset_fk === v.asset_fk)?.achievement_fk ?? "") ?? "asset"} v${v.version_number}`.toLowerCase() ===
                          pick?.toLowerCase(),
                      );
                      if (!chosen) return;
                      try {
                        await addVersionToCollection(db, c.id, chosen.id);
                      } catch (e) {
                        window.alert(e instanceof AssetGateError ? e.message : "add failed");
                      }
                      bump();
                    }}
                  >
                    + version
                  </button>
                  {c.current_bool ? (
                    <span className="font-mono text-[10px] uppercase text-signal-green">current</span>
                  ) : (
                    <button
                      className="btn-quiet"
                      title="Revalidates every packaged version before switching"
                      onClick={async () => {
                        try {
                          await setCurrentCollection(db, c.id);
                        } catch (e) {
                          window.alert(e instanceof AssetGateError ? e.message : "cannot become current");
                        }
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
