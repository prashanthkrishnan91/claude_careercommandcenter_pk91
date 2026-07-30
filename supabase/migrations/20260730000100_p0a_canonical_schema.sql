-- Career Command Center — canonical P0A schema.
--
-- Source of truth: Architecture v2.1 §3 (P0A entities) with the v2.1.1
-- amendments folded in (A1 explicit user_id, A2 lifecycle status,
-- A3 candidate_for_external_bool), under the v2.2.2 scope guards.
--
-- Four entities only: projects, achievements, metrics, evidence_items.
-- Lifecycle is archival — the product never hard-deletes. RLS scopes every
-- read/write/delete to the authenticated user (v2.1.1 A1). Composite
-- ownership foreign keys make cross-user linking impossible at the database
-- level: a child row's (fk, user_id) must match a parent owned by the same
-- user.
--
-- The hermetic test suite loads this exact file, so schema drift breaks tests.

create or replace function public.ccc_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── projects ─────────────────────────────────────────────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  employer text not null default '',
  role_at_time text not null default '',
  start_date date,
  end_date date,
  description text not null default '',
  business_context text not null default '',
  my_scope text not null default '',
  team_size integer check (team_size is null or team_size >= 0),
  stakeholders text[] not null default '{}',
  privacy_class text not null default 'INTERNAL_ONLY'
    check (privacy_class in ('PUBLIC_SAFE','INTERNAL_ONLY','PRIVATE')),
  status text not null default 'active'
    check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_id_user_unique unique (id, user_id)
);

-- ── achievements ─────────────────────────────────────────────────────────────
create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_fk uuid not null,
  headline text not null check (char_length(headline) between 1 and 300),
  narrative text not null default '',
  action_taken text not null default '',
  outcome text not null default '',
  start_date date,
  end_date date,
  claimed_seniority_level text
    check (claimed_seniority_level is null
           or claimed_seniority_level in ('ic','sr','mgr','sr_mgr','dir')),
  truth_status text not null default 'NEEDS_PROOF'
    check (truth_status in ('VERIFIED','ATTESTED_WITH_METRIC','ATTESTED_NO_METRIC',
                            'INFERRED','NEEDS_PROOF','DISPUTED')),
  privacy_class text not null default 'INTERNAL_ONLY'
    check (privacy_class in ('PUBLIC_SAFE','INTERNAL_ONLY','PRIVATE')),
  has_metric_bool boolean not null default false,
  candidate_for_external_bool boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint achievements_id_user_unique unique (id, user_id),
  -- Same-user ownership enforced by the database: the referenced project must
  -- belong to the same user_id as this achievement.
  constraint achievements_project_same_user_fkey
    foreign key (project_fk, user_id)
    references public.projects (id, user_id) on delete cascade
);

-- ── metrics ──────────────────────────────────────────────────────────────────
-- value/baseline_value are text on purpose: the vault stores exactly what the
-- user entered. No normalization, no inference (truth policy, v2.1 §4).
create table public.metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  achievement_fk uuid not null,
  metric_name text not null check (char_length(metric_name) between 1 and 300),
  value text not null check (char_length(value) between 1 and 300),
  unit text not null default '',
  time_period text not null default '',
  baseline_value text not null default '',
  calculation_notes text not null default '',
  truth_status text not null default 'NEEDS_PROOF'
    check (truth_status in ('VERIFIED','ATTESTED_WITH_METRIC','ATTESTED_NO_METRIC',
                            'INFERRED','NEEDS_PROOF','DISPUTED')),
  privacy_class text not null default 'INTERNAL_ONLY'
    check (privacy_class in ('PUBLIC_SAFE','INTERNAL_ONLY','PRIVATE')),
  status text not null default 'active'
    check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint metrics_id_user_unique unique (id, user_id),
  constraint metrics_achievement_same_user_fkey
    foreign key (achievement_fk, user_id)
    references public.achievements (id, user_id) on delete cascade
);

