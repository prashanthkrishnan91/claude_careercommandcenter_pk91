import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerAsset, SanitizedClaim, TargetArchetype } from "./entities";
import { getRow, listRows } from "./genericRepo";
import { getAchievement, getEvidenceItem, getMetric } from "./repos";
import type { PrivacyClass, TruthStatus } from "./types";

// Canonical source-resolution service. It builds the outbound PAYLOAD; the
// database function `ccc_asset_graph_eligible` is the AUTHORITY for the same
// rules and gates every lifecycle transition (approval, collection membership,
// external use) regardless of what any client believes. The two implement one
// policy and are pinned to agreement by tests/graphParity.test.ts.
//
// Each source is classified by ITS OWN truth/privacy rules; missing or dangling
// references block rather than silently disappear.
//
// EVIDENCE VERIFICATION POLICY (canonical): an evidence item enters an external
// payload only when it is active, PUBLIC_SAFE, AND carries both a verification
// timestamp and a verifier. PUBLIC_SAFE is a privacy statement, not a proof
// statement — unverified evidence is exactly the material that must not be put
// in front of an external audience.
//
// ARCHETYPE POLICY: targeting an archetype requires that archetype to be active
// and user-approved. Only approved parsed configuration travels; raw retained
// JD text (archetype_sources.raw_content) never enters a payload.

export const EXTERNAL_ELIGIBLE_TRUTH: TruthStatus[] = [
  "VERIFIED",
  "ATTESTED_WITH_METRIC",
  "ATTESTED_NO_METRIC",
];

/** The canonical evidence-verification predicate (one definition, used twice). */
export function evidenceIsVerified(e: { verified_at: string | null; verified_by: string | null }): boolean {
  return e.verified_at !== null && Boolean(e.verified_by);
}

export interface ResolvedSource {
  kind: "achievement" | "metric" | "evidence_item" | "archetype";
  id: string;
  label: string;
  truth_status?: TruthStatus;
  privacy_class?: PrivacyClass;
  /** approved sanitized claim id substituted for PRIVATE content */
  substituted_claim_id: string | null;
  /** text that may enter a model payload — ONLY when eligible */
  text: string;
  eligible: boolean;
  reason: string; // empty when eligible
  requires_no_metric_override: boolean;
}

export interface SourceGraph {
  asset: CareerAsset;
  sources: ResolvedSource[];
}

async function approvedClaimFor(
  db: SupabaseClient,
  col: "source_achievement_fk" | "source_metric_fk",
  id: string,
): Promise<SanitizedClaim | null> {
  const claims = await listRows<SanitizedClaim>(db, "sanitized_claims", { eq: { [col]: id } });
  return claims.find((c) => c.user_approved_at !== null) ?? null;
}

