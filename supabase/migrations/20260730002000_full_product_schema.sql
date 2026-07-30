-- Career Command Center — full-product schema (P0B–P0G, P1, v2.2.1).
--
-- Sources: v2 §3/§6 (skills, story_bank, visa gates, P1 entities),
-- v2.1 §3 (P0B+ entities), v2.1.1 (user_id, lifecycle, naming),
-- v2.2.1 (offers, offer_scenarios, counter_proposals, skill development,
-- references). Every table: user_id scoped by RLS on read/write/delete;
-- same-user composite FKs so cross-user linking fails at the database.
-- Lifecycle is archival; the product never hard-deletes.

-- ── P0B: sanitized claims ────────────────────────────────────────────────────
create table public.sanitized_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_achievement_fk uuid,
  source_metric_fk uuid,
  raw_private_text text not null default '',      -- never leaves the database toward any LLM
  sanitized_public_text text not null default '',
  sanitization_method text not null default 'manual'
    check (sanitization_method in ('manual','template','guided')),
  user_approved_at timestamptz,
  privacy_class text not null default 'INTERNAL_ONLY'
    check (privacy_class in ('PUBLIC_SAFE','INTERNAL_ONLY','PRIVATE')),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sanitized_claims_id_user_unique unique (id, user_id),
  constraint sanitized_claims_has_source
    check (source_achievement_fk is not null or source_metric_fk is not null),
  -- approved output is always PUBLIC_SAFE (v2.1 §5)
  constraint sanitized_claims_approved_public
    check (user_approved_at is null or privacy_class = 'PUBLIC_SAFE'),
  constraint sanitized_claims_achievement_same_user_fkey
    foreign key (source_achievement_fk, user_id) references public.achievements (id, user_id) on delete cascade,
  constraint sanitized_claims_metric_same_user_fkey
    foreign key (source_metric_fk, user_id) references public.metrics (id, user_id) on delete cascade
);

-- ── P0C: grader evaluations ──────────────────────────────────────────────────
create table public.grader_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  achievement_fk uuid not null,
  evaluated_at timestamptz not null default now(),
  model_used text not null default '',
  dimensions jsonb not null default '[]',          -- [{dimension, score 1-5, rationale}]
  total_score numeric,
  written_rationale text not null default '',
  rubric_version text not null default '',
  dimension_disputes jsonb not null default '[]',  -- [{dimension, note, at}]
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint grader_evaluations_id_user_unique unique (id, user_id),
  constraint grader_evaluations_achievement_same_user_fkey
    foreign key (achievement_fk, user_id) references public.achievements (id, user_id) on delete cascade
);

-- ── P0D: target archetypes, sources, gap reports ─────────────────────────────
create table public.target_archetypes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  source_type text not null default 'user_defined'
    check (source_type in ('user_defined','jd_derived','hybrid')),
  required_skills jsonb not null default '[]',
  expected_scope jsonb not null default '[]',
  expected_metrics jsonb not null default '[]',
  seniority_signals jsonb not null default '[]',
  comp_band_low numeric,
  comp_band_high numeric,
  visa_friendliness_score numeric,
  approved_by_user_bool boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint target_archetypes_id_user_unique unique (id, user_id)
);

create table public.archetype_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  archetype_fk uuid not null,
  source_type text not null default 'pasted_jd'
    check (source_type in ('pasted_jd','company_page','user_note')),
  raw_content text not null default '',
  parsed_summary text not null default '',
  used_in_archetype_bool boolean not null default false,
  pinned_bool boolean not null default false,      -- v2.1.1 A7 pin/unpin
  purge_after date,                                -- 90 days post-approval unless pinned
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint archetype_sources_id_user_unique unique (id, user_id),
  constraint archetype_sources_archetype_same_user_fkey
    foreign key (archetype_fk, user_id) references public.target_archetypes (id, user_id) on delete cascade
);

