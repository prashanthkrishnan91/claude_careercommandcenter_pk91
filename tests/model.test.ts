import { describe, expect, it } from "vitest";
import { gateExternalAsset } from "../lib/aiSafety";
import { achievementMatches, EMPTY_FILTERS, projectMatches } from "../lib/filters";
import { applyCeilings, directorSignal, totalScore } from "../lib/grader";
import { missingPromotionRequirements } from "../lib/promotion";
import { DEFAULT_SETTINGS, normalizeSettings } from "../lib/settings";
import {
  achievementInputSchema,
  evidenceItemInputSchema,
  metricInputSchema,
  projectInputSchema,
  quickLogInputSchema,
  TRUTH_STATUSES,
  type Achievement,
  type Project,
} from "../lib/types";
import { actionPermitted, contiguousCompletedGate, outwardActionMenu, VISA_GATES } from "../lib/visa";
import type { VisaChecklistItem } from "../lib/entities";

const UUID = "3f0e14aa-1111-4222-8333-944445555666";

describe("canonical input schemas", () => {
  it("project: canonical fields, defaults, stakeholders array", () => {
    const p = projectInputSchema.parse({ name: "Churn forecasting overhaul" });
    expect(p.employer).toBe("");
    expect(p.role_at_time).toBe("");
    expect(p.stakeholders).toEqual([]);
    expect(p.privacy_class).toBe("INTERNAL_ONLY");
    expect(p.status).toBe("active");
    const full = projectInputSchema.parse({
      name: "n",
      employer: "DIRECTV",
      team_size: 12,
      stakeholders: ["VP Analytics", "CFO office"],
    });
    expect(full.team_size).toBe(12);
    expect(full.stakeholders).toHaveLength(2);
    expect(() => projectInputSchema.parse({ name: "" })).toThrow();
    expect(() => projectInputSchema.parse({ name: "n", team_size: -1 })).toThrow();
    expect(() => projectInputSchema.parse({ name: "n", privacy_class: "SENSITIVE" })).toThrow();
  });

  it("achievement: requires project_fk and headline; canonical enums", () => {
    const a = achievementInputSchema.parse({ project_fk: UUID, headline: "Led the migration" });
    expect(a.truth_status).toBe("NEEDS_PROOF");
    expect(a.privacy_class).toBe("INTERNAL_ONLY");
    expect(a.status).toBe("draft");
    expect(a.candidate_for_external_bool).toBe(false);
    expect(() => achievementInputSchema.parse({ headline: "orphan" })).toThrow(); // no standalone achievements
    expect(() =>
      achievementInputSchema.parse({ project_fk: UUID, headline: "x", claimed_seniority_level: "vp" }),
    ).toThrow();
    expect(
      achievementInputSchema.parse({ project_fk: UUID, headline: "x", claimed_seniority_level: "sr_mgr" })
        .claimed_seniority_level,
    ).toBe("sr_mgr");
    expect(() =>
      achievementInputSchema.parse({ project_fk: UUID, headline: "x", truth_status: "EVIDENCED" }),
    ).toThrow(); // substituted enum must not survive
  });

  it("quick log: headline + project only", () => {
    expect(quickLogInputSchema.parse({ project_fk: UUID, headline: "h" }).headline).toBe("h");
    expect(() => quickLogInputSchema.parse({ headline: "h" })).toThrow();
    expect(() => quickLogInputSchema.parse({ project_fk: UUID, headline: "" })).toThrow();
  });

  it("metric: canonical fields with verbatim value and baseline", () => {
    const m = metricInputSchema.parse({
      achievement_fk: UUID,
      metric_name: "Churn forecast error",
      value: "18% reduction (4.2pp → 3.4pp)",
      time_period: "Q2 2025",
      baseline_value: "4.2pp",
      calculation_notes: "Holdout-validated, weekly cohorts",
    });
    expect(m.value).toBe("18% reduction (4.2pp → 3.4pp)");
    expect(m.baseline_value).toBe("4.2pp");
    expect(m.truth_status).toBe("NEEDS_PROOF");
    expect(m.status).toBe("active");
    expect(() => metricInputSchema.parse({ achievement_fk: UUID, metric_name: "x", value: "" })).toThrow();
  });

  it("evidence: canonical type set, content_summary required, verified_by set", () => {
    const e = evidenceItemInputSchema.parse({
      achievement_fk: UUID,
      type: "testimonial",
      content_summary: "VP praised the rollout in the QBR deck",
      verified_by: "manager",
    });
    expect(e.type).toBe("testimonial");
    expect(e.privacy_class).toBe("INTERNAL_ONLY");
    expect(() =>
      evidenceItemInputSchema.parse({ achievement_fk: UUID, type: "NOTE", content_summary: "x" }),
    ).toThrow(); // substituted uppercase kind must not survive
    expect(() =>
      evidenceItemInputSchema.parse({ achievement_fk: UUID, type: "note", content_summary: "" }),
    ).toThrow();
    expect(() =>
      evidenceItemInputSchema.parse({ achievement_fk: UUID, type: "link", content_summary: "x", external_url: "ftp://x" }),
    ).toThrow();
  });

  it("truth statuses are the six canonical values", () => {
    expect([...TRUTH_STATUSES]).toEqual([
      "VERIFIED",
      "ATTESTED_WITH_METRIC",
      "ATTESTED_NO_METRIC",
      "INFERRED",
      "NEEDS_PROOF",
      "DISPUTED",
    ]);
  });
});