export async function resolveSourceGraph(db: SupabaseClient, assetId: string): Promise<SourceGraph> {
  const asset = await getRow<CareerAsset>(db, "career_assets", assetId);
  if (!asset) throw new Error("asset not found");
  const [achJ, evJ, metJ] = await Promise.all([
    listRows<{ achievement_fk: string; created_at: string }>(db, "asset_source_achievements", { eq: { asset_fk: assetId }, includeArchived: true, orderBy: "created_at", ascending: true }),
    listRows<{ evidence_fk: string; created_at: string }>(db, "asset_source_evidence", { eq: { asset_fk: assetId }, includeArchived: true, orderBy: "created_at", ascending: true }),
    listRows<{ metric_fk: string; created_at: string }>(db, "asset_source_metrics", { eq: { asset_fk: assetId }, includeArchived: true, orderBy: "created_at", ascending: true }),
  ]);
  const sources: ResolvedSource[] = [];

  for (const j of achJ) {
    const a = await getAchievement(db, j.achievement_fk);
    if (!a) {
      sources.push({ kind: "achievement", id: j.achievement_fk, label: "(missing achievement)", substituted_claim_id: null, text: "", eligible: false, reason: "Dangling reference: source achievement no longer resolves.", requires_no_metric_override: false });
      continue;
    }
    const base = { kind: "achievement" as const, id: a.id, label: a.headline, truth_status: a.truth_status, privacy_class: a.privacy_class };
    if (a.status === "archived") {
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: "Source achievement is archived.", requires_no_metric_override: false });
      continue;
    }
    if (!EXTERNAL_ELIGIBLE_TRUTH.includes(a.truth_status)) {
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: `Truth status ${a.truth_status} blocks generation. Attach evidence or attest the claim.`, requires_no_metric_override: false });
      continue;
    }
    const needsOverride = a.truth_status === "ATTESTED_NO_METRIC";
    if (a.privacy_class === "PRIVATE") {
      const claim = await approvedClaimFor(db, "source_achievement_fk", a.id);
      if (!claim) {
        sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: "PRIVATE content cannot reach external assets. Approve a sanitized claim first.", requires_no_metric_override: false });
      } else {
        // The approved claim REPLACES the private text entirely.
        sources.push({ ...base, substituted_claim_id: claim.id, text: `Sanitized claim (approved): ${claim.sanitized_public_text}`, eligible: true, reason: "", requires_no_metric_override: needsOverride });
      }
      continue;
    }
    if (a.privacy_class !== "PUBLIC_SAFE") {
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: "Privacy class INTERNAL_ONLY blocks external use. Promote to PUBLIC_SAFE or sanitize.", requires_no_metric_override: false });
      continue;
    }
    sources.push({ ...base, substituted_claim_id: null, text: `${a.headline}\n${a.narrative}\nAction: ${a.action_taken}\nOutcome: ${a.outcome}`, eligible: true, reason: "", requires_no_metric_override: needsOverride });
  }

  for (const j of metJ) {
    const m = await getMetric(db, j.metric_fk);
    if (!m) {
      sources.push({ kind: "metric", id: j.metric_fk, label: "(missing metric)", substituted_claim_id: null, text: "", eligible: false, reason: "Dangling reference: source metric no longer resolves.", requires_no_metric_override: false });
      continue;
    }
    const base = { kind: "metric" as const, id: m.id, label: m.metric_name, truth_status: m.truth_status, privacy_class: m.privacy_class };
    if (m.status === "archived") {
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: "Source metric is archived.", requires_no_metric_override: false });
      continue;
    }
    if (!EXTERNAL_ELIGIBLE_TRUTH.includes(m.truth_status)) {
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: `Metric truth status ${m.truth_status} blocks generation.`, requires_no_metric_override: false });
      continue;
    }
    if (m.privacy_class === "PRIVATE") {
      const claim = await approvedClaimFor(db, "source_metric_fk", m.id);
      if (!claim) {
        sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: "PRIVATE metric cannot reach external assets. Approve a sanitized claim first.", requires_no_metric_override: false });
      } else {
        sources.push({ ...base, substituted_claim_id: claim.id, text: `Sanitized claim (approved): ${claim.sanitized_public_text}`, eligible: true, reason: "", requires_no_metric_override: m.truth_status === "ATTESTED_NO_METRIC" });
      }
      continue;
    }
    if (m.privacy_class !== "PUBLIC_SAFE") {
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: "Metric privacy INTERNAL_ONLY blocks external use.", requires_no_metric_override: false });
      continue;
    }
    sources.push({ ...base, substituted_claim_id: null, text: `Metric: ${m.metric_name} = ${m.value}${m.unit ? ` ${m.unit}` : ""}${m.time_period ? ` (${m.time_period})` : ""}${m.baseline_value ? `, baseline ${m.baseline_value}` : ""}${m.calculation_notes ? `. Calculation: ${m.calculation_notes}` : ""}`, eligible: true, reason: "", requires_no_metric_override: m.truth_status === "ATTESTED_NO_METRIC" });
  }

  for (const j of evJ) {
    const e = await getEvidenceItem(db, j.evidence_fk);
    if (!e) {
      sources.push({ kind: "evidence_item", id: j.evidence_fk, label: "(missing evidence)", substituted_claim_id: null, text: "", eligible: false, reason: "Dangling reference: source evidence no longer resolves.", requires_no_metric_override: false });
      continue;
    }
    const base = { kind: "evidence_item" as const, id: e.id, label: e.content_summary.slice(0, 80), privacy_class: e.privacy_class };
    if (e.status === "archived") {
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: "Source evidence is archived.", requires_no_metric_override: false });
    } else if (e.privacy_class !== "PUBLIC_SAFE") {
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: `Evidence privacy ${e.privacy_class} blocks external use.`, requires_no_metric_override: false });
    } else if (!evidenceIsVerified(e)) {
      // PUBLIC_SAFE is not proof: unverified evidence never reaches a payload.
      sources.push({ ...base, substituted_claim_id: null, text: "", eligible: false, reason: "Unverified evidence cannot enter an external payload. Record who verified it and when.", requires_no_metric_override: false });
    } else {
      sources.push({ ...base, substituted_claim_id: null, text: `Evidence (${e.type}, verified by ${e.verified_by}): ${e.content_summary}`, eligible: true, reason: "", requires_no_metric_override: false });
    }
  }

  if (asset.target_archetype_fk) {
    const arch = await getRow<TargetArchetype>(db, "target_archetypes", asset.target_archetype_fk);
    if (!arch) {
      sources.push({ kind: "archetype", id: asset.target_archetype_fk, label: "(missing archetype)", substituted_claim_id: null, text: "", eligible: false, reason: "Dangling reference: target archetype no longer resolves.", requires_no_metric_override: false });
    } else if (arch.status === "archived") {
      sources.push({ kind: "archetype", id: arch.id, label: arch.name, substituted_claim_id: null, text: "", eligible: false, reason: "Target archetype is archived.", requires_no_metric_override: false });
    } else if (!arch.approved_by_user_bool) {
      sources.push({ kind: "archetype", id: arch.id, label: arch.name, substituted_claim_id: null, text: "", eligible: false, reason: "Target archetype must be user-approved before it can shape an external asset.", requires_no_metric_override: false });
    } else {
      // Only APPROVED PARSED configuration travels. Raw retained JD text
      // (archetype_sources.raw_content) is never read here by construction.
      sources.push({ kind: "archetype", id: arch.id, label: arch.name, substituted_claim_id: null, text: `Target role context: ${arch.name}. Emphasize: ${arch.required_skills.join(", ")}.`, eligible: true, reason: "", requires_no_metric_override: false });
    }
  }
  return { asset, sources };
}

