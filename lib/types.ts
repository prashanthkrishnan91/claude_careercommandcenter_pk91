import { z } from "zod";

// Canonical P0A model — Architecture v2.1 §3 with v2.1.1 amendments A1–A3.
// Field names, enum sets, and defaults mirror the schema migration exactly.

// ── enumerations ─────────────────────────────────────────────────────────────

export const TRUTH_STATUSES = [
  "VERIFIED",
  "ATTESTED_WITH_METRIC",
  "ATTESTED_NO_METRIC",
  "INFERRED",
  "NEEDS_PROOF",
  "DISPUTED",
] as const;

export const PRIVACY_CLASSES = ["PUBLIC_SAFE", "INTERNAL_ONLY", "PRIVATE"] as const;

export const PROJECT_STATUSES = ["active", "archived"] as const;
export const ACHIEVEMENT_STATUSES = ["draft", "active", "archived"] as const;
export const METRIC_STATUSES = ["active", "archived"] as const;
export const EVIDENCE_STATUSES = ["active", "archived"] as const;

export const SENIORITY_LEVELS = ["ic", "sr", "mgr", "sr_mgr", "dir"] as const;

export const EVIDENCE_TYPES = [
  "link",
  "email_ref",
  "note",
  "testimonial",
  "metric_source",
] as const;

export const VERIFIED_BY = ["self", "peer", "manager", "document"] as const;

export type TruthStatus = (typeof TRUTH_STATUSES)[number];
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type AchievementStatus = (typeof ACHIEVEMENT_STATUSES)[number];
export type MetricStatus = (typeof METRIC_STATUSES)[number];
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type VerifiedBy = (typeof VERIFIED_BY)[number];

// Defaults at creation (v2.1 §4 rule 3).
export const DEFAULT_TRUTH_STATUS: TruthStatus = "NEEDS_PROOF";
export const DEFAULT_PRIVACY_CLASS: PrivacyClass = "INTERNAL_ONLY";

const truthStatusSchema = z.enum(TRUTH_STATUSES);
const privacyClassSchema = z.enum(PRIVACY_CLASSES);

// Calendar dates exactly as entered — "YYYY-MM-DD" ⇄ Postgres date.
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), "Invalid date");

const optionalDate = isoDateSchema.nullable().optional();

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const freeText = z.string().trim().max(10_000).optional().default("");
const shortFreeText = z.string().trim().max(300).optional().default("");