create table public.gap_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  archetype_fk uuid not null,
  generated_at timestamptz not null default now(),
  covered_dimensions jsonb not null default '[]',
  gap_dimensions jsonb not null default '[]',
  recommended_actions jsonb not null default '[]',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint gap_reports_id_user_unique unique (id, user_id),
  constraint gap_reports_archetype_same_user_fkey
    foreign key (archetype_fk, user_id) references public.target_archetypes (id, user_id) on delete cascade
);

-- ── P0E: career assets, versions, collections, story bank ───────────────────
create table public.career_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_type text not null
    check (asset_type in ('resume_bullet','story','li_post','cover_letter','positioning','interview_answer')),
  current_version_fk uuid,
  source_achievement_refs uuid[] not null default '{}',
  source_evidence_refs uuid[] not null default '{}',
  target_archetype_fk uuid,
  truth_status_summary text not null default '',
  privacy_class text not null default 'INTERNAL_ONLY'
    check (privacy_class in ('PUBLIC_SAFE','INTERNAL_ONLY','PRIVATE')),
  used_externally_bool boolean not null default false,
  external_use_log jsonb not null default '[]',    -- [{at, destination, version}]
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_assets_id_user_unique unique (id, user_id),
  constraint career_assets_archetype_same_user_fkey
    foreign key (target_archetype_fk, user_id) references public.target_archetypes (id, user_id) on delete set null
);

create table public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_fk uuid not null,
  version_number integer not null,
  content text not null default '',
  generated_by_model text not null default '',
  generation_prompt_hash text not null default '',
  blocked_bool boolean not null default false,
  block_reason text not null default '',
  approved_by_user_bool boolean not null default false,
  approved_at timestamptz,
  superseded_by_fk uuid,
  created_at timestamptz not null default now(),
  constraint asset_versions_id_user_unique unique (id, user_id),
  constraint asset_versions_asset_same_user_fkey
    foreign key (asset_fk, user_id) references public.career_assets (id, user_id) on delete cascade,
  constraint asset_versions_unique_number unique (asset_fk, version_number)
);

alter table public.career_assets
  add constraint career_assets_current_version_same_user_fkey
  foreign key (current_version_fk, user_id) references public.asset_versions (id, user_id) on delete set null;

create table public.asset_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  collection_type text not null
    check (collection_type in ('resume_version','interview_pack','li_profile_draft','promotion_packet')),
  asset_refs uuid[] not null default '{}',
  target_archetype_fk uuid,
  notes text not null default '',
  current_bool boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_collections_id_user_unique unique (id, user_id),
  constraint asset_collections_archetype_same_user_fkey
    foreign key (target_archetype_fk, user_id) references public.target_archetypes (id, user_id) on delete set null
);

-- exactly one current resume_version and one current li_profile_draft (v2.1 §7)
create unique index asset_collections_one_current_idx
  on public.asset_collections (user_id, collection_type)
  where current_bool and collection_type in ('resume_version','li_profile_draft');

create table public.story_bank (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  theme text not null
    check (theme in ('leadership','conflict','ambiguity','scale','metric_impact','influence','failure','other')),
  situation text not null default '',
  task text not null default '',
  action text not null default '',
  result text not null default '',
  source_achievement_refs uuid[] not null default '{}',
  target_archetype_refs uuid[] not null default '{}',
  freshness_score integer,
  last_practiced_at timestamptz,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_bank_id_user_unique unique (id, user_id)
);

-- ── P0F: visa checklist (8 gates, v2 §6) ─────────────────────────────────────
create table public.visa_checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  state_name text not null,
  ordinal integer not null,
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','complete','blocked')),
  assumptions jsonb not null default '[]',
  risks jsonb not null default '[]',
  required_documents text[] not null default '{}',
  attorney_confirmation_required_bool boolean not null default false,
  attorney_confirmed_at timestamptz,
  attorney_confirmation_doc_ref text not null default '',
  do_not_act_until_confirmed_bool boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visa_checklist_items_id_user_unique unique (id, user_id),
  constraint visa_checklist_items_ordinal_unique unique (user_id, ordinal),
  -- attorney-gated gates cannot complete without attorney confirmation
  constraint visa_gate_attorney_confirmed
    check (not (status = 'complete' and attorney_confirmation_required_bool and attorney_confirmed_at is null))
);