export interface GraphGate {
  allowed: boolean;
  reasons: Array<{ kind: string; id: string; label: string; reason: string }>;
}

export function gateGraph(graph: SourceGraph, opts: { attestedNoMetricOverride: boolean }): GraphGate {
  const reasons: GraphGate["reasons"] = [];
  const claimLike = graph.sources.filter((s) => s.kind !== "archetype");
  if (claimLike.length === 0) {
    reasons.push({ kind: "asset", id: graph.asset.id, label: "asset", reason: "Asset has no source claims." });
  }
  for (const s of graph.sources) {
    if (!s.eligible) reasons.push({ kind: s.kind, id: s.id, label: s.label, reason: s.reason });
    else if (s.requires_no_metric_override && !opts.attestedNoMetricOverride) {
      reasons.push({ kind: s.kind, id: s.id, label: s.label, reason: "ATTESTED_NO_METRIC requires the explicit per-generation override." });
    }
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Deterministic payload manifest — the ONLY text allowed toward a model. */
export function buildPayloadManifest(graph: SourceGraph, gate: GraphGate): string[] {
  if (!gate.allowed) return [];
  return graph.sources.filter((s) => s.eligible).map((s) => s.text);
}

export function classifications(graph: SourceGraph) {
  return graph.sources.map((s) => ({
    kind: s.kind,
    id: s.id,
    label: s.label,
    truth_status: s.truth_status,
    privacy_class: s.privacy_class,
    substituted_claim_id: s.substituted_claim_id,
    eligible: s.eligible,
    reason: s.reason,
  }));
}
