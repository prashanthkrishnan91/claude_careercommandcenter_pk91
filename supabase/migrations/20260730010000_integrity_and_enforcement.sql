-- Integrity & enforcement corrections (release-blocker pass).
--
-- 1. Normalized junction tables replace UUID-array relationships, each with
--    user_id + composite same-user FKs to BOTH parents, uniqueness, and RLS.
-- 2. Version-chain integrity triggers (current version belongs to the asset;
--    supersession points to a later version of the same asset — no cycles).
-- 3. Offer acceptance enforced on INSERT and UPDATE; Visa Gate 7 must
--    reference the specific qualifying offer; de-qualifying an accepted
--    offer is blocked.
-- 4. Database-authoritative maturity enforcement: a non-client-writable
--    maturity_state maintained by a SECURITY DEFINER recompute function
--    (justified: it must write a table clients cannot), P1 write policies
--    gated on it, and a tamper-proof, fully logged owner override.
-- 5. Explicit approval state for story-bank entries and collections;
--    asset eligibility staleness columns.

-- ── approvals & staleness columns ────────────────────────────────────────────
alter table public.story_bank
  add column approved_by_user_bool boolean not null default false,
  add column approved_at timestamptz;
alter table public.asset_collections
  add column approved_by_user_bool boolean not null default false,
  add column approved_at timestamptz;
alter table public.career_assets
  add column eligibility_stale_bool boolean not null default false,
  add column eligibility_reason text not null default '';
alter table public.visa_checklist_items
  add column qualifying_offer_fk uuid,
  add constraint visa_gate_offer_same_user_fkey
    foreign key (qualifying_offer_fk, user_id) references public.offers (id, user_id) on delete set null;

-- ── junction tables (drop the array columns they replace) ───────────────────
create table public.asset_source_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_fk uuid not null,
  achievement_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint asa_unique unique (asset_fk, achievement_fk),
  constraint asa_asset_same_user_fkey foreign key (asset_fk, user_id)
    references public.career_assets (id, user_id) on delete cascade,
  constraint asa_achievement_same_user_fkey foreign key (achievement_fk, user_id)
    references public.achievements (id, user_id) on delete cascade
);
create table public.asset_source_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_fk uuid not null,
  evidence_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint ase_unique unique (asset_fk, evidence_fk),
  constraint ase_asset_same_user_fkey foreign key (asset_fk, user_id)
    references public.career_assets (id, user_id) on delete cascade,
  constraint ase_evidence_same_user_fkey foreign key (evidence_fk, user_id)
    references public.evidence_items (id, user_id) on delete cascade
);
create table public.asset_source_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_fk uuid not null,
  metric_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint asm_unique unique (asset_fk, metric_fk),
  constraint asm_asset_same_user_fkey foreign key (asset_fk, user_id)
    references public.career_assets (id, user_id) on delete cascade,
  constraint asm_metric_same_user_fkey foreign key (metric_fk, user_id)
    references public.metrics (id, user_id) on delete cascade
);
create table public.collection_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection_fk uuid not null,
  asset_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint ca_unique unique (collection_fk, asset_fk),
  constraint ca_collection_same_user_fkey foreign key (collection_fk, user_id)
    references public.asset_collections (id, user_id) on delete cascade,
  constraint ca_asset_same_user_fkey foreign key (asset_fk, user_id)
    references public.career_assets (id, user_id) on delete cascade
);
create table public.story_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  story_fk uuid not null,
  achievement_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint sta_unique unique (story_fk, achievement_fk),
  constraint sta_story_same_user_fkey foreign key (story_fk, user_id)
    references public.story_bank (id, user_id) on delete cascade,
  constraint sta_achievement_same_user_fkey foreign key (achievement_fk, user_id)
    references public.achievements (id, user_id) on delete cascade
);
create table public.story_archetypes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  story_fk uuid not null,
  archetype_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint star_unique unique (story_fk, archetype_fk),
  constraint star_story_same_user_fkey foreign key (story_fk, user_id)
    references public.story_bank (id, user_id) on delete cascade,
  constraint star_archetype_same_user_fkey foreign key (archetype_fk, user_id)
    references public.target_archetypes (id, user_id) on delete cascade
);
create table public.plan_archetypes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_fk uuid not null,
  archetype_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint pa_unique unique (plan_fk, archetype_fk),
  constraint pa_plan_same_user_fkey foreign key (plan_fk, user_id)
    references public.skill_development_plans (id, user_id) on delete cascade,
  constraint pa_archetype_same_user_fkey foreign key (archetype_fk, user_id)
    references public.target_archetypes (id, user_id) on delete cascade
);
create table public.reference_application_uses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reference_fk uuid not null,
  application_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint rau_unique unique (reference_fk, application_fk),
  constraint rau_reference_same_user_fkey foreign key (reference_fk, user_id)
    references public."references" (id, user_id) on delete cascade,
  constraint rau_application_same_user_fkey foreign key (application_fk, user_id)
    references public.applications (id, user_id) on delete cascade
);
create table public.counter_benchmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  counter_fk uuid not null,
  benchmark_fk uuid not null,
  created_at timestamptz not null default now(),
  constraint cb_unique unique (counter_fk, benchmark_fk),
  constraint cb_counter_same_user_fkey foreign key (counter_fk, user_id)
    references public.counter_proposals (id, user_id) on delete cascade,
  constraint cb_benchmark_same_user_fkey foreign key (benchmark_fk, user_id)
    references public.comp_benchmarks (id, user_id) on delete cascade
);

