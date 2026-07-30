import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetVersion, CareerAsset } from "./entities";
import { createRow } from "./genericRepo";
import { classifications, gateGraph, resolveSourceGraph, type GraphGate, type SourceGraph } from "./sourceGraph";

// Asset lifecycle. Every SAFETY-CRITICAL transition — version commit,
// approval, collection membership/approval/current selection, external-use
// logging — is performed by a database function that re-derives eligibility
// from `ccc_asset_graph_eligible` inside one transaction. This module calls
// those functions; it never carries the decision itself, so a direct
// PostgREST call cannot reach a different outcome than the UI.

export class AssetGateError extends Error {
  constructor(readonly reasons: GraphGate["reasons"]) {
    super(`blocked: ${reasons.map((r) => `${r.label}: ${r.reason}`).join(" | ")}`);
    this.name = "AssetGateError";
  }
}

/** Reasons reported by the database gate, in the shape the UI already renders. */
export interface DbVerdict {
  eligible: boolean;
  requires_ack: boolean;
  reasons: GraphGate["reasons"];
}

export async function dbGraphVerdict(db: SupabaseClient, assetId: string): Promise<DbVerdict> {
  const { data, error } = await db.rpc("ccc_asset_graph_eligible", { p_asset: assetId });
  if (error) throw new Error(error.message);
  return data as DbVerdict;
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

/**
 * Staleness lives on `career_assets` but is DERIVED — the guard trigger rejects
 * a client that writes it. Ask the database to recompute and persist it.
 */
async function refreshEligibility(db: SupabaseClient, assetId: string): Promise<void> {
  const { error } = await db.rpc("ccc_refresh_asset_eligibility", { p_asset: assetId });
  if (error) throw new Error(error.message);
}

/**
 * Re-resolves the graph for payload building and persists staleness. The
 * verdict returned here is advisory for the UI — the database re-derives it
 * independently inside every lifecycle RPC.
 */
export async function revalidateAsset(
  db: SupabaseClient,
  assetId: string,
  opts: { attestedNoMetricOverride?: boolean } = {},
): Promise<{ graph: SourceGraph; gate: GraphGate }> {
  const graph = await resolveSourceGraph(db, assetId);
  const gate = gateGraph(graph, { attestedNoMetricOverride: opts.attestedNoMetricOverride ?? false });
  await refreshEligibility(db, assetId);
  return { graph, gate };
}

/** Transactional version commit: lock → allocate → insert → supersede → repoint. */
export async function commitVersion(
  db: SupabaseClient,
  asset: CareerAsset,
  values: Partial<AssetVersion> & { content?: string },
  derivedPrivacy: string | null,
  truthSummary: string,
  ack = false,
): Promise<AssetVersion> {
  const { data, error } = await db.rpc("ccc_commit_asset_version", {
    p_asset: asset.id,
    p_content: values.content ?? "",
    p_model: values.generated_by_model ?? "",
    p_prompt_hash: values.generation_prompt_hash ?? "",
    p_blocked: values.blocked_bool ?? false,
    p_block_reason: values.block_reason ?? "",
    p_privacy: derivedPrivacy,
    p_truth_summary: truthSummary,
    p_ack: ack,
  });
  if (error) throw new Error(error.message);
  return data as AssetVersion;
}

export async function authorManualVersion(db: SupabaseClient, assetId: string, content: string): Promise<AssetVersion> {
  const { graph, gate } = await revalidateAsset(db, assetId);
  const truthSummary = [...new Set(graph.sources.map((s) => s.truth_status).filter(Boolean))].join(",");
  // A dedicated RPC: it commits transactionally like generation, and records
  // the version as hand-authored — model and prompt metadata are not
  // caller-supplied and cannot be forged.
  const { data, error } = await db.rpc("ccc_author_manual_version", {
    p_asset: assetId,
    p_content: content,
    p_privacy: gate.allowed ? "PUBLIC_SAFE" : null,
    p_truth_summary: truthSummary,
  });
  if (error) throw new Error(error.message);
  await audit(db, graph, `asset_${graph.asset.asset_type}_manual`, { blocked: false, output: content });
  return data as AssetVersion;
}

function gateErrorFrom(message: string, verdict?: DbVerdict): never {
  if (verdict && !verdict.eligible) throw new AssetGateError(verdict.reasons);
  throw new AssetGateError([{ kind: "asset", id: "", label: "asset", reason: message }]);
}

export async function approveVersion(db: SupabaseClient, versionId: string): Promise<AssetVersion> {
  const { data, error } = await db.rpc("ccc_approve_asset_version", { p_version: versionId });
  if (error) {
    // surface the database's own per-source reasons rather than a raw error
    const version = await db.from("asset_versions").select("asset_fk").eq("id", versionId).maybeSingle();
    const assetFk = (version.data as { asset_fk?: string } | null)?.asset_fk;
    const verdict = assetFk ? await dbGraphVerdict(db, assetFk) : undefined;
    if (assetFk) {
      const graph = await resolveSourceGraph(db, assetFk).catch(() => null);
      await audit(db, graph, "asset_approval", { blocked: true, reason: error.message });
    }
    gateErrorFrom(error.message, verdict);
  }
  const approved = data as AssetVersion;
  const graph = await resolveSourceGraph(db, approved.asset_fk).catch(() => null);
  await audit(db, graph, "asset_approval", { blocked: false, output: `approved v${approved.version_number}` });
  return approved;
}

export async function logExternalUse(db: SupabaseClient, versionId: string, destination: string): Promise<void> {
  const { error } = await db.rpc("ccc_log_external_use", { p_version: versionId, p_destination: destination });
  if (error) {
    const version = await db.from("asset_versions").select("asset_fk").eq("id", versionId).maybeSingle();
    const assetFk = (version.data as { asset_fk?: string } | null)?.asset_fk;
    const verdict = assetFk ? await dbGraphVerdict(db, assetFk) : undefined;
    if (assetFk) {
      const graph = await resolveSourceGraph(db, assetFk).catch(() => null);
      await audit(db, graph, "asset_external_use", { blocked: true, reason: error.message });
    }
    gateErrorFrom(error.message, verdict);
  }
  const version = await db.from("asset_versions").select("asset_fk").eq("id", versionId).maybeSingle();
  const assetFk = (version.data as { asset_fk?: string } | null)?.asset_fk;
  const graph = assetFk ? await resolveSourceGraph(db, assetFk).catch(() => null) : null;
  await audit(db, graph, "asset_external_use", { blocked: false, output: destination });
}

/** Collections package an EXACT approved version, validated by the database. */
export async function addVersionToCollection(db: SupabaseClient, collectionId: string, versionId: string): Promise<void> {
  const { error } = await db.rpc("ccc_add_collection_version", {
    p_collection: collectionId,
    p_version: versionId,
  });
  if (error) gateErrorFrom(error.message);
}

export async function approveCollection(db: SupabaseClient, collectionId: string): Promise<void> {
  const { error } = await db.rpc("ccc_approve_collection", { p_collection: collectionId });
  if (error) gateErrorFrom(error.message);
}

export async function setCurrentCollection(db: SupabaseClient, collectionId: string): Promise<void> {
  const { error } = await db.rpc("ccc_set_current_collection", { p_collection: collectionId });
  if (error) gateErrorFrom(error.message);
}

export async function revalidateCollection(db: SupabaseClient, collectionId: string): Promise<number> {
  const { data, error } = await db.rpc("ccc_revalidate_collection", { p_collection: collectionId });
  if (error) throw new Error(error.message);
  return (data as { invalid: number }).invalid;
}