-- ── P0G: weekly loop ─────────────────────────────────────────────────────────
create table public.weekly_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_of date not null,
  brief_type text not null
    check (brief_type in ('friday_capture','sunday_review','monthly_board','quarterly_narrative')),
  content_markdown text not null default '',
  market_motion_action_fk uuid,
  generated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint weekly_briefs_id_user_unique unique (id, user_id),
  constraint weekly_briefs_week_type_unique unique (user_id, week_of, brief_type)
);

create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_of date not null,
  priority_rank integer not null default 0,
  title text not null check (char_length(title) between 1 and 300),
  rationale text not null default '',
  category text not null default 'other'
    check (category in ('evidence','asset','archetype','outward','visa','other')),
  outward_facing_bool boolean not null default false,
  visa_gate_required_minimum integer,
  status text not null default 'candidate'
    check (status in ('candidate','selected','completed','dropped','archived')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_items_id_user_unique unique (id, user_id)
);

alter table public.weekly_briefs
  add constraint weekly_briefs_action_same_user_fkey
  foreign key (market_motion_action_fk, user_id) references public.action_items (id, user_id) on delete set null;

-- ── cross-cutting: AI output audit ───────────────────────────────────────────
create table public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  output_type text not null,
  model_used text not null default '',
  input_refs jsonb not null default '[]',
  output_text text not null default '',
  truth_classifications jsonb not null default '[]',
  blocked_bool boolean not null default false,
  block_reason text not null default '',
  archived_bool boolean not null default false,    -- 90-day retention policy (v2 §5)
  created_at timestamptz not null default now(),
  constraint ai_outputs_id_user_unique unique (id, user_id)
);

-- ── P1: distribution layer ───────────────────────────────────────────────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  tier text not null default '',
  gc_sponsorship_history text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_id_user_unique unique (id, user_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_fk uuid,
  name text not null check (char_length(name) between 1 and 200),
  role_title text not null default '',
  source text not null default '',                 -- incl. 'linkedin_paste'
  linkedin_paste_raw text not null default '',     -- manual paste-in capture (v2.1 §12)
  email text not null default '',
  last_touch date,
  notes text not null default '',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_id_user_unique unique (id, user_id),
  constraint contacts_company_same_user_fkey
    foreign key (company_fk, user_id) references public.companies (id, user_id) on delete set null
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_fk uuid,
  role_title text not null check (char_length(role_title) between 1 and 300),
  target_archetype_fk uuid,
  applied_at date,
  channel text not null default 'direct'
    check (channel in ('referral','direct','recruiter','other')),
  stage text not null default 'draft'
    check (stage in ('draft','applied','screening','interviewing','offer','rejected','withdrawn','closed')),
  notes text not null default '',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_id_user_unique unique (id, user_id),
  constraint applications_company_same_user_fkey
    foreign key (company_fk, user_id) references public.companies (id, user_id) on delete set null,
  constraint applications_archetype_same_user_fkey
    foreign key (target_archetype_fk, user_id) references public.target_archetypes (id, user_id) on delete set null
);

create table public.outreach (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_fk uuid not null,
  channel text not null default 'email'
    check (channel in ('email','linkedin','phone','in_person','other')),
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  occurred_at date,
  summary text not null default '',
  followup_due date,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint outreach_id_user_unique unique (id, user_id),
  constraint outreach_contact_same_user_fkey
    foreign key (contact_fk, user_id) references public.contacts (id, user_id) on delete cascade
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_fk uuid not null,
  application_fk uuid,
  stage text not null default 'identified'
    check (stage in ('identified','prepped','requested','agreed','submitted','declined','closed')),
  notes text not null default '',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referrals_id_user_unique unique (id, user_id),
  constraint referrals_contact_same_user_fkey
    foreign key (contact_fk, user_id) references public.contacts (id, user_id) on delete cascade,
  constraint referrals_application_same_user_fkey
    foreign key (application_fk, user_id) references public.applications (id, user_id) on delete set null
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_fk uuid not null,
  round text not null default '',
  scheduled_at timestamptz,
  occurred_at date,
  interviewer text not null default '',
  debrief_markdown text not null default '',       -- structured debrief
  themes jsonb not null default '[]',
  outcome text not null default 'pending'
    check (outcome in ('pending','passed','failed','canceled','unknown')),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interviews_id_user_unique unique (id, user_id),
  constraint interviews_application_same_user_fkey
    foreign key (application_fk, user_id) references public.applications (id, user_id) on delete cascade
);

