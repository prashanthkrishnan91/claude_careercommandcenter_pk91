import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPgliteBackend } from "./backends/pglite";
import type { TestBackend } from "./backends/types";
// The SAME module the browser certification runs. If a step names a column
// that does not exist, uses an invalid enum value, omits a required field or
// violates a constraint, this suite fails on every push — the defect can no
// longer wait for a live run to surface it.
import {
  archetypeWorkflow,
  assetWithSources,
  bypassAttempts,
  collectionWorkflow,
  eligibilityWorkflow,
  enableOverride,
  graderCeilingWorkflow,
  graderWorkflow,
  insertRow,
  maturityRegressionWorkflow,
  monthlyBoardWorkflow,
  oauthRaceWorkflow,
  offerWorkbenchWorkflow,
  p1Workflow,
  seedVault,
  skillsWorkflow,
  updateRow,
} from "../scripts/integration-dataset.mjs";

let backend: TestBackend;
let A: SupabaseClient;
const rawSql = (q: string) => backend.sql!(q);

beforeAll(async () => {
  backend = await createPgliteBackend();
  A = backend.userA.db;
  await backend.cleanup();
});
afterAll(async () => {
  await backend.cleanup();
  await backend.teardown();
});
beforeEach(async () => backend.cleanup());

/** The Gate-7 chain the Offer Workbench steps need before an offer exists. */
async function seedQualifiedOffer(db: SupabaseClient) {
  const offer = await insertRow(db, "offers", {
    role_title: "Director, Analytics — Meridian",
    status: "negotiating",
    visa_sponsorship_committed_bool: true,
    priority_date_retention_committed_bool: true,
    attorney_reviewed_at: new Date().toISOString(),
    attorney_reviewed_doc_ref: "attorney-memo-integration.pdf",
  });
  return offer;
}

