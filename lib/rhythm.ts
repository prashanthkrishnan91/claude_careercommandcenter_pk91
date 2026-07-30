import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionItem, GapReport, VisaChecklistItem, WeeklyBrief } from "./entities";
import { createRow, listRows, updateRow } from "./genericRepo";
import { listAchievements } from "./repos";
import { contiguousCompletedGate, jobSearchActionsUnlocked } from "./visa";

// Weekly Operating Loop (v2.1 §14): Friday Capture, Sunday Review, Monthly
// Board, Quarterly Narrative. Candidate actions are drawn deterministically
// from gaps, stale items, and the market-motion requirement — the outward
// action menu respects the current Visa Checklist gate.

export type BriefType = WeeklyBrief["brief_type"];

export function weekOf(date: Date): string {
  // Weeks anchor on Monday.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export async function getOrCreateBrief(
  db: SupabaseClient,
  briefType: BriefType,
  week: string,
  content: string,
): Promise<WeeklyBrief> {
  const existing = await listRows<WeeklyBrief>(db, "weekly_briefs", {
    eq: { week_of: week, brief_type: briefType },
    includeArchived: true,
  });
  if (existing.length > 0) return existing[0];
  return createRow<WeeklyBrief>(db, "weekly_briefs", {
    week_of: week,
    brief_type: briefType,
    content_markdown: content,
  });
}

export async function markBriefReviewed(db: SupabaseClient, id: string): Promise<WeeklyBrief> {
  return updateRow<WeeklyBrief>(db, "weekly_briefs", id, {
    reviewed_at: new Date().toISOString(),
  });
}

export interface CandidateAction {
  title: string;
  rationale: string;
  category: ActionItem["category"];
  outward_facing_bool: boolean;
  visa_gate_required_minimum: number | null;
}

/**
 * Top-5 candidate actions for Sunday Review: gaps from the latest gap
 * reports, stale drafts, visa follow-ups, and at least one outward-facing
 * action drawn from the gate-appropriate market-motion menu.
 */
export async function buildCandidateActions(db: SupabaseClient): Promise<CandidateAction[]> {
  const [gapReports, visaItems, drafts] = await Promise.all([
    listRows<GapReport>(db, "gap_reports", { limit: 3 }),
    listRows<VisaChecklistItem>(db, "visa_checklist_items", {
      orderBy: "ordinal",
      ascending: true,
      includeArchived: true,
    }),
    listAchievements(db, { status: "draft" }),
  ]);
  const gateLevel = contiguousCompletedGate(visaItems);
  const candidates: CandidateAction[] = [];

  for (const report of gapReports) {
    for (const rec of report.recommended_actions.slice(0, 2)) {
      candidates.push({
        title: rec.title,
        rationale: "Surfaced by the Target Role Comparator.",
        category: (rec.category as CandidateAction["category"]) ?? "evidence",
        outward_facing_bool: false,
        visa_gate_required_minimum: null,
      });
    }
  }

  const staleDrafts = drafts.filter(
    (d) => Date.now() - Date.parse(d.updated_at) > 14 * 86400_000,
  );
  if (staleDrafts.length > 0) {
    candidates.push({
      title: `Promote or archive ${staleDrafts.length} stale draft achievement(s)`,
      rationale: "Drafts older than two weeks decay; decide and move on.",
      category: "evidence",
      outward_facing_bool: false,
      visa_gate_required_minimum: null,
    });
  }

  const attorneyPending = visaItems.filter(
    (v) => v.attorney_confirmation_required_bool && v.status !== "complete",
  );
  if (attorneyPending.length > 0 && gateLevel >= 4) {
    candidates.push({
      title: `Schedule attorney touchpoint for Gate ${attorneyPending[0].ordinal}`,
      rationale: "Attorney-gated visa states block downstream actions until confirmed.",
      category: "visa",
      outward_facing_bool: false,
      visa_gate_required_minimum: null,
    });
  }

  // Market-motion requirement: at least one outward-facing action, drawn from
  // the menu permitted at the current gate (v2.1 §14 + A5).
  const outward: CandidateAction = jobSearchActionsUnlocked(gateLevel)
    ? {
        title: "Identify one warm contact at a target company",
        rationale: "Gate 5 cleared: light referral preparation is permitted.",
        category: "outward",
        outward_facing_bool: true,
        visa_gate_required_minimum: 5,
      }
    : {
        title: "Publish one public brand-building LinkedIn post (not job-shopping in tone)",
        rationale: "Outward motion permitted at Gates 1–4; keeps presence warm without signaling intent.",
        category: "outward",
        outward_facing_bool: true,
        visa_gate_required_minimum: null,
      };
  candidates.push(outward);

  while (candidates.length < 5) {
    candidates.push({
      title: "Log one achievement from this week while memory is fresh",
      rationale: "Evidence backfill is the survival metric.",
      category: "evidence",
      outward_facing_bool: false,
      visa_gate_required_minimum: null,
    });
  }
  return candidates.slice(0, 5);
}

export async function saveCandidateActions(
  db: SupabaseClient,
  week: string,
  candidates: CandidateAction[],
): Promise<ActionItem[]> {
  const existing = await listRows<ActionItem>(db, "action_items", { eq: { week_of: week } });
  if (existing.length > 0) return existing;
  const rows: ActionItem[] = [];
  for (const [i, c] of candidates.entries()) {
    rows.push(
      await createRow<ActionItem>(db, "action_items", { ...c, week_of: week, priority_rank: i + 1 }),
    );
  }
  return rows;
}