describe("promotion gate", () => {
  const base = { narrative: "Did the thing, here is how.", truth_status: "ATTESTED_WITH_METRIC", status: "draft" } as Pick<
    Achievement,
    "narrative" | "truth_status" | "status"
  >;
  it("passes with narrative, proof, and affirmations", () => {
    expect(
      missingPromotionRequirements(
        { achievement: base, activeMetricCount: 1, activeEvidenceCount: 0 },
        { privacyAffirmed: true, keepNeedsProofConfirmed: false },
      ),
    ).toEqual([]);
  });
  it("names each specific missing requirement", () => {
    const missing = missingPromotionRequirements(
      {
        achievement: { ...base, narrative: "", truth_status: "NEEDS_PROOF" },
        activeMetricCount: 0,
        activeEvidenceCount: 0,
      },
      { privacyAffirmed: false, keepNeedsProofConfirmed: false },
    );
    expect(missing).toHaveLength(4);
    expect(missing.join(" ")).toMatch(/narrative/i);
    expect(missing.join(" ")).toMatch(/metric or evidence/i);
    expect(missing.join(" ")).toMatch(/privacy/i);
    expect(missing.join(" ")).toMatch(/NEEDS_PROOF/);
  });
  it("allows NEEDS_PROOF only with explicit confirmation", () => {
    const facts = {
      achievement: { ...base, truth_status: "NEEDS_PROOF" as const },
      activeMetricCount: 0,
      activeEvidenceCount: 2,
    };
    expect(
      missingPromotionRequirements(facts, { privacyAffirmed: true, keepNeedsProofConfirmed: true }),
    ).toEqual([]);
  });
  it("refuses non-drafts", () => {
    expect(
      missingPromotionRequirements(
        { achievement: { ...base, status: "active" }, activeMetricCount: 1, activeEvidenceCount: 1 },
        { privacyAffirmed: true, keepNeedsProofConfirmed: true },
      )[0],
    ).toMatch(/draft/i);
  });
});

describe("truth/privacy generation gate", () => {
  const src = (truth: string, privacy: string) => ({
    kind: "achievement" as const,
    id: UUID,
    label: "Test claim",
    truth_status: truth as never,
    privacy_class: privacy as never,
  });
  it("allows VERIFIED + PUBLIC_SAFE", () => {
    expect(gateExternalAsset([src("VERIFIED", "PUBLIC_SAFE")], { attestedNoMetricOverride: false }).allowed).toBe(true);
  });
  it("blocks NEEDS_PROOF, INFERRED, DISPUTED with reasons naming the claim", () => {
    for (const truth of ["NEEDS_PROOF", "INFERRED", "DISPUTED"]) {
      const gate = gateExternalAsset([src(truth, "PUBLIC_SAFE")], { attestedNoMetricOverride: false });
      expect(gate.allowed).toBe(false);
      expect(gate.reasons[0].label).toBe("Test claim");
      expect(gate.reasons[0].reason).toContain(truth);
    }
  });
  it("blocks PRIVATE and INTERNAL_ONLY sources for external assets", () => {
    expect(gateExternalAsset([src("VERIFIED", "PRIVATE")], { attestedNoMetricOverride: false }).allowed).toBe(false);
    expect(gateExternalAsset([src("VERIFIED", "INTERNAL_ONLY")], { attestedNoMetricOverride: false }).allowed).toBe(false);
  });
  it("requires the explicit ATTESTED_NO_METRIC override", () => {
    const noOverride = gateExternalAsset([src("ATTESTED_NO_METRIC", "PUBLIC_SAFE")], { attestedNoMetricOverride: false });
    expect(noOverride.allowed).toBe(false);
    expect(noOverride.reasons[0].reason).toMatch(/override/i);
    expect(gateExternalAsset([src("ATTESTED_NO_METRIC", "PUBLIC_SAFE")], { attestedNoMetricOverride: true }).allowed).toBe(true);
  });
});