create table public.comp_benchmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  archetype_fk uuid,
  source text not null default '',
  role_title text not null default '',
  total_comp_low numeric,
  total_comp_high numeric,
  as_of date,
  notes text not null default '',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint comp_benchmarks_id_user_unique unique (id, user_id),
  constraint comp_benchmarks_archetype_same_user_fkey
    foreign key (archetype_fk, user_id) references public.target_archetypes (id, user_id) on delete set null
);

-- ── v2.2.1: Offer Workbench ──────────────────────────────────────────────────
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_fk uuid,
  company_fk uuid,
  role_title text not null default '',
  received_at date,
  status text not null default 'draft'
    check (status in ('draft','received','negotiating','accepted','declined','expired','withdrawn')),
  base_salary numeric,
  base_currency text not null default 'USD',
  bonus_target_pct numeric,
  bonus_structure_notes text not null default '',
  equity_grant_value numeric,
  equity_vest_schedule_notes text not null default '',
  equity_refresh_notes text not null default '',
  signing_bonus numeric,
  signing_bonus_clawback_notes text not null default '',
  relocation_package text not null default '',
  other_comp_notes text not null default '',
  benefits_summary text not null default '',
  visa_sponsorship_committed_bool boolean not null default false,
  priority_date_retention_committed_bool boolean not null default false,
  visa_sponsorship_terms_text text not null default '',
  attorney_reviewed_at timestamptz,
  attorney_reviewed_doc_ref text not null default '',
  attorney_notes text not null default '',
  expiration_date date,
  decision_due_by date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_id_user_unique unique (id, user_id),
  constraint offers_application_same_user_fkey
    foreign key (application_fk, user_id) references public.applications (id, user_id) on delete set null,
  constraint offers_company_same_user_fkey
    foreign key (company_fk, user_id) references public.companies (id, user_id) on delete set null
);

create table public.offer_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  offer_fk uuid not null,
  scenario_name text not null check (char_length(scenario_name) between 1 and 200),
  assumptions jsonb not null default '[]',
  total_comp_yr1 numeric,                          -- user-entered snapshot, not computed
  total_comp_yr4 numeric,                          -- user-entered snapshot, not computed
  delta_vs_current jsonb not null default '{}',
  notes text not null default '',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint offer_scenarios_id_user_unique unique (id, user_id),
  constraint offer_scenarios_offer_same_user_fkey
    foreign key (offer_fk, user_id) references public.offers (id, user_id) on delete cascade
);

create table public.counter_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  offer_fk uuid not null,
  proposed_changes jsonb not null default '[]',
  rationale text not null default '',
  supporting_benchmark_refs uuid[] not null default '{}',
  sent_at date,                                    -- staged and recorded; never sent by the app
  response_at date,
  response_summary text not null default '',
  outcome text
    check (outcome is null or outcome in ('accepted','partially_accepted','rejected','countered','no_response')),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint counter_proposals_id_user_unique unique (id, user_id),
  constraint counter_proposals_offer_same_user_fkey
    foreign key (offer_fk, user_id) references public.offers (id, user_id) on delete cascade
);

-- Gate 7 enforcement (v2.2.1 §3): an offer cannot be accepted while Visa Gate 7
-- is incomplete, and Gate 7 completion itself requires both sponsorship
-- commitments plus attorney review on the offer.
create or replace function public.ccc_enforce_offer_acceptance()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') then
    if not (new.visa_sponsorship_committed_bool
            and new.priority_date_retention_committed_bool
            and new.attorney_reviewed_at is not null) then
      raise exception 'offer cannot be accepted: sponsorship commitment, priority-date retention, and attorney review are required (Gate 7)';
    end if;
    if not exists (
      select 1 from public.visa_checklist_items v
       where v.user_id = new.user_id and v.ordinal = 7 and v.status = 'complete'
    ) then
      raise exception 'offer cannot be accepted while Visa Checklist Gate 7 is incomplete';
    end if;
  end if;
  return new;
