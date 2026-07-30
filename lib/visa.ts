import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionItem, VisaChecklistItem } from "./entities";
import { createRow, listRows } from "./genericRepo";

// Visa Decision Checklist — the 8-gate model from v2 §6 (unchanged through
// v2.2.2). The app never displays a single "safe to jump" date. Gates 6 and 7
// require attorney confirmation; market motion is gated by checklist state
// (v2.1 §14 + v2.1.1 A5). Nothing here is legal advice: the app records
// state; attorneys interpret law.

export const VISA_GATES: Array<{
  ordinal: number;
  state_name: string;
  attorney_confirmation_required_bool: boolean;
  do_not_act_until_confirmed_bool: boolean;
}> = [
  { ordinal: 1, state_name: "PERM filed with priority date", attorney_confirmation_required_bool: false, do_not_act_until_confirmed_bool: false },
  { ordinal: 2, state_name: "PERM approved", attorney_confirmation_required_bool: false, do_not_act_until_confirmed_bool: false },
  { ordinal: 3, state_name: "I-140 filed", attorney_confirmation_required_bool: false, do_not_act_until_confirmed_bool: false },
  { ordinal: 4, state_name: "I-140 approved", attorney_confirmation_required_bool: false, do_not_act_until_confirmed_bool: false },
  { ordinal: 5, state_name: "I-140 approval + 180 days elapsed (revocation window cleared)", attorney_confirmation_required_bool: false, do_not_act_until_confirmed_bool: false },
  { ordinal: 6, state_name: "Portability strategy reviewed and confirmed by immigration attorney", attorney_confirmation_required_bool: true, do_not_act_until_confirmed_bool: true },
  { ordinal: 7, state_name: "New employer's GC sponsorship and priority date retention commitment confirmed in writing", attorney_confirmation_required_bool: true, do_not_act_until_confirmed_bool: true },
  { ordinal: 8, state_name: "H1B transfer approved at new employer", attorney_confirmation_required_bool: false, do_not_act_until_confirmed_bool: false },
];

/** Creates the user's 8 gates on first visit; returns the full checklist. */
export async function ensureVisaChecklist(db: SupabaseClient): Promise<VisaChecklistItem[]> {
  const existing = await listRows<VisaChecklistItem>(db, "visa_checklist_items", {
    orderBy: "ordinal",
    ascending: true,
    includeArchived: true,
  });
  if (existing.length > 0) return existing;
  for (const gate of VISA_GATES) {
    await createRow(db, "visa_checklist_items", gate);
  }
  return listRows<VisaChecklistItem>(db, "visa_checklist_items", {
    orderBy: "ordinal",
    ascending: true,
    includeArchived: true,
  });
}

/** Highest gate ordinal completed with no earlier gate incomplete. */
export function contiguousCompletedGate(items: VisaChecklistItem[]): number {
  const byOrdinal = [...items].sort((a, b) => a.ordinal - b.ordinal);
  let highest = 0;
  for (const item of byOrdinal) {
    if (item.status === "complete") highest = item.ordinal;
    else break;
  }
  return highest;
}

// Market-motion menus, v2.1 §14 (state-aware) + v2.1.1 A5 (sharpened lists).
export const OUTWARD_ALLOWED_GATES_1_4 = [
  "Thoughtful comments on contacts' posts",
  "Congratulations on promotions, launches, anniversaries",
  "Non-job-seeking check-ins",
  "Sharing useful public content with attribution",
  "General professional engagement (events, public discussion)",
  "Public LinkedIn brand-building posts (not job-shopping in tone)",
  "Public-source archetype research and JD review",
  "Story-bank refinement against archetypes",
  "Resume version updates",
  "Comp benchmark research from public sources",
];

export const OUTWARD_DISALLOWED_GATES_1_4 = [
  "Referral asks of any kind",
  "Recruiter outreach",
  '"Open to opportunities" language anywhere external',
  "Formal applications",
  "Active interview pursuit",
  "Any external signal of intent to leave the current employer",
];

export interface OutwardMenu {
  gateLevel: number;
  allowed: string[];
  stillDisallowed: string[];
}

export function outwardActionMenu(gateLevel: number): OutwardMenu {
  const allowed = [...OUTWARD_ALLOWED_GATES_1_4];
  const stillDisallowed = [...OUTWARD_DISALLOWED_GATES_1_4];
  if (gateLevel >= 5) {
    allowed.push("Light referral preparation (no asks yet)", "Identify warm contacts at target companies");
    stillDisallowed.splice(0, 1); // referral *prep* allowed; asks still not
  }
  if (gateLevel >= 6) {
    allowed.push("Warm outreach for informational conversations", "Explicit referral requests");
  }
  if (gateLevel >= 7) {
    allowed.push("Full active job search", "Formal applications", "Interview prep");
  }
  return { gateLevel, allowed, stillDisallowed: gateLevel >= 7 ? [] : stillDisallowed };
}

/**
 * Whether an outward-facing action is permitted at the current gate level.
 * The user can override (v2.1 §14) — every override is logged by the caller.
 */
export function actionPermitted(action: Pick<ActionItem, "outward_facing_bool" | "visa_gate_required_minimum">, gateLevel: number): boolean {
  if (!action.outward_facing_bool) return true;
  const required = action.visa_gate_required_minimum ?? 0;
  return gateLevel >= required;
}

/** Gate-based rules from v2 §6 “Behavior”. */
export function jobSearchActionsUnlocked(gateLevel: number): boolean {
  return gateLevel >= 5;
}

export function acceptOfferActionsUnlocked(items: VisaChecklistItem[]): boolean {
  const g6 = items.find((i) => i.ordinal === 6);
  const g7 = items.find((i) => i.ordinal === 7);
  return (
    g6?.status === "complete" &&
    g6.attorney_confirmed_at !== null &&
    g7?.status === "complete" &&
    g7.attorney_confirmed_at !== null
  );
}
