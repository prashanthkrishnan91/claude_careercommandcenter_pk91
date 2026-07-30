import type { SupabaseClient } from "@supabase/supabase-js";
import type { GapReport, GraderEvaluation, Skill, SkillEvidence, TargetArchetype } from "./entities";
import { createRow, listRows } from "./genericRepo";
import { directorSignal } from "./grader";
import { listAchievements, listMetrics } from "./repos";

// Target Role Comparator — deterministic by design. Coverage is computed from
// stored data (skills, metrics, graded achievements); no AI-generated numbers.
// Runs only against approved archetypes (v2.1 §8).

export interface ComparatorResult {
  covered: Array<{ dimension: string; detail: string }>;
  gaps: Array<{ dimension: string; detail: string }>;
  recommended: Array<{ title: string; category: string }>;
}

export async function runComparator(
  db: SupabaseClient,
  archetype: TargetArchetype,
): Promise<ComparatorResult> {
  if (!archetype.approved_by_user_bool) {
    throw new Error("Comparator runs only against approved archetypes.");
  }
  const [skills, skillEvidence, achievements, metrics, evaluations] = await Promise.all([
    listRows<Skill>(db, "skills", {}),
    listRows<SkillEvidence>(db, "skill_evidence", {}),
    listAchievements(db),
    listMetrics(db),
    listRows<GraderEvaluation>(db, "grader_evaluations", {}),
  ]);

  const covered: ComparatorResult["covered"] = [];
  const gaps: ComparatorResult["gaps"] = [];
  const recommended: ComparatorResult["recommended"] = [];

  const skillNames = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
  const evidencedSkillIds = new Set(
    skillEvidence.filter((se) => se.demonstration_strength_1_to_5 >= 3).map((se) => se.skill_fk),
  );

  for (const required of archetype.required_skills) {
    const name = String(required);
    const skill = skillNames.get(name.toLowerCase());
    if (skill && evidencedSkillIds.has(skill.id)) {
      covered.push({ dimension: `skill: ${name}`, detail: "Demonstrated at strength ≥3." });
    } else {
      gaps.push({
        dimension: `skill: ${name}`,
        detail: skill
          ? "Skill exists but lacks strong linked achievement evidence."
          : "No skill record or evidence in the vault.",
      });
      recommended.push({
        title: `Log or link an achievement demonstrating "${name}"`,
        category: "evidence",
      });
    }
  }

  for (const expected of archetype.expected_metrics) {
    const name = String(expected).toLowerCase();
    const hit = metrics.find((m) => m.metric_name.toLowerCase().includes(name));
    if (hit) {
      covered.push({ dimension: `metric: ${expected}`, detail: `Covered by "${hit.metric_name}".` });
    } else {
      gaps.push({ dimension: `metric: ${expected}`, detail: "No metric of this kind recorded." });
      recommended.push({ title: `Quantify an achievement with a "${expected}" metric`, category: "evidence" });
    }
  }

  const directorSignalCount = evaluations.filter((e) => directorSignal(e.dimensions).qualifies).length;
  for (const signal of archetype.seniority_signals) {
    if (directorSignalCount > 0) {
      covered.push({
        dimension: `seniority: ${signal}`,
        detail: `${directorSignalCount} director-signal achievement(s) on record.`,
      });
    } else {
      gaps.push({ dimension: `seniority: ${signal}`, detail: "No director-signal achievements yet." });
      recommended.push({
        title: "Grade more achievements; strengthen cross-functional/scope evidence",
        category: "archetype",
      });
    }
  }

  for (const scope of archetype.expected_scope) {
    // Scope coverage is judged from promoted (active) achievements existing;
    // finer matching is manual — surfaced honestly as partial coverage.
    if (achievements.some((a) => a.status === "active")) {
      covered.push({ dimension: `scope: ${scope}`, detail: "Active promoted achievements exist; verify scope narrative manually." });
    } else {
      gaps.push({ dimension: `scope: ${scope}`, detail: "No promoted achievements demonstrate this scope." });
      recommended.push({ title: `Promote an achievement demonstrating scope: ${scope}`, category: "evidence" });
    }
  }

  return { covered, gaps, recommended };
}

export async function generateGapReport(
  db: SupabaseClient,
  archetype: TargetArchetype,
): Promise<GapReport> {
  const result = await runComparator(db, archetype);
  return createRow<GapReport>(db, "gap_reports", {
    archetype_fk: archetype.id,
    covered_dimensions: result.covered,
    gap_dimensions: result.gaps,
    recommended_actions: result.recommended,
  });
}
