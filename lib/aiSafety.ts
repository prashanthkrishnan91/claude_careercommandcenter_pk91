import type { SupabaseClient } from "@supabase/supabase-js";
import type { SanitizedClaim } from "./entities";
import { listRows } from "./genericRepo";
import { getAchievement, listEvidenceItems, listMetrics } from "./repos";
import type { Achievement, EvidenceItem, Metric, PrivacyClass, TruthStatus } from "./types";

// Truth/privacy enforcement primitives (v2.1 §4, v2 §5).
//
// Rules implemented here and consumed by every AI route BEFORE any model call:
//  1. External assets require truth ∈ {VERIFIED, ATTESTED_WITH_METRIC,
//     ATTESTED_NO_METRIC} AND privacy = PUBLIC_SAFE. ATTESTED_NO_METRIC needs
//     an explicit per-asset override.
//  2. PRIVATE content is never sent verbatim to any external model. A PRIVATE
//     achievement participates only through its approved sanitized claim.
//  3. INTERNAL_ONLY content may be seen by AI for internal analysis (grading)
//     but can never feed an external asset.
//  4. Blocking reasons name the failing claims.

export const EXTERNAL_ELIGIBLE_TRUTH: TruthStatus[] = [
  "VERIFIED",
  "ATTESTED_WITH_METRIC",
  "ATTESTED_NO_METRIC",
];

export interface SourceClassification {
  kind: "achievement" | "metric" | "evidence_item";
  id: string;
  label: string;
  truth_status?: TruthStatus;
  privacy_class: PrivacyClass;
}

export interface BlockReason {
  kind: string;
  id: string;
  label: string;
  reason: string;
}

export interface GateResult {
  allowed: boolean;
  reasons: BlockReason[];
  classifications: SourceClassification[];
}

export function gateExternalAsset(
  sources: SourceClassification[],
  opts: { attestedNoMetricOverride: boolean },
): GateResult {
  const reasons: BlockReason[] = [];
  for (const s of sources) {
    if (s.privacy_class !== "PUBLIC_SAFE") {
      reasons.push({
        kind: s.kind,
        id: s.id,
        label: s.label,
        reason:
          s.privacy_class === "PRIVATE"
            ? "PRIVATE content cannot reach external assets. Sanitize it first (approved sanitized claims are PUBLIC_SAFE)."
            : "Privacy class is INTERNAL_ONLY. Promote it to PUBLIC_SAFE (or sanitize) before external use.",
      });
    }
    if (s.truth_status && !EXTERNAL_ELIGIBLE_TRUTH.includes(s.truth_status)) {
      reasons.push({
        kind: s.kind,
        id: s.id,
        label: s.label,
        reason: `Truth status ${s.truth_status} blocks generation. Attach evidence or attest the claim.`,
      });
    }
    if (s.truth_status === "ATTESTED_NO_METRIC" && !opts.attestedNoMetricOverride) {
      reasons.push({
        kind: s.kind,
        id: s.id,
        label: s.label,
        reason:
          "ATTESTED_NO_METRIC requires an explicit per-asset override acknowledging the claim carries no metric.",
      });
    }
  }
  return { allowed: reasons.length === 0, reasons, classifications: sources };
}

export interface GraderPayloadPart {
  achievement: Achievement;
  /** Text actually sent to the model — sanitized when the source is PRIVATE. */
  narrativeForModel: string;
  metrics: Metric[];
  evidence: EvidenceItem[];
  usedSanitizedClaim: boolean;
}

export interface GraderGate {
  allowed: boolean;
  reasons: BlockReason[];
  payload?: GraderPayloadPart;
  classifications: SourceClassification[];
}

/**
 * Builds the grader payload for one achievement while enforcing the PRIVATE
 * firewall: PRIVATE achievements are gradable only through an approved
 * sanitized claim; their raw text never enters the payload.
 */
