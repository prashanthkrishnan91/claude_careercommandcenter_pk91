-- Corrections to 20260730010000_integrity_and_enforcement, found by the
-- hermetic suite running the full chain from an empty database:
--
-- 1. ccc_recompute_maturity: row_number() is bigint, and `date - bigint`
--    does not exist — cast the week offset to int.
-- 2. visa_gate_offer_same_user_fkey: a composite ON DELETE SET NULL nulls
--    EVERY referencing column (including user_id, which is NOT NULL). Use a
--    column list so only qualifying_offer_fk clears.
-- 3. ccc_enforce_gate7: when the qualifying offer of a COMPLETE Gate 7 goes
--    away, the gate must REGRESS to in_progress — never remain complete
--    without an offer, and never make the offer's removal impossible.
-- 4. ccc_enforce_offer_acceptance: the "cannot lose commitments" branch was
--    unreachable (the acceptance branch always fires first); fold both into
--    one check that runs on INSERT and UPDATE alike.
-- 5. ccc_log_override_mutation: when no maturity_state row exists yet,
--    SELECT INTO left gates_met NULL and `if not NULL` never logged — the
--    exact case (nothing computed, override on) that MUST be audited.

alter table public.visa_checklist_items
  drop constraint visa_gate_offer_same_user_fkey;
alter table public.visa_checklist_items
  add constraint visa_gate_offer_same_user_fkey
    foreign key (qualifying_offer_fk, user_id) references public.offers (id, user_id)
    on delete set null (qualifying_offer_fk);

create or replace function public.ccc_enforce_gate7()
returns trigger language plpgsql as $$
begin
  if new.ordinal = 7 and new.status = 'complete' then
    if new.qualifying_offer_fk is null then
      -- A complete gate losing its offer (referential SET NULL or an explicit
      -- clear) regresses instead of lingering complete without an offer.
      if tg_op = 'UPDATE' and old.status = 'complete' and old.qualifying_offer_fk is not null then
        new.status := 'in_progress';
        return new;
      end if;
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

create or replace function public.ccc_enforce_offer_acceptance()
returns trigger language plpgsql as $$
begin
  -- Runs on INSERT and UPDATE: an offer can neither enter nor REMAIN in
  -- 'accepted' without the full Gate-7 evidence chain.
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
  return new;
end; $$;

create or replace function public.ccc_log_override_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
declare gates_met boolean;
begin
  gates_met := coalesce((
    select m.unlocked_bool from maturity_state m
     where m.user_id = coalesce(new.user_id, old.user_id)), false);
  if not gates_met and public.ccc_override_active(coalesce(new.user_id, old.user_id)) then
    insert into override_mutations (user_id, table_name, row_id, operation)
    values (coalesce(new.user_id, old.user_id), tg_table_name, coalesce(new.id, old.id), tg_op);
  end if;
  return coalesce(new, old);
end; $$;

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
    ) - ((t.rn - 1) * 7)::int
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