end;
$$;

create trigger ccc_offers_acceptance_gate
  before update on public.offers
  for each row execute function public.ccc_enforce_offer_acceptance();

-- ── skills & development (v2 §3, v2.2.1 §4) ──────────────────────────────────
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  category text not null default 'technical'
    check (category in ('technical','domain','leadership','tooling')),
  director_relevance_score integer
    check (director_relevance_score is null or director_relevance_score between 1 and 5),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skills_id_user_unique unique (id, user_id)
);

create table public.skill_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  skill_fk uuid not null,
  achievement_fk uuid not null,
  demonstration_strength_1_to_5 integer not null
    check (demonstration_strength_1_to_5 between 1 and 5),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint skill_evidence_id_user_unique unique (id, user_id),
  constraint skill_evidence_skill_same_user_fkey
    foreign key (skill_fk, user_id) references public.skills (id, user_id) on delete cascade,
  constraint skill_evidence_achievement_same_user_fkey
    foreign key (achievement_fk, user_id) references public.achievements (id, user_id) on delete cascade
);

create table public.skill_development_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  skill_fk uuid not null,
  gap_source text not null default 'self_identified'
    check (gap_source in ('archetype_comparator','self_identified','interview_feedback','manager_feedback','reference_feedback')),
  gap_report_fk uuid,
  current_level_1_to_5 integer check (current_level_1_to_5 is null or current_level_1_to_5 between 1 and 5),
  target_level_1_to_5 integer check (target_level_1_to_5 is null or target_level_1_to_5 between 1 and 5),
  rationale text not null default '',
  target_archetype_refs uuid[] not null default '{}',
  method text not null default 'work_project'
    check (method in ('work_project','side_project','course','certification','reading','mentorship','teaching','other')),
  method_details text not null default '',
  estimated_hours numeric,
  start_date date,
  target_date date,
  status text not null default 'planned'
    check (status in ('planned','in_progress','completed','paused','abandoned')),
  abandon_reason text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skill_development_plans_id_user_unique unique (id, user_id),
  constraint sdp_skill_same_user_fkey
    foreign key (skill_fk, user_id) references public.skills (id, user_id) on delete cascade,
  constraint sdp_gap_report_same_user_fkey
    foreign key (gap_report_fk, user_id) references public.gap_reports (id, user_id) on delete set null
);

create table public.skill_development_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_fk uuid not null,
  progress_date date not null default current_date,
  notes text not null default '',
  linked_achievement_fk uuid,
  hours_invested numeric,
  level_assessment_1_to_5 integer
    check (level_assessment_1_to_5 is null or level_assessment_1_to_5 between 1 and 5),
  assessed_by text
    check (assessed_by is null or assessed_by in ('self','peer','manager','external')),
  created_at timestamptz not null default now(),
  constraint skill_development_progress_id_user_unique unique (id, user_id),
  constraint sdpr_plan_same_user_fkey
    foreign key (plan_fk, user_id) references public.skill_development_plans (id, user_id) on delete cascade,
  constraint sdpr_achievement_same_user_fkey
    foreign key (linked_achievement_fk, user_id) references public.achievements (id, user_id) on delete set null
);