-- a reference may be used for an application only once willingness is confirmed
create or replace function public.ccc_enforce_reference_use()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public."references" r
     where r.id = new.reference_fk and r.willingness_status = 'confirmed'
  ) then
    raise exception 'reference cannot be used: willingness is not confirmed';
  end if;
  return new;
end; $$;
create trigger ccc_reference_use_gate before insert on public.reference_application_uses
  for each row execute function public.ccc_enforce_reference_use();

-- drop the replaced array columns and the superseded array-based constraint
alter table public."references" drop constraint references_use_requires_confirmed;
alter table public."references" drop column used_for_application_refs;
alter table public.career_assets drop column source_achievement_refs, drop column source_evidence_refs;
alter table public.asset_collections drop column asset_refs;
alter table public.story_bank drop column source_achievement_refs, drop column target_archetype_refs;
alter table public.skill_development_plans drop column target_archetype_refs;
alter table public.counter_proposals drop column supporting_benchmark_refs;

-- ── version-chain integrity ──────────────────────────────────────────────────
create or replace function public.ccc_check_current_version()
returns trigger language plpgsql as $$
begin
  if new.current_version_fk is not null and not exists (
    select 1 from public.asset_versions v
     where v.id = new.current_version_fk and v.asset_fk = new.id and v.user_id = new.user_id
  ) then
    raise exception 'current_version_fk must reference a version of this same asset';
  end if;
  return new;
end; $$;
create trigger ccc_assets_current_version_check before insert or update on public.career_assets
  for each row execute function public.ccc_check_current_version();

create or replace function public.ccc_check_supersession()
returns trigger language plpgsql as $$
declare target record;
begin
  if new.superseded_by_fk is not null then
    select v.asset_fk, v.user_id, v.version_number into target
      from public.asset_versions v where v.id = new.superseded_by_fk;
    if target is null or target.asset_fk <> new.asset_fk or target.user_id <> new.user_id then
      raise exception 'superseded_by_fk must reference a version of the same asset and user';
    end if;
    if target.version_number <= new.version_number then
      raise exception 'superseded_by_fk must reference a LATER version (no cycles)';
    end if;
  end if;
  return new;
end; $$;
create trigger ccc_versions_supersession_check before insert or update on public.asset_versions
  for each row execute function public.ccc_check_supersession();

-- ── offers × Visa Gate 7 ─────────────────────────────────────────────────────
drop trigger if exists ccc_offers_acceptance_gate on public.offers;

create or replace function public.ccc_enforce_offer_acceptance()
returns trigger language plpgsql as $$
begin
  if new.status = 'accepted' then
    if not (new.visa_sponsorship_committed_bool
            and new.priority_date_retention_committed_bool
            and new.attorney_reviewed_at is not null
            and new.attorney_reviewed_doc_ref <> '') then
      raise exception 'offer cannot be accepted: written sponsorship commitment, priority-date retention, attorney review date AND document reference are required (Gate 7)';
    end if;
    if not exists (
      select 1 from public.visa_checklist_items v
       where v.user_id = new.user_id and v.ordinal = 7 and v.status = 'complete'
         and v.qualifying_offer_fk = new.id
    ) then
      raise exception 'offer cannot be accepted: Visa Gate 7 must be complete and reference THIS offer as its qualifying offer';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'accepted' and new.status = 'accepted' then
    if not (new.visa_sponsorship_committed_bool and new.priority_date_retention_committed_bool
            and new.attorney_reviewed_at is not null) then
      raise exception 'an accepted offer cannot lose its sponsorship/attorney commitments; move it out of accepted first';
    end if;
  end if;
  return new;
