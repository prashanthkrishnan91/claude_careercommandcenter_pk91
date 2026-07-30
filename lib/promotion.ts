import type { SupabaseClient } from "@supabase/supabase-js";
import { getAchievement, listEvidenceItems, listMetrics, updateAchievement } from "./repos";
import type { Achievement } from "./types";

// Promotion gate (v2.2 §5, progressive enhancement): a draft achievement is
// promoted to active only when it carries a narrative, at least one metric or
// evidence item, an explicitly affirmed privacy class, and a truth status
// either moved off NEEDS_PROOF or explicitly confirmed to remain there.
// Guidance is calm and specific — never a silent promotion.

export interface PromotionAffirmations {
  /** The user explicitly affirmed the privacy class (not just the default). */
  privacyAffirmed: boolean;
  /** If truth status is still NEEDS_PROOF, the user confirmed it stays. */
  keepNeedsProofConfirmed: boolean;
}

export interface PromotionFacts {
  achievement: Pick<Achievement, "narrative" | "truth_status" | "status">;
  activeMetricCount: number;
  activeEvidenceCount: number;
}

export function missingPromotionRequirements(
  facts: PromotionFacts,
  affirmations: PromotionAffirmations,
): string[] {
  const missing: string[] = [];
  if (facts.achievement.status !== "draft") {
    missing.push("Only a draft can be promoted.");
  }
  if (facts.achievement.narrative.trim() === "") {
    missing.push("Add a narrative — what happened, in your words.");
  }
  if (facts.activeMetricCount + facts.activeEvidenceCount === 0) {
    missing.push("Attach at least one metric or evidence item.");
  }
  if (!affirmations.privacyAffirmed) {
    missing.push("Affirm the privacy class — confirm it, don't leave it as the default.");
  }
  if (facts.achievement.truth_status === "NEEDS_PROOF" && !affirmations.keepNeedsProofConfirmed) {
    missing.push(
      "Move truth status off NEEDS_PROOF, or confirm it stays NEEDS_PROOF for now.",
    );
  }
  return missing;
}

export class PromotionBlockedError extends Error {
  constructor(readonly reasons: string[]) {
    super(`promotion blocked: ${reasons.join(" ")}`);
    this.name = "PromotionBlockedError";
  }
}

export async function promoteAchievement(
  db: SupabaseClient,
  id: string,
  affirmations: PromotionAffirmations,
): Promise<Achievement> {
  const achievement = await getAchievement(db, id);
  if (!achievement) throw new PromotionBlockedError(["Achievement not found."]);
  const [metrics, evidence] = await Promise.all([
    listMetrics(db, { achievementId: id }),
    listEvidenceItems(db, { achievementId: id }),
  ]);
  const missing = missingPromotionRequirements(
    {
      achievement,
      activeMetricCount: metrics.length,
      activeEvidenceCount: evidence.length,
    },
    affirmations,
  );
  if (missing.length > 0) throw new PromotionBlockedError(missing);
  return updateAchievement(db, id, { status: "active" });
}