-- ── v2.2.1: references (overlay on contacts) ─────────────────────────────────
create table public."references" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_fk uuid not null,
  reference_type text not null default 'other'
    check (reference_type in ('manager','skip_level','peer','direct_report','executive','client','external_partner','other')),
  employer_at_time text not null default '',
  working_relationship_period_start date,
  working_relationship_period_end date,
  relationship_summary text not null default '',
  strongest_themes jsonb not null default '[]',
  willingness_status text not null default 'unconfirmed'
    check (willingness_status in ('unconfirmed','confirmed','tentative','declined','do_not_ask')),
  willingness_confirmed_at timestamptz,
  willingness_notes text not null default '',
  last_briefed_at timestamptz,
  current_narrative_version_fk uuid,
  briefing_method text
    check (briefing_method is null or briefing_method in ('in_person','video_call','email','li_message','other')),
  cadence_target_months integer,
  last_touch_date date,
  next_touch_due date,
  used_for_application_refs uuid[] not null default '{}',
  notes text not null default '',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint references_id_user_unique unique (id, user_id),
  constraint references_contact_same_user_fkey
    foreign key (contact_fk, user_id) references public.contacts (id, user_id) on delete cascade,
  constraint references_narrative_same_user_fkey
    foreign key (current_narrative_version_fk, user_id) references public.asset_versions (id, user_id) on delete set null,
  -- a reference cannot be used in applications until willingness is confirmed
  constraint references_use_requires_confirmed
    check (cardinality(used_for_application_refs) = 0 or willingness_status = 'confirmed')
);

-- ── P1 ingestion (real Google OAuth, v2 §8) ──────────────────────────────────
create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail','calendar')),
  scopes text[] not null default '{}',
  account_email text not null default '',
  refresh_token_encrypted text not null default '',  -- encrypted server-side; never rendered
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_status text not null default '',
  revoked_at timestamptz,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint google_connections_id_user_unique unique (id, user_id),
  constraint google_connections_one_per_provider unique (user_id, provider)
);

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_fk uuid not null,
  ran_at timestamptz not null default now(),
  items_found integer not null default 0,
  run_status text not null default 'ok' check (run_status in ('ok','error')),
  error text not null default '',
  created_at timestamptz not null default now(),
  constraint ingestion_runs_id_user_unique unique (id, user_id),
  constraint ingestion_runs_connection_same_user_fkey
    foreign key (connection_fk, user_id) references public.google_connections (id, user_id) on delete cascade
);

create table public.ingested_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_fk uuid not null,
  external_id text not null,
  kind text not null default 'other'
    check (kind in ('job_alert','profile_views','connection_request','recruiter_inmail','calendar_event','other')),
  summary text not null default '',
  occurred_at timestamptz,
  converted_evidence_fk uuid,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint ingested_items_id_user_unique unique (id, user_id),
  constraint ingested_items_idempotent unique (user_id, external_id),
  constraint ingested_items_connection_same_user_fkey
    foreign key (connection_fk, user_id) references public.google_connections (id, user_id) on delete cascade,
  constraint ingested_items_evidence_same_user_fkey
    foreign key (converted_evidence_fk, user_id) references public.evidence_items (id, user_id) on delete set null
);

-- ── owner overrides (maturity dev override; every use is logged) ─────────────
create table public.owner_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  override_key text not null,
  enabled_bool boolean not null default false,
  reason text not null default '',
  created_at timestamptz not null default now(),
  constraint owner_overrides_id_user_unique unique (id, user_id)
);

-- ── updated_at triggers ──────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'sanitized_claims','target_archetypes','career_assets','asset_collections',
    'story_bank','visa_checklist_items','action_items','companies','contacts',
    'applications','referrals','interviews','offers','skills',
    'skill_development_plans','references'
  ] loop
    execute format(
      'create trigger ccc_%s_updated_at before update on public.%I
         for each row execute function public.ccc_set_updated_at()', t, t);
  end loop;
end $$;

-- ── RLS: user-scoped select/insert/update/delete on every table ──────────────
do $$
declare t text;
begin
  foreach t in array array[
    'sanitized_claims','grader_evaluations','target_archetypes','archetype_sources',
    'gap_reports','career_assets','asset_versions','asset_collections','story_bank',
    'visa_checklist_items','weekly_briefs','action_items','ai_outputs','companies',
    'contacts','applications','outreach','referrals','interviews','comp_benchmarks',
    'offers','offer_scenarios','counter_proposals','skills','skill_evidence',
    'skill_development_plans','skill_development_progress','references',
    'google_connections','ingestion_runs','ingested_items','owner_overrides'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s_select_own" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_update_own" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_delete_own" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('create index %s_user_id_idx on public.%I (user_id)', t, t);
  end loop;
end $$;
