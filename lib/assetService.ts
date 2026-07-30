import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetVersion, CareerAsset } from "./entities";
import { createRow, getRow, listRows, updateRow } from "./genericRepo";
import { classifications, gateGraph, resolveSourceGraph, type GraphGate, type SourceGraph } from "./sourceGraph";

// Full asset lifecycle with safety revalidation at EVERY boundary:
// manual authoring, approval, collection membership, and external-use
// logging all re-resolve the complete source graph (generation lives in
// lib/server/assetGeneration.ts — server-only, same gate). Every attempt —
// blocked, unavailable, transport failure, success, approval, external-use
// rejection/success — is persisted to ai_outputs.

export class AssetGateError extends Error {
  constructor(readonly reasons: GraphGate["reasons"]) {
    super(`blocked: ${reasons.map((r) => `${r.label}: ${r.reason}`).join(" | ")}`);
    this.name = "AssetGateError";
  }
}

export async function audit(
  db: SupabaseClient,
  graph: SourceGraph | null,
  outputType: string,
  fields: { model?: string; output?: string; blocked: boolean; reason?: string },
): Promise<void> {
  await createRow(db, "ai_outputs", {
    output_type: outputType,
    model_used: fields.model ?? "",
    input_refs: graph ? graph.sources.map((s) => ({ kind: s.kind, id: s.id, label: s.label })) : [],
    output_text: fields.output ?? "",
    truth_classifications: graph ? classifications(graph) : [],
    blocked_bool: fields.blocked,
    block_reason: fields.reason ?? "",
  });
}

async function markStale(db: SupabaseClient, assetId: string, gate: GraphGate): Promise<void> {
  await updateRow(db, "career_assets", assetId, {
    eligibility_stale_bool: !gate.allowed,
    eligibility_reason: gate.allowed ? "" : gate.reasons.map((r) => `${r.label}: ${r.reason}`).join(" | "),
  });
}

/** Re-resolves the graph, persists staleness, returns the verdict. */
export async function revalidateAsset(
  db: SupabaseClient,
  assetId: string,
  opts: { attestedNoMetricOverride?: boolean } = {},
): Promise<{ graph: SourceGraph; gate: GraphGate }> {
  const graph = await resolveSourceGraph(db, assetId);
  const gate = gateGraph(graph, { attestedNoMetricOverride: opts.attestedNoMetricOverride ?? false });
  await markStale(db, assetId, gate);
  return { graph, gate };
}

async function nextVersionNumber(db: SupabaseClient, assetId: string): Promise<number> {
  const versions = await listRows<AssetVersion>(db, "asset_versions", { eq: { asset_fk: assetId }, includeArchived: true });
  return versions.reduce((m, v) => Math.max(m, v.version_number), 0) + 1;
}

/** Version chain step: insert new → supersede open priors → repoint current. */
export async function commitVersion(
  db: SupabaseClient,
  asset: CareerAsset,
  values: Partial<AssetVersion> & { content?: string },
  derivedPrivacy: string | null,
  truthSummary: string,
): Promise<AssetVersion> {
  const versionNumber = await nextVersionNumber(db, asset.id);
  const version = await createRow<AssetVersion>(db, "asset_versions", { asset_fk: asset.id, version_number: versionNumber, ...values });
  if (!values.blocked_bool) {
    const priors = await listRows<AssetVersion>(db, "asset_versions", { eq: { asset_fk: asset.id }, includeArchived: true });
    for (const p of priors.filter((p) => p.id !== version.id && !p.superseded_by_fk && !p.blocked_bool)) {
      await updateRow(db, "asset_versions", p.id, { superseded_by_fk: version.id });
    }
    await updateRow(db, "career_assets", asset.id, {
      current_version_fk: version.id,
      truth_status_summary: truthSummary,
      ...(derivedPrivacy ? { privacy_class: derivedPrivacy } : {}),
    });
  }
  return version;
}

export async function authorManualVersion(db: SupabaseClient, assetId: string, content: string): Promise<AssetVersion> {
  const { graph, gate } = await revalidateAsset(db, assetId);
  const truthSummary = [...new Set(graph.sources.map((s) => s.truth_status).filter(Boolean))].join(",");
  const version = await commitVersion(db, graph.asset, { content }, gate.allowed ? "PUBLIC_SAFE" : null, truthSummary);
  await audit(db, graph, `asset_${graph.asset.asset_type}_manual`, { blocked: false, output: content });
  return version;
}

export async function approveVersion(db: SupabaseClient, versionId: string): Promise<AssetVersion> {
  const version = await getRow<AssetVersion>(db, "asset_versions", versionId);
  if (!version) throw new Error("version not found");
  if (version.blocked_bool) throw new Error("a blocked version cannot be approved");
  const { graph, gate } = await revalidateAsset(db, version.asset_fk);
  if (!gate.allowed) {
    await audit(db, graph, "asset_approval", { blocked: true, reason: gate.reasons.map((r) => `${r.label}: ${r.reason}`).join(" | ") });
    throw new AssetGateError(gate.reasons);
  }
  const approved = await updateRow<AssetVersion>(db, "asset_versions", versionId, {
    approved_by_user_bool: true,
    approved_at: new Date().toISOString(),
  });
  await audit(db, graph, "asset_approval", { blocked: false, output: `approved v${version.version_number}` });
  return approved;
}

export async function logExternalUse(db: SupabaseClient, assetId: string, destination: string, versionNumber: number): Promise<void> {
  const { graph, gate } = await revalidateAsset(db, assetId);
  if (!gate.allowed) {
    await audit(db, graph, "asset_external_use", { blocked: true, reason: gate.reasons.map((r) => `${r.label}: ${r.reason}`).join(" | ") });
    throw new AssetGateError(gate.reasons);
  }
  await updateRow(db, "career_assets", assetId, {
    used_externally_bool: true,
    external_use_log: [...graph.asset.external_use_log, { at: new Date().toISOString(), destination, version: versionNumber }],
  });
  await audit(db, graph, "asset_external_use", { blocked: false, output: destination });
}

export async function addAssetToCollection(db: SupabaseClient, collectionId: string, assetId: string): Promise<void> {
  const { gate } = await revalidateAsset(db, assetId);
  if (!gate.allowed) throw new AssetGateError(gate.reasons);
  const versions = await listRows<AssetVersion>(db, "asset_versions", { eq: { asset_fk: assetId }, includeArchived: true });
  if (!versions.some((v) => v.approved_by_user_bool)) {
    throw new AssetGateError([{ kind: "asset", id: assetId, label: "asset", reason: "Only assets with an approved version can join a collection." }]);
  }
  await createRow(db, "collection_assets", { collection_fk: collectionId, asset_fk: assetId });
}
