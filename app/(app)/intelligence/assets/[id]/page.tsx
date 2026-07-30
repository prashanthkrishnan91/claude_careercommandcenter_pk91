"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/PageHeader";
import { useShell } from "@/components/ShellContext";
import { postApi } from "@/lib/apiClient";
import { approveVersion, authorManualVersion, logExternalUse, AssetGateError } from "@/lib/assetService";
import { getRow, listRows } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { getAchievement } from "@/lib/repos";
import { getSupabase } from "@/lib/supabase";
import type { AssetExternalUse, AssetVersion, CareerAsset } from "@/lib/entities";
import type { Achievement } from "@/lib/types";

// Asset detail: versioned, append-only history with approval gating,
// supersession links, external-use logging, and gated generation.

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { bump } = useShell();
  const db = getSupabase();
  const [override, setOverride] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loader = useCallback(
    async (dbc: SupabaseClient) => {
      const asset = await getRow<CareerAsset>(dbc, "career_assets", id);
      const versions = await listRows<AssetVersion>(dbc, "asset_versions", {
        eq: { asset_fk: id },
        orderBy: "version_number",
        ascending: false,
        includeArchived: true,
      });
      const links = await listRows<{ achievement_fk: string }>(dbc, "asset_source_achievements", {
        eq: { asset_fk: id },
        includeArchived: true,
      });
      const sources: Achievement[] = [];
      for (const link of links) {
        const a = await getAchievement(dbc, link.achievement_fk);
        if (a) sources.push(a);
      }
      const uses = await listRows<AssetExternalUse>(dbc, "asset_external_uses", {
        eq: { asset_fk: id },
        includeArchived: true,
        orderBy: "used_at",
        ascending: false,
      });
      return { asset, versions, sources, uses };
    },
    [id],
  );
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data?.asset) return <p className="p-8 text-[13px] text-signal-red">{error ?? "Not found."}</p>;
  const asset = data.asset;

  async function generate() {
    setBusy(true);
    setNotice(null);
    const res = await postApi<{ blocked?: boolean; reasons?: Array<{ label: string; reason: string }>; unavailable?: boolean; message?: string; error?: string }>(
      "/api/ai/generate-asset",
      { assetId: id, attestedNoMetricOverride: override, guidance: guidance || undefined },
    );
    setBusy(false);
    if (res.status === 200) bump();
    else if (res.json.blocked) {
      setNotice(`Blocked — ${res.json.reasons?.map((r) => `${r.label}: ${r.reason}`).join(" | ")}`);
      bump(); // the blocked version + audit row now exist
    } else setNotice(res.json.message ?? res.json.error ?? "generation failed");
  }

  return (
    <main>
      <PageHeader crumb="intelligence / assets" title={asset.asset_type.replace("_", " ")} />
      <div className="space-y-6 px-4 py-5 md:px-8">
        {asset.eligibility_stale_bool && (
          <p className="border-l-2 border-signal-red pl-2 text-[12px] text-signal-red">
            Stale: {asset.eligibility_reason || "a source became ineligible after generation"} — approval and external use are blocked until resolved.
          </p>
        )}
        <section className="panel p-4">
          <h2 className="microlabel mb-2">sources · the full graph is revalidated on every generation, approval, and external use</h2>
          {data.sources.length === 0 ? (
            <p className="text-[12px] text-dim-500">No source achievements.</p>
          ) : (
            <ul className="space-y-1">
              {data.sources.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-3 text-[12px]">
                  <Link href={`/vault/achievements/${s.id}`} className="min-w-0 flex-1 truncate text-dim-200 hover:text-signal-blue">{s.headline}</Link>
                  <span className="font-mono text-[10px] uppercase text-dim-500">{s.truth_status} · {s.privacy_class}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-ink-700 pt-3">
            <input
              className="field-input flex-1"
              placeholder="Optional guidance for this generation"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
            />
            <label className="flex items-center gap-2 text-[12px] text-dim-300" title="ATTESTED_NO_METRIC sources require this explicit acknowledgment">
              <input type="checkbox" className="accent-[#5b9dff]" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              ATTESTED_NO_METRIC override
            </label>
            <button className="btn-primary" disabled={busy} onClick={() => void generate()}>
              {busy ? "Generating…" : "Generate version"}
            </button>
          </div>
          {notice && <p className="mt-2 border-l-2 border-signal-amber pl-2 text-[12px] text-signal-amber">{notice}</p>}
        </section>

        <section>
          <h2 className="microlabel mb-2">versions · immutable, append-only</h2>
          {data.versions.length === 0 ? (
            <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">No versions yet.</p>
          ) : (
            <div className="space-y-2">
              {data.versions.map((v) => (
                <div key={v.id} className={`panel p-4 ${v.blocked_bool ? "border-signal-red/40" : ""}`}>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-mono text-[12px] text-dim-100">v{v.version_number}</span>
                    {v.id === asset.current_version_fk && <span className="font-mono text-[10px] uppercase text-signal-blue">current</span>}
                    {v.blocked_bool && <span className="font-mono text-[10px] uppercase text-signal-red">blocked</span>}
                    {v.approved_by_user_bool && <span className="font-mono text-[10px] uppercase text-signal-green">approved {v.approved_at?.slice(0, 10)}</span>}
                    {v.superseded_by_fk && <span className="font-mono text-[10px] uppercase text-dim-500">superseded</span>}
                    <span className="font-mono text-[10px] text-dim-500">{v.generated_by_model || "manual"} · {v.generation_prompt_hash.slice(0, 8) || "—"}</span>
                    <span className="flex-1" />
                    {!v.blocked_bool && !v.approved_by_user_bool && (
                      <button
                        className="btn"
                        onClick={async () => {
                          try {
                            await approveVersion(db, v.id);
                          } catch (e) {
                            setNotice(e instanceof AssetGateError ? e.message : e instanceof Error ? e.message : "approval failed");
                          }
                          bump();
                        }}
                      >
                        Approve
                      </button>
                    )}
                    {v.approved_by_user_bool && v.id === asset.current_version_fk && (
                      <button
                        className="btn-quiet"
                        title="Log an external use of this approved current version"
                        onClick={async () => {
                          const destination = window.prompt("Where was this used? (application, LinkedIn, …)");
                          if (!destination) return;
                          try {
                            await logExternalUse(db, v.id, destination);
                          } catch (e) {
                            setNotice(e instanceof AssetGateError ? e.message : "external use blocked");
                          }
                          bump();
                        }}
                      >
                        log external use
                      </button>
                    )}
                  </div>
                  <p className={`mt-2 whitespace-pre-wrap text-[13px] leading-relaxed ${v.blocked_bool ? "text-signal-red/80" : "text-dim-200"}`}>
                    {v.blocked_bool ? v.block_reason : v.content}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <button
              className="btn"
              onClick={async () => {
                const content = window.prompt("Manual version content (authored by you, no AI):");
                if (!content) return;
                await authorManualVersion(db, asset.id, content);
                bump();
              }}
            >
              + Author version manually
            </button>
          </div>
        </section>

        {data.uses.length > 0 && (
          <section>
            <h2 className="microlabel mb-2">external use log · immutable records, version-exact</h2>
            <ul className="panel divide-y divide-ink-700/70">
              {data.uses.map((u) => (
                <li key={u.id} className="flex gap-3 px-4 py-2 font-mono text-[11px] text-dim-300">
                  <span>{u.used_at.slice(0, 10)}</span>
                  <span>v{data.versions.find((v) => v.id === u.version_fk)?.version_number ?? "?"}</span>
                  <span className="text-dim-400">{u.destination}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