end; $$;
create trigger ccc_offers_acceptance_gate before insert or update on public.offers
  for each row execute function public.ccc_enforce_offer_acceptance();

create or replace function public.ccc_enforce_gate7()
returns trigger language plpgsql as $$
begin
  if new.ordinal = 7 and new.status = 'complete' then
    if new.qualifying_offer_fk is null then
      raise exception 'Gate 7 cannot complete without a specific qualifying offer';
    end if;
    if not exists (
      select 1 from public.offers o
       where o.id = new.qualifying_offer_fk and o.user_id = new.user_id
         and o.visa_sponsorship_committed_bool
         and o.priority_date_retention_committed_bool
         and o.attorney_reviewed_at is not null
    ) then
      raise exception 'Gate 7 qualifying offer must carry both written commitments and attorney review';
    end if;
  end if;
  return new;
end; $$;
create trigger ccc_visa_gate7_check before insert or update on public.visa_checklist_items
  for each row execute function public.ccc_enforce_gate7();

-- ── maturity enforcement (database-authoritative) ────────────────────────────
create table public.maturity_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  unlocked_bool boolean not null default false,
  criteria jsonb not null default '{}',
  computed_at timestamptz not null default now()
);
create table public.override_mutations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  row_id uuid,
  operation text not null,
  created_at timestamptz not null default now()
);
alter table public.maturity_state enable row level security;
alter table public.override_mutations enable row level security;
-- read-only to clients; ONLY the definer functions/triggers below write them
create policy "maturity_state_select_own" on public.maturity_state
  for select to authenticated using (user_id = (select auth.uid()));
create policy "override_mutations_select_own" on public.override_mutations
  for select to authenticated using (user_id = (select auth.uid()));

-- owner_overrides becomes read-only to clients; writes go through the RPC
drop policy "owner_overrides_insert_own" on public.owner_overrides;
drop policy "owner_overrides_update_own" on public.owner_overrides;
drop policy "owner_overrides_delete_own" on public.owner_overrides;

-- SECURITY DEFINER (justified): must write client-read-only tables. Scoped
-- strictly to auth.uid(); reason is mandatory; every call is a logged row.
create or replace function public.ccc_set_override(p_key text, p_enabled boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_key not in ('maturity_dev_override','market_motion_override') then
    raise exception 'unknown override key';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for every override change';
  end if;
  insert into owner_overrides (user_id, override_key, enabled_bool, reason)
  values (auth.uid(), p_key, p_enabled, p_reason);
end; $$;

create or replace function public.ccc_override_active(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select o.enabled_bool from owner_overrides o
     where o.user_id = uid and o.override_key = 'maturity_dev_override'
     order by o.created_at desc limit 1), false);
$$;

create or replace function public.ccc_p1_unlocked(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select m.unlocked_bool from maturity_state m where m.user_id = uid), false)
      or public.ccc_override_active(uid);
$$;