describe("integration dataset contract (the browser script's operations, hermetically)", () => {
  it("seeds the vault with canonical columns only", async () => {
    const { project, achievement, metric, evidence } = await seedVault(A);
    expect(project.employer).toBe("DIRECTV");
    expect(achievement.truth_status).toBe("VERIFIED");
    expect(metric.metric_name).toBe("Churn forecast error");
    expect(evidence.verified_by).toBe("manager");
  });

  it("grader workflow: 7 dimensions, rationales, canonical dimension_disputes, director signal", async () => {
    const { achievement } = await seedVault(A);
    const { evaluation, criteria } = await graderWorkflow(A, achievement.id);
    expect(evaluation.dimensions).toHaveLength(7);
    expect(evaluation.dimension_disputes[0].dimension).toBe("scope_scale");
    expect(typeof criteria.director_5.met).toBe("boolean");
  });

  it("grader ceilings cap impact and evidence for a no-metric attestation", async () => {
    const { achievement } = await seedVault(A);
    const evaluation = await graderCeilingWorkflow(A, achievement.id);
    const scores = Object.fromEntries(
      (evaluation.dimensions as Array<{ dimension: string; score: number }>).map((d) => [d.dimension, d.score]),
    );
    expect(scores.quantified_business_impact).toBe(3);
    expect(scores.evidence_quality).toBe(3);
    expect(scores.ownership).toBe(5);
  });

  it("archetype workflow: user-defined + JD-derived with a retained source and a gap report", async () => {
    const { userDefined, jdDerived, source, report } = await archetypeWorkflow(A);
    expect(userDefined.source_type).toBe("user_defined");
    expect(jdDerived.source_type).toBe("jd_derived");
    expect(source.raw_content).toContain("RAW-JD-TEXT");
    expect(report.gap_dimensions).toHaveLength(1);
  });

  it("eligibility workflow: unverified evidence and INTERNAL_ONLY metrics block, then clear", async () => {
    const { achievement, metric, evidence } = await seedVault(A);
    const { userDefined } = await archetypeWorkflow(A);
    const asset = await assetWithSources(A, {
      achievementId: achievement.id, metricId: metric.id,
      evidenceId: evidence.id, archetypeId: userDefined.id,
    });
    const verdict = await eligibilityWorkflow(A, {
      assetId: asset.id, metricId: metric.id, evidenceId: evidence.id,
    });
    expect(verdict.eligible).toBe(true);
  });

  it("collection workflow: version-exact packaging, approval, current, then invalidation", async () => {
    const { achievement, metric, evidence } = await seedVault(A);
    const { userDefined } = await archetypeWorkflow(A);
    const asset = await assetWithSources(A, {
      achievementId: achievement.id, metricId: metric.id,
      evidenceId: evidence.id, archetypeId: userDefined.id,
    });
    const { version, collection } = await collectionWorkflow(A, {
      assetId: asset.id, achievementId: achievement.id,
    });
    expect(version.approved_by_user_bool).toBe(true);
    const { data: members } = await A.from("collection_assets").select("*").eq("collection_fk", collection.id);
    expect((members as Array<{ version_fk: string }>)[0].version_fk).toBe(version.id);
  });

  it("P1 workflow: the whole relationship chain with canonical enums and columns", async () => {
    await enableOverride(A, "contract test");
    const { company, contact, outreach, application, referral, interview } = await p1Workflow(A);
    expect(company.gc_sponsorship_history).toContain("EB-2");
    expect(contact.source).toBe("linkedin_paste");
    expect(outreach.channel).toBe("linkedin");
    expect(outreach.direction).toBe("outbound");
    expect(application.stage).toBe("applied");
    expect(referral.stage).toBe("requested");
    expect(referral.status).toBe("active");
    expect(interview.round).toBe("Hiring manager");
    expect(interview.debrief_markdown).toContain("Debrief");
    expect(interview.themes).toContain("scope");
    expect(interview.outcome).toBe("passed");
  });

  it("offer workbench: benchmark bands, scenario snapshot, counter with its benchmark link", async () => {
    await enableOverride(A, "contract test");
    const { userDefined } = await archetypeWorkflow(A);
    const offer = await seedQualifiedOffer(A);
    const { benchmark, scenario, counter } = await offerWorkbenchWorkflow(A, {
      offerId: offer.id, archetypeId: userDefined.id,
    });
    expect(Number(benchmark.total_comp_low)).toBe(285000);
    expect(Number(benchmark.total_comp_high)).toBe(340000);
    expect(benchmark.as_of).toBeTruthy();
    expect(Number(scenario.total_comp_yr1)).toBe(289000);
    expect(counter.outcome).toBe("partially_accepted");
  });

  it("skills workflow: canonical skill, strength-scored evidence, plan method, dated progress", async () => {
    const { achievement } = await seedVault(A);
    const { report } = await archetypeWorkflow(A);
    const { skill, evidence, plan, progress } = await skillsWorkflow(A, {
      achievementId: achievement.id, gapReportId: report.id,
    });
    expect(skill.category).toBe("technical");
    expect(skill.director_relevance_score).toBe(5);
    expect(evidence.demonstration_strength_1_to_5).toBe(3);
    expect(plan.method).toBe("work_project");
    expect(plan.current_level_1_to_5).toBe(2);
    expect(plan.target_level_1_to_5).toBe(4);
    expect(plan.status).toBe("in_progress");
    expect(progress.assessed_by).toBe("self");
    expect(progress.hours_invested).toBeTruthy();
  });

  it("monthly board review persists content and satisfies its criterion", async () => {
    const brief = await monthlyBoardWorkflow(A, "2026-07-06");
    expect(brief.brief_type).toBe("monthly_board");
    expect(brief.reviewed_at).toBeTruthy();
  });

  it("OAuth race: exactly one of eight concurrent claims wins", async () => {
    const wins = await oauthRaceWorkflow(A, "https://ccc.example.com/api/google/callback", "contract-hash");
    expect(wins).toBe(1);
  });

  it("maturity regression revokes INSERT and DELETE with no recompute call", async () => {
    await enableOverride(A, "contract test");
    const audit = await maturityRegressionWorkflow(A);
    expect(audit.length).toBeGreaterThan(0);
  });

  it("every forged direct write in the dataset's bypass matrix is refused", async () => {
    const { achievement, metric, evidence } = await seedVault(A);
    const { userDefined } = await archetypeWorkflow(A);
    const asset = await assetWithSources(A, {
      achievementId: achievement.id, metricId: metric.id,
      evidenceId: evidence.id, archetypeId: userDefined.id,
    });
    const { version, collection } = await collectionWorkflow(A, {
      assetId: asset.id, achievementId: achievement.id,
    });
    const refusals = await bypassAttempts(A, {
      assetId: asset.id, versionId: version.id, collectionId: collection.id,
    });
    expect(refusals).toEqual([
      "insert asset_version", "delete asset_version", "update asset_version",
      "repoint current_version_fk", "set used_externally_bool",
      "flip eligibility_stale_bool", "rewrite truth_status_summary",
      "update collection membership", "delete collection membership",
      "insert collection membership",
    ]);
  });

  it("the dataset module touches no column that the migration chain lacks", async () => {
    // A structural backstop for steps the behavioral tests above cannot reach:
    // every `table: { field: ... }` literal in the shared module is checked
    // against information_schema.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../scripts/integration-dataset.mjs"), "utf8",
    );
    const columns = new Map<string, Set<string>>();
    for (const row of await rawSql(
      `select table_name, column_name from information_schema.columns where table_schema='public'`,
    )) {
      const t = String(row.table_name);
      if (!columns.has(t)) columns.set(t, new Set());
      columns.get(t)!.add(String(row.column_name));
    }
    // Walk `insertRow(db, "table", { … })` / `updateRow(db, "table", id, { … })`
    // and collect ONLY the top-level keys of the values object — nested JSONB
    // structures (dimensions, themes, proposed_changes) are values, not columns.
    const topLevelKeys = (body: string): string[] => {
      const keys: string[] = [];
      let depth = 0;
      let atKeyPosition = true;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") depth--;
        else if (ch === "," && depth === 0) atKeyPosition = true;
        else if (depth === 0 && atKeyPosition && /[a-z_]/i.test(ch)) {
          const rest = body.slice(i);
          const m = /^([a-z_][a-z0-9_]*)\s*:/.exec(rest);
          if (m) keys.push(m[1]);
          atKeyPosition = false;
        }
      }
      return keys;
    };
    /** Slice the balanced `{ … }` starting at `from`. */
    const balanced = (text: string, from: number): string => {
      let depth = 0;
      for (let i = from; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
          depth--;
          if (depth === 0) return text.slice(from + 1, i);
        }
      }
      return "";
    };
    const problems: string[] = [];
    let seen = 0;
    for (const m of src.matchAll(/(?:insertRow|updateRow)\(\s*db,\s*"([a-z_]+)"[^{]*?(\{)/g)) {
      const table = m[1];
      const body = balanced(src, m.index! + m[0].length - 1);
      seen++;
      const known = columns.get(table);
      if (!known) {
        problems.push(`unknown table ${table}`);
        continue;
      }
      for (const field of topLevelKeys(body)) {
        if (!known.has(field)) problems.push(`${table}.${field}`);
      }
    }
    expect(seen).toBeGreaterThan(15);
    expect(problems).toEqual([]);
  });
});