const urlOrEmpty = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .default("")
  .refine((s) => s === "" || /^https?:\/\//.test(s), "URL must start with http:// or https://");

// ── projects ─────────────────────────────────────────────────────────────────

export const projectInputSchema = z.object({
  name: requiredText(200),
  employer: shortFreeText,
  role_at_time: shortFreeText,
  start_date: optionalDate,
  end_date: optionalDate,
  description: freeText,
  business_context: freeText,
  my_scope: freeText,
  team_size: z.number().int().min(0).nullable().optional(),
  stakeholders: z.array(z.string().trim().min(1).max(200)).max(50).optional().default([]),
  privacy_class: privacyClassSchema.optional().default(DEFAULT_PRIVACY_CLASS),
  status: z.enum(PROJECT_STATUSES).optional().default("active"),
});

// ── achievements ─────────────────────────────────────────────────────────────
// project_fk is required: achievements live inside projects (v2.1 vault
// hierarchy; no standalone achievements).

export const achievementInputSchema = z.object({
  project_fk: z.string().uuid(),
  headline: requiredText(300),
  narrative: freeText,
  action_taken: freeText,
  outcome: freeText,
  start_date: optionalDate,
  end_date: optionalDate,
  claimed_seniority_level: z.enum(SENIORITY_LEVELS).nullable().optional(),
  truth_status: truthStatusSchema.optional().default(DEFAULT_TRUTH_STATUS),
  privacy_class: privacyClassSchema.optional().default(DEFAULT_PRIVACY_CLASS),
  candidate_for_external_bool: z.boolean().optional().default(false),
  status: z.enum(ACHIEVEMENT_STATUSES).optional().default("draft"),
});

// Quick Log (v2.2 §5): required fields are headline + project only. Everything
// else takes the locked defaults: status draft, NEEDS_PROOF, INTERNAL_ONLY.
export const quickLogInputSchema = z.object({
  project_fk: z.string().uuid(),
  headline: requiredText(300),
});

// ── metrics ──────────────────────────────────────────────────────────────────
// value/baseline_value stay text: stored exactly as the user entered them.

export const metricInputSchema = z.object({
  achievement_fk: z.string().uuid(),
  metric_name: requiredText(300),
  value: requiredText(300),
  unit: shortFreeText,
  time_period: shortFreeText,
  baseline_value: shortFreeText,
  calculation_notes: freeText,
  truth_status: truthStatusSchema.optional().default(DEFAULT_TRUTH_STATUS),
  privacy_class: privacyClassSchema.optional().default(DEFAULT_PRIVACY_CLASS),
  status: z.enum(METRIC_STATUSES).optional().default("active"),
});

// ── evidence_items ───────────────────────────────────────────────────────────

export const evidenceItemInputSchema = z.object({
  achievement_fk: z.string().uuid(),
  type: z.enum(EVIDENCE_TYPES),
  content_summary: requiredText(10_000),
  external_url: urlOrEmpty,
  privacy_class: privacyClassSchema.optional().default(DEFAULT_PRIVACY_CLASS),
  verified_at: z.string().datetime({ offset: true }).nullable().optional(),
  verified_by: z.enum(VERIFIED_BY).nullable().optional(),
  status: z.enum(EVIDENCE_STATUSES).optional().default("active"),
});

// ── patch schemas (inline editing: any subset of fields) ─────────────────────

export const projectPatchSchema = projectInputSchema.partial();
export const achievementPatchSchema = achievementInputSchema.partial();
export const metricPatchSchema = metricInputSchema.partial();
export const evidenceItemPatchSchema = evidenceItemInputSchema.partial();

export type ProjectInput = z.input<typeof projectInputSchema>;
export type AchievementInput = z.input<typeof achievementInputSchema>;
export type QuickLogInput = z.input<typeof quickLogInputSchema>;
export type MetricInput = z.input<typeof metricInputSchema>;
export type EvidenceItemInput = z.input<typeof evidenceItemInputSchema>;

export type ProjectPatch = z.input<typeof projectPatchSchema>;
export type AchievementPatch = z.input<typeof achievementPatchSchema>;
export type MetricPatch = z.input<typeof metricPatchSchema>;
export type EvidenceItemPatch = z.input<typeof evidenceItemPatchSchema>;

// ── row types (as returned from the database) ────────────────────────────────

export interface Project {
  id: string;
  user_id: string;
  name: string;
  employer: string;
  role_at_time: string;
  start_date: string | null;
  end_date: string | null;
  description: string;
  business_context: string;
  my_scope: string;
  team_size: number | null;
  stakeholders: string[];
  privacy_class: PrivacyClass;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Achievement {
  id: string;
  user_id: string;
  project_fk: string;
  headline: string;
  narrative: string;
  action_taken: string;
  outcome: string;
  start_date: string | null;
  end_date: string | null;
  claimed_seniority_level: SeniorityLevel | null;
  truth_status: TruthStatus;
  privacy_class: PrivacyClass;
  has_metric_bool: boolean;
  candidate_for_external_bool: boolean;
  status: AchievementStatus;
  created_at: string;
  updated_at: string;
}

export interface Metric {
  id: string;
  user_id: string;
  achievement_fk: string;
  metric_name: string;
  value: string;
  unit: string;
  time_period: string;
  baseline_value: string;
  calculation_notes: string;
  truth_status: TruthStatus;
  privacy_class: PrivacyClass;
  status: MetricStatus;
  created_at: string;
}

export interface EvidenceItem {
  id: string;
  user_id: string;
  achievement_fk: string;
  type: EvidenceType;
  content_summary: string;
  external_url: string;
  privacy_class: PrivacyClass;
  verified_at: string | null;
  verified_by: VerifiedBy | null;
  status: EvidenceStatus;
  created_at: string;
}

export type EntityKind = "project" | "achievement" | "metric" | "evidence_item";