-- Recompute the full v2.1 §15 gate set from real rows and persist the state.
create or replace function public.ccc_recompute_maturity()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c jsonb := '{}';
  fridays int; sundays int; monthlies int; achv int; graded int; director int;
  sanitized int; archetypes int; jd int; bullets_ok boolean; star boolean;
  coll boolean; needs_proof boolean; private_ext boolean; all_met boolean;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  -- consecutive reviewed Friday Captures ending at the latest one
  select coalesce(max(run), 0) into fridays from (
    select count(*) as run from (
      select week_of, row_number() over (order by week_of desc) rn
        from weekly_briefs
       where user_id = uid and brief_type = 'friday_capture' and reviewed_at is not null
    ) t where t.week_of = (
      select max(week_of) from weekly_briefs
       where user_id = uid and brief_type = 'friday_capture' and reviewed_at is not null
    ) - ((t.rn - 1) * 7)
  ) s;

  select count(*) into sundays from weekly_briefs b
   where b.user_id = uid and b.brief_type = 'sunday_review' and b.reviewed_at is not null
     and (select count(*) from action_items a
           where a.user_id = uid and a.week_of = b.week_of
             and a.status in ('selected','completed')) >= 3;

  select count(*) into monthlies from weekly_briefs
   where user_id = uid and brief_type = 'monthly_board' and reviewed_at is not null;

  select count(*) into achv from achievements where user_id = uid and status <> 'archived';

  select count(distinct e.achievement_fk) into graded
    from grader_evaluations e join achievements a on a.id = e.achievement_fk
   where e.user_id = uid and e.status = 'active' and a.status <> 'archived';

  -- director-signal from the LATEST active evaluation per non-archived achievement
  select count(*) into director from (
    select distinct on (e.achievement_fk) e.dimensions
      from grader_evaluations e join achievements a on a.id = e.achievement_fk
     where e.user_id = uid and e.status = 'active' and a.status <> 'archived'
     order by e.achievement_fk, e.evaluated_at desc
  ) latest
  where (select count(*) from jsonb_array_elements(latest.dimensions) d where (d->>'score')::int >= 4) >= 4
    and coalesce((select (d->>'score')::int from jsonb_array_elements(latest.dimensions) d
                   where d->>'dimension' = 'cross_functional_influence'), 0) >= 4
    and coalesce((select (d->>'score')::int from jsonb_array_elements(latest.dimensions) d
                   where d->>'dimension' = 'scope_scale'), 0) >= 4
    and coalesce((select (d->>'score')::int from jsonb_array_elements(latest.dimensions) d
                   where d->>'dimension' = 'ownership'), 0) >= 3;

  select count(*) into sanitized from sanitized_claims
   where user_id = uid and status = 'active' and user_approved_at is not null;

  select count(*), count(*) filter (where source_type <> 'user_defined')
    into archetypes, jd
    from target_archetypes where user_id = uid and status = 'active' and approved_by_user_bool;

  select archetypes > 0 and not exists (
    select 1 from target_archetypes t
     where t.user_id = uid and t.status = 'active' and t.approved_by_user_bool
       and not exists (
         select 1 from career_assets ca
          where ca.user_id = uid and ca.status = 'active' and ca.asset_type = 'resume_bullet'
            and ca.target_archetype_fk = t.id and not ca.eligibility_stale_bool
            and exists (select 1 from asset_versions v
                         where v.asset_fk = ca.id and v.approved_by_user_bool))
  ) into bullets_ok;

  select exists (
    select 1 from story_bank s
     where s.user_id = uid and s.status = 'active' and s.approved_by_user_bool
       and s.theme in ('leadership','scale')
       and s.situation <> '' and s.task <> '' and s.action <> '' and s.result <> ''
  ) into star;

  select exists (
    select 1 from asset_collections col
     where col.user_id = uid and col.status = 'active' and col.current_bool
       and col.approved_by_user_bool
       and col.collection_type in ('resume_version','interview_pack')
       and exists (select 1 from collection_assets ca where ca.collection_fk = col.id)
       and not exists (
         select 1 from collection_assets ca join career_assets a on a.id = ca.asset_fk
          where ca.collection_fk = col.id
            and (a.eligibility_stale_bool or a.status <> 'active'
                 or not exists (select 1 from asset_versions v
                                 where v.asset_fk = a.id and v.approved_by_user_bool)))
  ) into coll;

  -- hygiene over EVERY source of approved asset versions (achievements,
  -- metrics via junctions), plus staleness
  select exists (
    select 1 from career_assets a
     where a.user_id = uid
       and exists (select 1 from asset_versions v where v.asset_fk = a.id and v.approved_by_user_bool)
       and (a.eligibility_stale_bool
            or exists (select 1 from asset_source_achievements j join achievements s on s.id = j.achievement_fk
                        where j.asset_fk = a.id and s.truth_status in ('NEEDS_PROOF','INFERRED','DISPUTED'))
            or exists (select 1 from asset_source_metrics j join metrics m on m.id = j.metric_fk
                        where j.asset_fk = a.id and m.truth_status in ('NEEDS_PROOF','INFERRED','DISPUTED')))
  ) into needs_proof;

  select exists (
    select 1 from career_assets a
     where a.user_id = uid and a.used_externally_bool
       and (exists (select 1 from asset_source_achievements j join achievements s on s.id = j.achievement_fk
                     where j.asset_fk = a.id and s.privacy_class = 'PRIVATE'
                       and not exists (select 1 from sanitized_claims sc
                                        where sc.source_achievement_fk = s.id and sc.user_approved_at is not null))
         or exists (select 1 from asset_source_metrics j join metrics m on m.id = j.metric_fk
                     where j.asset_fk = a.id and m.privacy_class = 'PRIVATE')
         or exists (select 1 from asset_source_evidence j join evidence_items e on e.id = j.evidence_fk
                     where j.asset_fk = a.id and e.privacy_class = 'PRIVATE'))
  ) into private_ext;

  c := jsonb_build_object(
    'friday_captures',    jsonb_build_object('met', fridays >= 4,   'detail', fridays || ' consecutive completed'),
    'sunday_reviews',     jsonb_build_object('met', sundays >= 4,   'detail', sundays || ' reviewed with top-3 selected'),
    'monthly_board',      jsonb_build_object('met', monthlies >= 1, 'detail', monthlies || ' completed'),
    'achievements_15',    jsonb_build_object('met', achv >= 15,     'detail', achv || ' logged'),
    'graded_10',          jsonb_build_object('met', graded >= 10,   'detail', graded || ' graded'),
    'director_5',         jsonb_build_object('met', director >= 5,  'detail', director || ' qualify (latest evaluation per achievement)'),
    'sanitized_5',        jsonb_build_object('met', sanitized >= 5, 'detail', sanitized || ' approved'),
    'archetypes_2',       jsonb_build_object('met', archetypes >= 2 and jd >= 1, 'detail', archetypes || ' approved, ' || jd || ' JD-derived'),
    'bullet_per_archetype', jsonb_build_object('met', bullets_ok, 'detail', case when bullets_ok then 'covered' else 'missing for at least one archetype' end),
    'star_story',         jsonb_build_object('met', star, 'detail', case when star then 'approved story present' else 'no approved Leadership/Scale story' end),
    'collection_current', jsonb_build_object('met', coll, 'detail', case when coll then 'approved current collection with eligible contents' else 'none qualifying' end),
    'no_needs_proof',     jsonb_build_object('met', not needs_proof, 'detail', case when needs_proof then 'violation present' else 'clean' end),
    'no_private_external',jsonb_build_object('met', not private_ext, 'detail', case when private_ext then 'violation present' else 'clean' end)
  );
  select bool_and((v.value->>'met')::boolean) into all_met from jsonb_each(c) v;

  insert into maturity_state (user_id, unlocked_bool, criteria, computed_at)
  values (uid, all_met, c, now())
  on conflict (user_id) do update
    set unlocked_bool = excluded.unlocked_bool, criteria = excluded.criteria, computed_at = now();

  return jsonb_build_object('unlocked', all_met, 'override_active', public.ccc_override_active(uid), 'criteria', c);