-- ── evidence_items ───────────────────────────────────────────────────────────
create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  achievement_fk uuid not null,
  type text not null
    check (type in ('link','email_ref','note','testimonial','metric_source')),
  content_summary text not null check (char_length(content_summary) between 1 and 10000),
  external_url text not null default ''
    check (external_url = '' or external_url ~ '^https?://'),
  privacy_class text not null default 'INTERNAL_ONLY'
    check (privacy_class in ('PUBLIC_SAFE','INTERNAL_ONLY','PRIVATE')),
  verified_at timestamptz,
  verified_by text
    check (verified_by is null or verified_by in ('self','peer','manager','document')),
  status text not null default 'active'
    check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint evidence_items_id_user_unique unique (id, user_id),
  constraint evidence_items_achievement_same_user_fkey
    foreign key (achievement_fk, user_id)
    references public.achievements (id, user_id) on delete cascade
);

-- ── updated_at triggers (projects and achievements carry updated_at) ─────────
create trigger ccc_projects_updated_at before update on public.projects
  for each row execute function public.ccc_set_updated_at();
create trigger ccc_achievements_updated_at before update on public.achievements
  for each row execute function public.ccc_set_updated_at();

-- ── has_metric_bool sync ─────────────────────────────────────────────────────
-- v2.1 defines achievements.has_metric_bool; the database keeps it true iff
-- the achievement has at least one active (non-archived) metric.
create or replace function public.ccc_recount_has_metric(aid uuid)
returns void
language sql
as $$
  update public.achievements a
     set has_metric_bool = exists (
       select 1 from public.metrics m
        where m.achievement_fk = aid and m.status = 'active')
   where a.id = aid;
$$;

create or replace function public.ccc_sync_has_metric()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.ccc_recount_has_metric(old.achievement_fk);
  elsif tg_op = 'INSERT' then
    perform public.ccc_recount_has_metric(new.achievement_fk);
  else
    perform public.ccc_recount_has_metric(new.achievement_fk);
    if new.achievement_fk is distinct from old.achievement_fk then
      perform public.ccc_recount_has_metric(old.achievement_fk);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger ccc_metrics_sync_has_metric
  after insert or update or delete on public.metrics
  for each row execute function public.ccc_sync_has_metric();

-- ── indexes ──────────────────────────────────────────────────────────────────
create index projects_user_id_idx on public.projects (user_id);
create index projects_user_status_idx on public.projects (user_id, status);
create index achievements_user_id_idx on public.achievements (user_id);
create index achievements_user_status_idx on public.achievements (user_id, status);
create index achievements_project_fk_idx on public.achievements (project_fk);
create index metrics_user_id_idx on public.metrics (user_id);
create index metrics_achievement_fk_idx on public.metrics (achievement_fk);
create index evidence_items_user_id_idx on public.evidence_items (user_id);
create index evidence_items_achievement_fk_idx on public.evidence_items (achievement_fk);

-- ── RLS: every read, write, and delete scoped to the authenticated user ──────
-- (v2.1.1 A1). The product surface never deletes — lifecycle archival only —
-- but the scoped delete policy exists for account cleanup and isolated test
-- tooling.
alter table public.projects enable row level security;
alter table public.achievements enable row level security;
alter table public.metrics enable row level security;
alter table public.evidence_items enable row level security;

create policy "projects_select_own" on public.projects
  for select to authenticated using (user_id = (select auth.uid()));
create policy "projects_insert_own" on public.projects
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "projects_update_own" on public.projects
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "projects_delete_own" on public.projects
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "achievements_select_own" on public.achievements
  for select to authenticated using (user_id = (select auth.uid()));
create policy "achievements_insert_own" on public.achievements
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "achievements_update_own" on public.achievements
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "achievements_delete_own" on public.achievements
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "metrics_select_own" on public.metrics
  for select to authenticated using (user_id = (select auth.uid()));
create policy "metrics_insert_own" on public.metrics
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "metrics_update_own" on public.metrics
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "metrics_delete_own" on public.metrics
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "evidence_items_select_own" on public.evidence_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "evidence_items_insert_own" on public.evidence_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "evidence_items_update_own" on public.evidence_items
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "evidence_items_delete_own" on public.evidence_items
  for delete to authenticated using (user_id = (select auth.uid()));
