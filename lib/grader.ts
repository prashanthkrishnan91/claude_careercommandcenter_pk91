import type { GraderDimensionScore, GraderEvaluation } from "./entities";
import type { TruthStatus } from "./types";

// Achievement Grader rubric — v2.1 §9, visible and transparent, with the
// v2.1.1 A6 director-signal tightening (Ownership floor).

export const RUBRIC_VERSION = "v2.1.1-A6";

export const RUBRIC_DIMENSIONS = [
  { key: "quantified_business_impact", label: "Quantified business impact" },
  { key: "scope_scale", label: "Scope / scale" },
  { key: "ownership", label: "Ownership" },
  { key: "cross_functional_influence", label: "Cross-functional influence" },
  { key: "strategic_ambiguity", label: "Strategic ambiguity" },
  { key: "technical_analytical_difficulty", label: "Technical / analytical difficulty" },
  { key: "evidence_quality", label: "Evidence quality" },
] as const;

export type RubricDimensionKey = (typeof RUBRIC_DIMENSIONS)[number]["key"];

// Truth-status ceilings (v2.1 §4 rule 5): ATTESTED_NO_METRIC caps the
// quantified-impact and evidence-quality dimensions below ATTESTED_WITH_METRIC.
export function dimensionCeiling(truth: TruthStatus, dimension: RubricDimensionKey): number {
  const capped = dimension === "quantified_business_impact" || dimension === "evidence_quality";
  if (!capped) return 5;
  switch (truth) {
    case "VERIFIED":
      return 5;
    case "ATTESTED_WITH_METRIC":
      return 5;
    case "ATTESTED_NO_METRIC":
      return 3;
    case "INFERRED":
    case "NEEDS_PROOF":
    case "DISPUTED":
      return 2;
  }
}

export function applyCeilings(truth: TruthStatus, dims: GraderDimensionScore[]): GraderDimensionScore[] {
  return dims.map((d) => {
    const ceiling = dimensionCeiling(truth, d.dimension as RubricDimensionKey);
    if (d.score > ceiling) {
      return {
        ...d,
        score: ceiling,
        rationale: `${d.rationale} [capped at ${ceiling} by truth status ${truth}]`,
      };
    }
    return d;
  });
}

export function totalScore(dims: GraderDimensionScore[]): number {
  // Default equal weighting (v2.1 §9).
  if (dims.length === 0) return 0;
  return Math.round((dims.reduce((s, d) => s + d.score, 0) / dims.length) * 100) / 100;
}

export interface DirectorSignalResult {
  qualifies: boolean;
  reasons: string[];
}

// Director-signal (v2.1.1 A6): ≥4 on at least 4 of 7 dimensions, AND ≥4 on
// both Cross-functional Influence AND Scope/Scale, AND ≥3 on Ownership.
export function directorSignal(dims: GraderDimensionScore[]): DirectorSignalResult {
  const get = (key: RubricDimensionKey) => dims.find((d) => d.dimension === key)?.score ?? 0;
  const reasons: string[] = [];
  const fourPlus = dims.filter((d) => d.score >= 4).length;
  if (fourPlus < 4) reasons.push(`Only ${fourPlus} of 7 dimensions score ≥4 (needs 4).`);
  if (get("cross_functional_influence") < 4) {
    reasons.push(`Cross-functional influence is ${get("cross_functional_influence")} (needs ≥4).`);
  }
  if (get("scope_scale") < 4) reasons.push(`Scope/scale is ${get("scope_scale")} (needs ≥4).`);
  if (get("ownership") < 3) reasons.push(`Ownership is ${get("ownership")} (needs ≥3 — the floor).`);
  return { qualifies: reasons.length === 0, reasons };
}

export function isDirectorSignal(evaluation: GraderEvaluation): boolean {
  return directorSignal(evaluation.dimensions).qualifies;
}