end; $$;

-- gate P1 distribution writes on maturity (or the logged override)
do $$
declare t text;
begin
  foreach t in array array[
    'companies','contacts','outreach','referrals','applications','interviews',
    'offers','offer_scenarios','counter_proposals'
  ] loop
    execute format('drop policy "%s_insert_own" on public.%I', t, t);
    execute format('drop policy "%s_update_own" on public.%I', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert to authenticated
      with check (user_id = (select auth.uid()) and public.ccc_p1_unlocked((select auth.uid())))', t, t);
    execute format('create policy "%s_update_own" on public.%I for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()) and public.ccc_p1_unlocked((select auth.uid())))', t, t);
  end loop;
end $$;

-- log every P1 mutation performed while the gates are not actually met
create or replace function public.ccc_log_override_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
declare gates_met boolean;
begin
  select coalesce(m.unlocked_bool, false) into gates_met
    from maturity_state m where m.user_id = coalesce(new.user_id, old.user_id);
  if not gates_met and public.ccc_override_active(coalesce(new.user_id, old.user_id)) then
    insert into override_mutations (user_id, table_name, row_id, operation)
    values (coalesce(new.user_id, old.user_id), tg_table_name, coalesce(new.id, old.id), tg_op);
  end if;
  return coalesce(new, old);
end; $$;
do $$
declare t text;
begin
  foreach t in array array[
    'companies','contacts','outreach','referrals','applications','interviews',
    'offers','offer_scenarios','counter_proposals'
  ] loop
    execute format('create trigger ccc_%s_override_log after insert or update on public.%I
      for each row execute function public.ccc_log_override_mutation()', t, t);
  end loop;
end $$;

-- ── RLS + indexes for the junction tables ────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'asset_source_achievements','asset_source_evidence','asset_source_metrics',
    'collection_assets','story_achievements','story_archetypes','plan_archetypes',
    'reference_application_uses','counter_benchmarks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s_select_own" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_update_own" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_delete_own" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('create index %s_user_id_idx on public.%I (user_id)', t, t);
  end loop;
end $$;

grant execute on function public.ccc_set_override(text, boolean, text) to authenticated;
grant execute on function public.ccc_recompute_maturity() to authenticated;
grant execute on function public.ccc_p1_unlocked(uuid) to authenticated;
grant execute on function public.ccc_override_active(uuid) to authenticated;
