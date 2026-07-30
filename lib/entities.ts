// Lightweight row typings for the P0B–P1 entities. The canonical four P0A
// entities keep full zod validation in lib/types.ts; these tables are guarded
// by their database constraints (checks, composite same-user FKs, RLS) and
// edited through spec-driven inline forms.

import type { PrivacyClass, TruthStatus } from "./types";

export interface SanitizedClaim {
  id: string;
  user_id: string;
  source_achievement_fk: string | null;
  source_metric_fk: string | null;
  raw_private_text: string;
  sanitized_public_text: string;
  sanitization_method: "manual" | "template" | "guided";
  user_approved_at: string | null;
  privacy_class: PrivacyClass;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface GraderDimensionScore {
  dimension: string;
  score: number; // 1–5
  rationale: string;
}

export interface GraderEvaluation {
  id: string;
  user_id: string;
  achievement_fk: string;
  evaluated_at: string;
  model_used: string;
  dimensions: GraderDimensionScore[];
  total_score: number | null;
  written_rationale: string;
  rubric_version: string;
  dimension_disputes: Array<{ dimension: string; note: string; at: string }>;
  status: "active" | "archived";
  created_at: string;
}

export interface TargetArchetype {
  id: string;
  user_id: string;
  name: string;
  source_type: "user_defined" | "jd_derived" | "hybrid";
  required_skills: string[];
  expected_scope: string[];
  expected_metrics: string[];
  seniority_signals: string[];
  comp_band_low: number | null;
  comp_band_high: number | null;
  visa_friendliness_score: number | null;
  approved_by_user_bool: boolean;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface ArchetypeSource {
  id: string;
  user_id: string;
  archetype_fk: string;
  source_type: "pasted_jd" | "company_page" | "user_note";
  raw_content: string;
  parsed_summary: string;
  used_in_archetype_bool: boolean;
  pinned_bool: boolean;
  purge_after: string | null;
  status: "active" | "archived";
  created_at: string;
}

export interface GapReport {
  id: string;
  user_id: string;
  archetype_fk: string;
  generated_at: string;
  covered_dimensions: Array<{ dimension: string; detail: string }>;
  gap_dimensions: Array<{ dimension: string; detail: string }>;
  recommended_actions: Array<{ title: string; category: string }>;
  status: "active" | "archived";
  created_at: string;
}

export type AssetType =
  | "resume_bullet"
  | "story"
  | "li_post"
  | "cover_letter"
  | "positioning"
  | "interview_answer";

export interface CareerAsset {
  id: string;
  user_id: string;
  asset_type: AssetType;
  current_version_fk: string | null;
  target_archetype_fk: string | null;
  truth_status_summary: string;
  privacy_class: PrivacyClass;
  used_externally_bool: boolean; // DERIVED from asset_external_uses by trigger
  eligibility_stale_bool: boolean;
  eligibility_reason: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface AssetExternalUse {
  id: string;
  user_id: string;
  asset_fk: string;
  version_fk: string;
  destination: string;
  used_at: string;
  created_at: string;
}

export interface AssetVersion {
  id: string;
  user_id: string;
  asset_fk: string;
  version_number: number;
  content: string;
  generated_by_model: string;
  generation_prompt_hash: string;
  blocked_bool: boolean;
  block_reason: string;
  approved_by_user_bool: boolean;
  approved_at: string | null;
  superseded_by_fk: string | null;
  /** the ATTESTED_NO_METRIC acknowledgment actually given at generation time */
  attested_no_metric_ack_bool: boolean;
  created_at: string;
}

export interface AssetCollection {
  id: string;
  user_id: string;
  name: string;
  collection_type: "resume_version" | "interview_pack" | "li_profile_draft" | "promotion_packet";
  target_archetype_fk: string | null;
  notes: string;
  current_bool: boolean;
  approved_by_user_bool: boolean;
  approved_at: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface StoryBankEntry {
  id: string;
  user_id: string;
  theme:
    | "leadership"
    | "conflict"
    | "ambiguity"
    | "scale"
    | "metric_impact"
    | "influence"
    | "failure"
    | "other";
  situation: string;
  task: string;
  action: string;
  result: string;
  approved_by_user_bool: boolean;
  approved_at: string | null;
  freshness_score: number | null;
  last_practiced_at: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface VisaChecklistItem {
  id: string;
  user_id: string;
  state_name: string;
  ordinal: number;
  status: "not_started" | "in_progress" | "complete" | "blocked";
  assumptions: string[];
  risks: string[];
  required_documents: string[];
  attorney_confirmation_required_bool: boolean;
  attorney_confirmed_at: string | null;
  attorney_confirmation_doc_ref: string;
  do_not_act_until_confirmed_bool: boolean;
  qualifying_offer_fk: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface WeeklyBrief {
  id: string;
  user_id: string;
  week_of: string;
  brief_type: "friday_capture" | "sunday_review" | "monthly_board" | "quarterly_narrative";
  content_markdown: string;
  market_motion_action_fk: string | null;
  generated_at: string;
  reviewed_at: string | null;
  status: "active" | "archived";
  created_at: string;
}

export interface ActionItem {
  id: string;
  user_id: string;
  week_of: string;
  priority_rank: number;
  title: string;
  rationale: string;
  category: "evidence" | "asset" | "archetype" | "outward" | "visa" | "other";
  outward_facing_bool: boolean;
  visa_gate_required_minimum: number | null;
  status: "candidate" | "selected" | "completed" | "dropped" | "archived";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiOutput {
  id: string;
  user_id: string;
  output_type: string;
  model_used: string;
  input_refs: Array<{ kind: string; id: string; label?: string }>;
  output_text: string;
  truth_classifications: Array<{
    kind: string;
    id: string;
    truth_status?: TruthStatus;
    privacy_class?: PrivacyClass;
  }>;
  blocked_bool: boolean;
  block_reason: string;
  archived_bool: boolean;
  created_at: string;
}

export interface Company {
  id: string;
  user_id: string;
  name: string;
  tier: string;
  gc_sponsorship_history: string;
  notes: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  company_fk: string | null;
  name: string;
  role_title: string;
  source: string;
  linkedin_paste_raw: string;
  email: string;
  last_touch: string | null;
  notes: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Application {
  id: string;
  user_id: string;
  company_fk: string | null;
  role_title: string;
  target_archetype_fk: string | null;
  applied_at: string | null;
  channel: "referral" | "direct" | "recruiter" | "other";
  stage:
    | "draft"
    | "applied"
    | "screening"
    | "interviewing"
    | "offer"
    | "rejected"
    | "withdrawn"
    | "closed";
  notes: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Outreach {
  id: string;
  user_id: string;
  contact_fk: string;
  channel: "email" | "linkedin" | "phone" | "in_person" | "other";
  direction: "outbound" | "inbound";
  occurred_at: string | null;
  summary: string;
  followup_due: string | null;
  status: "active" | "archived";
  created_at: string;
}

export interface Referral {
  id: string;
  user_id: string;
  contact_fk: string;
  application_fk: string | null;
  stage: "identified" | "prepped" | "requested" | "agreed" | "submitted" | "declined" | "closed";
  notes: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Interview {
  id: string;
  user_id: string;
  application_fk: string;
  round: string;
  scheduled_at: string | null;
  occurred_at: string | null;
  interviewer: string;
  debrief_markdown: string;
  themes: string[];
  outcome: "pending" | "passed" | "failed" | "canceled" | "unknown";
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface CompBenchmark {
  id: string;
  user_id: string;
  archetype_fk: string | null;
  source: string;
  role_title: string;
  total_comp_low: number | null;
  total_comp_high: number | null;
  as_of: string | null;
  notes: string;
  status: "active" | "archived";
  created_at: string;
}

export interface Offer {
  id: string;
  user_id: string;
  application_fk: string | null;
  company_fk: string | null;
  role_title: string;
  received_at: string | null;
  status: "draft" | "received" | "negotiating" | "accepted" | "declined" | "expired" | "withdrawn";
  base_salary: number | null;
  base_currency: string;
  bonus_target_pct: number | null;
  bonus_structure_notes: string;
  equity_grant_value: number | null;
  equity_vest_schedule_notes: string;
  equity_refresh_notes: string;
  signing_bonus: number | null;
  signing_bonus_clawback_notes: string;
  relocation_package: string;
  other_comp_notes: string;
  benefits_summary: string;
  visa_sponsorship_committed_bool: boolean;
  priority_date_retention_committed_bool: boolean;
  visa_sponsorship_terms_text: string;
  attorney_reviewed_at: string | null;
  attorney_reviewed_doc_ref: string;
  attorney_notes: string;
  expiration_date: string | null;
  decision_due_by: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface OfferScenario {
  id: string;
  user_id: string;
  offer_fk: string;
  scenario_name: string;
  assumptions: string[];
  total_comp_yr1: number | null;
  total_comp_yr4: number | null;
  delta_vs_current: Record<string, unknown>;
  notes: string;
  status: "active" | "archived";
  created_at: string;
}

export interface CounterProposal {
  id: string;
  user_id: string;
  offer_fk: string;
  proposed_changes: Array<{ field: string; ask: string; justification: string }>;
  rationale: string;
  sent_at: string | null;
  response_at: string | null;
  response_summary: string;
  outcome: "accepted" | "partially_accepted" | "rejected" | "countered" | "no_response" | null;
  status: "active" | "archived";
  created_at: string;
}

export interface Skill {
  id: string;
  user_id: string;
  name: string;
  category: "technical" | "domain" | "leadership" | "tooling";
  director_relevance_score: number | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface SkillEvidence {
  id: string;
  user_id: string;
  skill_fk: string;
  achievement_fk: string;
  demonstration_strength_1_to_5: number;
  status: "active" | "archived";
  created_at: string;
}

export interface SkillDevelopmentPlan {
  id: string;
  user_id: string;
  skill_fk: string;
  gap_source:
    | "archetype_comparator"
    | "self_identified"
    | "interview_feedback"
    | "manager_feedback"
    | "reference_feedback";
  gap_report_fk: string | null;
  current_level_1_to_5: number | null;
  target_level_1_to_5: number | null;
  rationale: string;
  method:
    | "work_project"
    | "side_project"
    | "course"
    | "certification"
    | "reading"
    | "mentorship"
    | "teaching"
    | "other";
  method_details: string;
  estimated_hours: number | null;
  start_date: string | null;
  target_date: string | null;
  status: "planned" | "in_progress" | "completed" | "paused" | "abandoned";
  abandon_reason: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SkillDevelopmentProgress {
  id: string;
  user_id: string;
  plan_fk: string;
  progress_date: string;
  notes: string;
  linked_achievement_fk: string | null;
  hours_invested: number | null;
  level_assessment_1_to_5: number | null;
  assessed_by: "self" | "peer" | "manager" | "external" | null;
  created_at: string;
}

export interface ReferenceRecord {
  id: string;
  user_id: string;
  contact_fk: string;
  reference_type:
    | "manager"
    | "skip_level"
    | "peer"
    | "direct_report"
    | "executive"
    | "client"
    | "external_partner"
    | "other";
  employer_at_time: string;
  working_relationship_period_start: string | null;
  working_relationship_period_end: string | null;
  relationship_summary: string;
  strongest_themes: string[];
  willingness_status: "unconfirmed" | "confirmed" | "tentative" | "declined" | "do_not_ask";
  willingness_confirmed_at: string | null;
  willingness_notes: string;
  last_briefed_at: string | null;
  current_narrative_version_fk: string | null;
  briefing_method: "in_person" | "video_call" | "email" | "li_message" | "other" | null;
  cadence_target_months: number | null;
  last_touch_date: string | null;
  next_touch_due: string | null;
  notes: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface GoogleConnection {
  id: string;
  user_id: string;
  provider: "gmail" | "calendar";
  scopes: string[];
  account_email: string;
  refresh_token_encrypted: string;
  connected_at: string;
  last_sync_at: string | null;
  last_sync_status: string;
  revoked_at: string | null;
  status: "active" | "archived";
  created_at: string;
}
