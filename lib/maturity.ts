import type { SupabaseClient } from "@supabase/supabase-js";

// Maturity Gates (v2.1 §15). The AUTHORITATIVE computation lives in the
// database (`ccc_recompute_maturity`, SECURITY DEFINER): it derives every
// criterion from real rows, persists a client-read-only `maturity_state`,
// and the P1 write policies check that state (or the logged owner override).
// This module is a thin client over the RPC — there is exactly one
// implementation of the rules.

export interface MaturityCriterion {
  key: string;
  label: string;
  met: boolean;
  detail: string;
}

export interface MaturityState {
  criteria: MaturityCriterion[];
  allMet: boolean;
  overrideActive: boolean;
  unlocked: boolean;
}

const LABELS: Record<string, string> = {
  friday_captures: "4+ consecutive Friday Captures",
  sunday_reviews: "4+ Sunday Reviews with top-3 actions",
  monthly_board: "1+ Monthly Board Review",
  achievements_15: "15+ achievements logged",
  graded_10: "10+ achievements graded",
  director_5: "5+ director-signal achievements",
  sanitized_5: "5+ approved sanitized claims",
  archetypes_2: "2+ approved archetypes (≥1 JD-derived)",
  bullet_per_archetype: "Approved resume bullet per archetype",
  star_story: "Approved STAR story (Leadership or Scope/Scale)",
  collection_current: "Approved current Asset Collection (eligible contents)",
  no_needs_proof: "Zero NEEDS_PROOF/stale sources in approved asset versions",
  no_private_external: "Zero PRIVATE content in external-use logs",
};

const ORDER = Object.keys(LABELS);

export async function computeMaturity(db: SupabaseClient): Promise<MaturityState> {
  const { data, error } = await db.rpc("ccc_recompute_maturity");
  if (error) throw new Error(`maturity recompute failed: ${error.message}`);
  const result = data as {
    unlocked: boolean;
    override_active: boolean;
    criteria: Record<string, { met: boolean; detail: string }>;
  };
  const criteria: MaturityCriterion[] = ORDER.map((key) => ({
    key,
    label: LABELS[key],
    met: result.criteria[key]?.met ?? false,
    detail: result.criteria[key]?.detail ?? "",
  }));
  return {
    criteria,
    allMet: result.unlocked,
    overrideActive: result.override_active,
    unlocked: result.unlocked || result.override_active,
  };
}

/** Owner override — server-enforced: reason required, every change logged. */
export async function setOverride(
  db: SupabaseClient,
  key: "maturity_dev_override" | "market_motion_override",
  enabled: boolean,
  reason: string,
): Promise<void> {
  const { error } = await db.rpc("ccc_set_override", {
    p_key: key,
    p_enabled: enabled,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