describe("grader rubric", () => {
  const dims = (scores: Record<string, number>) =>
    Object.entries(scores).map(([dimension, score]) => ({ dimension, score, rationale: "r" }));
  it("director-signal requires 4×≥4 including cross-functional & scope, ownership ≥3", () => {
    const good = dims({
      quantified_business_impact: 4,
      scope_scale: 4,
      ownership: 3,
      cross_functional_influence: 4,
      strategic_ambiguity: 4,
      technical_analytical_difficulty: 2,
      evidence_quality: 2,
    });
    expect(directorSignal(good).qualifies).toBe(true);
    const weakOwnership = dims({ ...Object.fromEntries(good.map((d) => [d.dimension, d.score])), ownership: 2 });
    const r = directorSignal(weakOwnership);
    expect(r.qualifies).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/Ownership/);
  });
  it("applies truth-status ceilings to impact and evidence dimensions", () => {
    const capped = applyCeilings(
      "ATTESTED_NO_METRIC",
      dims({ quantified_business_impact: 5, evidence_quality: 5, ownership: 5 }),
    );
    expect(capped.find((d) => d.dimension === "quantified_business_impact")?.score).toBe(3);
    expect(capped.find((d) => d.dimension === "evidence_quality")?.score).toBe(3);
    expect(capped.find((d) => d.dimension === "ownership")?.score).toBe(5);
  });
  it("total score is the equal-weighted mean", () => {
    expect(totalScore(dims({ a: 4, b: 2 }))).toBe(3);
  });
});

describe("visa gating", () => {
  const items = (completed: number[]): VisaChecklistItem[] =>
    VISA_GATES.map((g) => ({
      ...g,
      id: `${g.ordinal}`,
      user_id: "u",
      status: completed.includes(g.ordinal) ? "complete" : "not_started",
      assumptions: [],
      risks: [],
      required_documents: [],
      attorney_confirmed_at: null,
      attorney_confirmation_doc_ref: "",
      notes: "",
      created_at: "",
      updated_at: "",
    }));
  it("computes the contiguous completed gate", () => {
    expect(contiguousCompletedGate(items([1, 2, 3]))).toBe(3);
    expect(contiguousCompletedGate(items([1, 2, 4]))).toBe(2); // gap at 3
    expect(contiguousCompletedGate(items([]))).toBe(0);
  });
  it("gates outward actions by gate level", () => {
    expect(actionPermitted({ outward_facing_bool: true, visa_gate_required_minimum: 5 }, 3)).toBe(false);
    expect(actionPermitted({ outward_facing_bool: true, visa_gate_required_minimum: 5 }, 5)).toBe(true);
    expect(actionPermitted({ outward_facing_bool: false, visa_gate_required_minimum: 7 }, 0)).toBe(true);
  });
  it("expands the outward menu with gates; referral asks stay locked before 6", () => {
    const g3 = outwardActionMenu(3);
    expect(g3.stillDisallowed.join(" ")).toMatch(/Referral asks/);
    const g6 = outwardActionMenu(6);
    expect(g6.allowed.join(" ")).toMatch(/referral requests/i);
    expect(outwardActionMenu(7).allowed.join(" ")).toMatch(/Formal applications/);
  });
});

describe("filters", () => {
  const project = { status: "active", privacy_class: "INTERNAL_ONLY", employer: "DIRECTV", start_date: "2025-01-01", end_date: null, created_at: "2025-01-01T00:00:00Z" } as Project;
  const achievement = {
    status: "draft", truth_status: "NEEDS_PROOF", privacy_class: "INTERNAL_ONLY",
    candidate_for_external_bool: false, start_date: null, end_date: null,
    created_at: "2025-06-15T00:00:00Z",
  } as Achievement;
  it("matches on employer via the parent project", () => {
    expect(achievementMatches({ ...EMPTY_FILTERS, employer: "DIRECTV" }, achievement, project)).toBe(true);
    expect(achievementMatches({ ...EMPTY_FILTERS, employer: "Elsewhere" }, achievement, project)).toBe(false);
  });
  it("matches lifecycle, truth, candidate, and date range", () => {
    expect(achievementMatches({ ...EMPTY_FILTERS, status: "draft" }, achievement, project)).toBe(true);
    expect(achievementMatches({ ...EMPTY_FILTERS, truth: "VERIFIED" }, achievement, project)).toBe(false);
    expect(achievementMatches({ ...EMPTY_FILTERS, candidateOnly: true }, achievement, project)).toBe(false);
    expect(achievementMatches({ ...EMPTY_FILTERS, dateFrom: "2025-06-01", dateTo: "2025-06-30" }, achievement, project)).toBe(true);
    expect(achievementMatches({ ...EMPTY_FILTERS, dateFrom: "2025-07-01" }, achievement, project)).toBe(false);
  });
  it("projects have no truth axis — truth filter excludes them", () => {
    expect(projectMatches({ ...EMPTY_FILTERS, truth: "VERIFIED" }, project)).toBe(false);
    expect(projectMatches({ ...EMPTY_FILTERS, employer: "DIRECTV" }, project)).toBe(true);
  });
});

describe("settings", () => {
  it("normalizes garbage to canonical defaults", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ default_truth_status: "EVIDENCED" })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ default_privacy_class: "PUBLIC_SAFE" }).default_privacy_class).toBe("PUBLIC_SAFE");
  });
});