export async function buildGraderPayload(db: SupabaseClient, achievementId: string): Promise<GraderGate> {
  const achievement = await getAchievement(db, achievementId);
  if (!achievement) {
    return {
      allowed: false,
      reasons: [{ kind: "achievement", id: achievementId, label: "unknown", reason: "Achievement not found." }],
      classifications: [],
    };
  }
  const [metrics, evidence] = await Promise.all([
    listMetrics(db, { achievementId }),
    listEvidenceItems(db, { achievementId }),
  ]);
  const classifications: SourceClassification[] = [
    {
      kind: "achievement",
      id: achievement.id,
      label: achievement.headline,
      truth_status: achievement.truth_status,
      privacy_class: achievement.privacy_class,
    },
  ];

  const visibleMetrics = metrics.filter((m) => m.privacy_class !== "PRIVATE");
  const visibleEvidence = evidence.filter((e) => e.privacy_class !== "PRIVATE");

  if (achievement.privacy_class !== "PRIVATE") {
    return {
      allowed: true,
      reasons: [],
      classifications,
      payload: {
        achievement,
        narrativeForModel: [
          `Headline: ${achievement.headline}`,
          `Narrative: ${achievement.narrative}`,
          `Action taken: ${achievement.action_taken}`,
          `Outcome: ${achievement.outcome}`,
        ].join("\n"),
        metrics: visibleMetrics,
        evidence: visibleEvidence,
        usedSanitizedClaim: false,
      },
    };
  }

  // PRIVATE achievement: only an approved sanitized claim may represent it.
  const claims = await listRows<SanitizedClaim>(db, "sanitized_claims", {
    eq: { source_achievement_fk: achievementId },
  });
  const approved = claims.find((c) => c.user_approved_at !== null);
  if (!approved) {
    return {
      allowed: false,
      classifications,
      reasons: [
        {
          kind: "achievement",
          id: achievement.id,
          label: achievement.headline,
          reason:
            "This achievement is PRIVATE. Raw private text never reaches a model — create and approve a sanitized claim first.",
        },
      ],
    };
  }
  return {
    allowed: true,
    reasons: [],
    classifications,
    payload: {
      achievement,
      narrativeForModel: `Sanitized claim (approved): ${approved.sanitized_public_text}`,
      metrics: [],
      evidence: [],
      usedSanitizedClaim: true,
    },
  };
}

/**
 * Collects classifications + model-safe text for asset generation sources.
 * PRIVATE sources are replaced by approved sanitized claims when available;
 * otherwise they surface as blocking reasons via gateExternalAsset.
 */
export async function collectAssetSources(
  db: SupabaseClient,
  achievementIds: string[],
): Promise<{
  classifications: SourceClassification[];
  texts: string[];
  substitutions: Array<{ achievementId: string; claimId: string }>;
}> {
  const classifications: SourceClassification[] = [];
  const texts: string[] = [];
  const substitutions: Array<{ achievementId: string; claimId: string }> = [];
  for (const id of achievementIds) {
    const a = await getAchievement(db, id);
    if (!a) continue;
    if (a.privacy_class === "PRIVATE") {
      const claims = await listRows<SanitizedClaim>(db, "sanitized_claims", {
        eq: { source_achievement_fk: id },
      });
      const approved = claims.find((c) => c.user_approved_at !== null);
      if (approved) {
        substitutions.push({ achievementId: id, claimId: approved.id });
        classifications.push({
          kind: "achievement",
          id: a.id,
          label: `${a.headline} (via approved sanitized claim)`,
          truth_status: a.truth_status,
          privacy_class: "PUBLIC_SAFE",
        });
        texts.push(approved.sanitized_public_text);
        continue;
      }
    }
    classifications.push({
      kind: "achievement",
      id: a.id,
      label: a.headline,
      truth_status: a.truth_status,
      privacy_class: a.privacy_class,
    });
    texts.push(
      `${a.headline}\n${a.narrative}\nAction: ${a.action_taken}\nOutcome: ${a.outcome}`,
    );
    const metrics = await listMetrics(db, { achievementId: id });
    for (const m of metrics.filter((x) => x.privacy_class !== "PRIVATE")) {
      texts.push(`Metric: ${m.metric_name} = ${m.value} ${m.unit} (${m.time_period})`);
    }
  }
  return { classifications, texts, substitutions };
}
