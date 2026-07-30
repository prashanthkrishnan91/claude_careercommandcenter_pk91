import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssetCollection,
  AssetVersion,
  CareerAsset,
  GraderEvaluation,
  SanitizedClaim,
  StoryBankEntry,
  TargetArchetype,
  WeeklyBrief,
  ActionItem,
} from "./entities";
import { listRows } from "./genericRepo";
import { directorSignal } from "./grader";
import { getAchievement, listAchievements } from "./repos";

// Maturity Gates (v2.1 §15): P1 distribution surfaces unlock only when all
// criteria are simultaneously true — computed from real stored data, never
// fabricated. An owner-only development override exists for validation; it is
// visibly labeled and every use is logged (owner_overrides).

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

function consecutiveWeeks(dates: string[]): number {
  if (dates.length === 0) return 0;
  const weeks = [...new Set(dates)].sort().reverse();
  let run = 1;
  for (let i = 1; i < weeks.length; i++) {
    const prev = new Date(`${weeks[i - 1]}T00:00:00Z`).getTime();
    const cur = new Date(`${weeks[i]}T00:00:00Z`).getTime();
    if (prev - cur === 7 * 86400_000) run += 1;
    else break;
  }
  return run;
}

export async function computeMaturity(db: SupabaseClient): Promise<MaturityState> {
  const [briefs, actions, achievements, evaluations, claims, archetypes, assets, versions, collections, stories, overrides] =
    await Promise.all([
      listRows<WeeklyBrief>(db, "weekly_briefs", { includeArchived: true }),
      listRows<ActionItem>(db, "action_items", { includeArchived: true }),
      listAchievements(db, { includeArchived: true }),
      listRows<GraderEvaluation>(db, "grader_evaluations", {}),
      listRows<SanitizedClaim>(db, "sanitized_claims", {}),
      listRows<TargetArchetype>(db, "target_archetypes", {}),
      listRows<CareerAsset>(db, "career_assets", {}),
      listRows<AssetVersion>(db, "asset_versions", { includeArchived: true }),
      listRows<AssetCollection>(db, "asset_collections", {}),
      listRows<StoryBankEntry>(db, "story_bank", {}),
      listRows<{ id: string; override_key: string; enabled_bool: boolean }>(db, "owner_overrides", {
        includeArchived: true,
      }),
    ]);

  const fridays = briefs.filter((b) => b.brief_type === "friday_capture" && b.reviewed_at);
  const sundays = briefs.filter((b) => b.brief_type === "sunday_review" && b.reviewed_at);
  const sundaysWithTop3 = sundays.filter(
    (s) => actions.filter((a) => a.week_of === s.week_of && a.status !== "candidate" && a.status !== "archived").length >= 3,
  );
  const monthlies = briefs.filter((b) => b.brief_type === "monthly_board" && b.reviewed_at);

  const logged = achievements.filter((a) => a.status !== "archived");
  const gradedIds = new Set(evaluations.map((e) => e.achievement_fk));
  const directorSignalCount = new Set(
    evaluations.filter((e) => directorSignal(e.dimensions).qualifies).map((e) => e.achievement_fk),
  ).size;
  const approvedClaims = claims.filter((c) => c.user_approved_at !== null);
  const approvedArchetypes = archetypes.filter((a) => a.approved_by_user_bool);
  const jdDerived = approvedArchetypes.filter((a) => a.source_type !== "user_defined");

  const approvedVersionByAsset = new Map<string, AssetVersion[]>();
  for (const v of versions.filter((v) => v.approved_by_user_bool)) {
    const list = approvedVersionByAsset.get(v.asset_fk) ?? [];
    list.push(v);
    approvedVersionByAsset.set(v.asset_fk, list);
  }
  const bulletPerArchetype = approvedArchetypes.every((arch) =>
    assets.some(
      (a) =>
        a.asset_type === "resume_bullet" &&
        a.target_archetype_fk === arch.id &&
        approvedVersionByAsset.has(a.id),
    ),
  );
  const starStory = stories.some(
    (s) =>
      (s.theme === "leadership" || s.theme === "scale") &&
      s.situation.trim() && s.task.trim() && s.action.trim() && s.result.trim(),
  );
  const approvedCurrentCollection = collections.some(
    (c) =>
      c.current_bool &&
      (c.collection_type === "resume_version" || c.collection_type === "interview_pack"),
  );

  // Truth/privacy hygiene over approved asset versions.
  let needsProofInApproved = false;
  let privateInExternalUse = false;
  for (const asset of assets) {
    const approved = approvedVersionByAsset.get(asset.id);
    if (!approved || approved.length === 0) continue;
    for (const achId of asset.source_achievement_refs) {
      const a = await getAchievement(db, achId);
      if (a?.truth_status === "NEEDS_PROOF") needsProofInApproved = true;
      if (a?.privacy_class === "PRIVATE" && asset.external_use_log.length > 0) {
        privateInExternalUse = true;
      }
    }
  }

  const criteria: MaturityCriterion[] = [
    { key: "friday_captures", label: "4+ consecutive Friday Captures", met: consecutiveWeeks(fridays.map((b) => b.week_of)) >= 4, detail: `${consecutiveWeeks(fridays.map((b) => b.week_of))} consecutive completed` },
    { key: "sunday_reviews", label: "4+ Sunday Reviews with top-3 actions", met: sundaysWithTop3.length >= 4, detail: `${sundaysWithTop3.length} completed with selections` },
    { key: "monthly_board", label: "1+ Monthly Board Review", met: monthlies.length >= 1, detail: `${monthlies.length} completed` },
    { key: "achievements_15", label: "15+ achievements logged", met: logged.length >= 15, detail: `${logged.length} logged` },
    { key: "graded_10", label: "10+ achievements graded", met: gradedIds.size >= 10, detail: `${gradedIds.size} graded` },
    { key: "director_5", label: "5+ director-signal achievements", met: directorSignalCount >= 5, detail: `${directorSignalCount} qualify` },
    { key: "sanitized_5", label: "5+ approved sanitized claims", met: approvedClaims.length >= 5, detail: `${approvedClaims.length} approved` },
    { key: "archetypes_2", label: "2+ approved archetypes (≥1 JD-derived)", met: approvedArchetypes.length >= 2 && jdDerived.length >= 1, detail: `${approvedArchetypes.length} approved, ${jdDerived.length} JD-derived` },
    { key: "bullet_per_archetype", label: "Approved resume bullet per archetype", met: approvedArchetypes.length > 0 && bulletPerArchetype, detail: bulletPerArchetype && approvedArchetypes.length > 0 ? "covered" : "missing for at least one archetype" },
    { key: "star_story", label: "Approved STAR story (Leadership or Scope/Scale)", met: starStory, detail: starStory ? "present" : "none yet" },
    { key: "collection_current", label: "Approved current Asset Collection", met: approvedCurrentCollection, detail: approvedCurrentCollection ? "present" : "none current" },
    { key: "no_needs_proof", label: "Zero NEEDS_PROOF in approved asset versions", met: !needsProofInApproved, detail: needsProofInApproved ? "violation present" : "clean" },
    { key: "no_private_external", label: "Zero PRIVATE content in external-use logs", met: !privateInExternalUse, detail: privateInExternalUse ? "violation present" : "clean" },
  ];

  const allMet = criteria.every((c) => c.met);
  const overrideActive = overrides.some(
    (o) => o.override_key === "maturity_dev_override" && o.enabled_bool,
  );
  return { criteria, allMet, overrideActive, unlocked: allMet || overrideActive };
}
