-- Closing the remaining direct-write bypasses.
--
-- The previous pass guarded specific COLUMNS on asset_versions,
-- collection_assets and career_assets. That still left whole operations open:
-- a client could INSERT a version outright (fabricating model/prompt metadata
-- and skipping the audit), DELETE one (breaking the chain), UPDATE or DELETE a
-- collection membership, and DELETE P1 rows while the gates were locked.
--
--  1. asset_versions and collection_assets become CLIENT-READ-ONLY. Every
--     mutation goes through a SECURITY DEFINER function that validates first.
--  2. career_assets derived fields are guarded as a set, not one at a time.
--  3. Collection membership validation runs on UPDATE as well as INSERT, and
--     any membership change atomically revalidates the collection — demoting
--     it rather than leaving an approved/current collection holding an
--     invalid version.
--  4. P1 DELETE is gated on maturity exactly like INSERT and UPDATE.
--  5. The maturity/override predicates refuse to report on another user.

-- The criteria implementation from migration 5 is renamed to make room for a
-- guarded public wrapper of the same name.
alter function public.ccc_maturity_criteria(uuid) rename to ccc_maturity_criteria_for;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. asset_versions: client-read-only
-- ─────────────────────────────────────────────────────────────────────────────
drop policy "asset_versions_insert_own" on public.asset_versions;
drop policy "asset_versions_update_own" on public.asset_versions;
drop policy "asset_versions_delete_own" on public.asset_versions;
revoke insert, update, delete on public.asset_versions from authenticated;

-- The one legitimate client workflow that used a direct insert was authoring a
-- version by hand. It now runs through the same transactional commit path as
-- generation, so manual versions get a version number, supersession, the
-- current-version repoint and an audit row like any other.
create or replace function public.ccc_author_manual_version(
  p_asset uuid, p_content text, p_privacy text, p_truth_summary text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_content), '') = '' then
    raise exception 'a manual version needs content';
  end if;
  if not exists (select 1 from career_assets where id = p_asset and user_id = uid) then
    raise exception 'asset not found';
  end if;
  -- model/prompt metadata is NOT caller-supplied: a hand-authored version is
  -- recorded as hand-authored and cannot masquerade as model output.
  return public.ccc_commit_asset_version(
    p_asset, p_content, '', '', false, '', p_privacy, p_truth_summary, false);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. career_assets: every field derived by the version/source lifecycle
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_guard_asset_derived_fields()
returns trigger language plpgsql as $$
begin
  if public.ccc_trusted() then return new; end if;
  if new.current_version_fk    is distinct from old.current_version_fk
     or new.truth_status_summary is distinct from old.truth_status_summary
     or new.privacy_class        is distinct from old.privacy_class
     or new.used_externally_bool is distinct from old.used_externally_bool
     or new.eligibility_stale_bool is distinct from old.eligibility_stale_bool
     or new.eligibility_reason   is distinct from old.eligibility_reason then
    raise exception 'career_assets: current_version_fk, truth_status_summary, privacy_class, used_externally_bool and eligibility_* are derived by the version/source lifecycle and cannot be set directly';
  end if;
  return new;
end; $$;
drop trigger ccc_assets_guard on public.career_assets;
create trigger ccc_assets_guard before update on public.career_assets
  for each row execute function public.ccc_guard_asset_derived_fields();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. collection_assets: client-read-only, validated on INSERT and UPDATE,
--    with the collection revalidated atomically on every membership change
-- ─────────────────────────────────────────────────────────────────────────────
drop policy "collection_assets_insert_own" on public.collection_assets;
drop policy "collection_assets_update_own" on public.collection_assets;
drop policy "collection_assets_delete_own" on public.collection_assets;
revoke insert, update, delete on public.collection_assets from authenticated;

create or replace function public.ccc_validate_collection_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record; c record; verdict jsonb;
begin
  if new.version_fk is null then
    raise exception 'collection membership must reference an exact asset version';
  end if;
  select * into v from asset_versions where id = new.version_fk and user_id = new.user_id;
  if v.id is null then raise exception 'collection membership: version does not resolve for this user'; end if;
  -- the stated asset must be the version's actual asset
  if v.asset_fk <> new.asset_fk then raise exception 'collection membership: version belongs to a different asset'; end if;
  select * into c from asset_collections where id = new.collection_fk and user_id = new.user_id;
  if c.id is null then raise exception 'collection membership: collection does not resolve for this user'; end if;
  if v.blocked_bool then raise exception 'collection membership: a blocked version cannot be packaged'; end if;
  if not v.approved_by_user_bool then raise exception 'collection membership: only an approved version can be packaged'; end if;
  if new.membership_stale_bool then raise exception 'collection membership: a stale membership cannot be written'; end if;
  verdict := public.ccc_asset_graph_eligible(new.asset_fk);
  if not (verdict->>'eligible')::boolean then
    raise exception 'collection membership blocked by the source graph: %', verdict->'reasons';
  end if;
  return new;
end; $$;
drop trigger ccc_collection_member_validate on public.collection_assets;
create trigger ccc_collection_member_validate before insert or update on public.collection_assets
  for each row when (not public.ccc_trusted())
  execute function public.ccc_validate_collection_member();

-- Revalidation now also catches a membership whose version no longer belongs
-- to the asset it is filed under.
create or replace function public.ccc_revalidate_collection(p_collection uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m record; bad integer := 0; reason text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform set_config('ccc.trusted_path', 'on', true);
  for m in select ca.*, v.approved_by_user_bool, v.blocked_bool, v.id as vid, v.asset_fk as v_asset_fk
             from collection_assets ca
             left join asset_versions v on v.id = ca.version_fk and v.user_id = uid
            where ca.collection_fk = p_collection and ca.user_id = uid
  loop
    reason := '';
    if m.vid is null then reason := 'the packaged version no longer resolves';
    elsif m.v_asset_fk is distinct from m.asset_fk then
      reason := 'the packaged version does not belong to the asset it is filed under';
    elsif m.blocked_bool then reason := 'the packaged version is blocked';
    elsif not m.approved_by_user_bool then reason := 'the packaged version is no longer approved';
    elsif not (public.ccc_asset_graph_eligible(m.asset_fk)->>'eligible')::boolean then
      reason := 'a source of the packaged version is no longer eligible';
    end if;
    if reason <> '' then bad := bad + 1; end if;
    update collection_assets
       set membership_stale_bool = (reason <> ''), membership_stale_reason = reason
     where id = m.id;
  end loop;
  perform set_config('ccc.trusted_path', 'off', true);
  return jsonb_build_object('checked', true, 'invalid', bad);
end; $$;

-- Any membership change re-checks the collection. An approved or current
-- collection that would be left holding an invalid version — or left empty —
-- is DEMOTED in the same transaction rather than silently kept.
create or replace function public.ccc_demote_invalid_collection()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid := coalesce(new.collection_fk, old.collection_fk);
        owner uuid := coalesce(new.user_id, old.user_id);
        c record; bad integer; members integer;
begin
  if coalesce(current_setting('ccc.revalidating', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  select * into c from asset_collections where id = target and user_id = owner;
  if c.id is null then return coalesce(new, old); end if;
  if not (c.approved_by_user_bool or c.current_bool) then return coalesce(new, old); end if;

  perform set_config('ccc.revalidating', 'on', true);
  select count(*) into members from collection_assets where collection_fk = target and user_id = owner;
  select count(*) into bad
    from collection_assets ca
    left join asset_versions v on v.id = ca.version_fk and v.user_id = owner
   where ca.collection_fk = target and ca.user_id = owner
     and (v.id is null or v.asset_fk is distinct from ca.asset_fk
          or v.blocked_bool or not v.approved_by_user_bool
          or ca.membership_stale_bool
          or not (public.ccc_asset_graph_eligible(ca.asset_fk)->>'eligible')::boolean);
  if members = 0 or bad > 0 then
    perform set_config('ccc.trusted_path', 'on', true);
    update asset_collections
       set approved_by_user_bool = false, approved_at = null,
           current_bool = false, updated_at = now()
     where id = target and user_id = owner;
    perform set_config('ccc.trusted_path', 'off', true);
  end if;
  perform set_config('ccc.revalidating', 'off', true);
  return coalesce(new, old);
end; $$;
create trigger ccc_collection_member_demote
  after insert or update or delete on public.collection_assets
  for each row execute function public.ccc_demote_invalid_collection();

create or replace function public.ccc_remove_collection_version(p_collection uuid, p_version uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); removed integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  delete from collection_assets
   where collection_fk = p_collection and version_fk = p_version and user_id = uid;
  get diagnostics removed = row_count;
  if removed = 0 then raise exception 'membership not found'; end if;
  -- the demote trigger has already re-checked the collection
  return jsonb_build_object('removed', removed);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. P1 DELETE is gated exactly like INSERT and UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'companies','contacts','outreach','referrals','applications','interviews',
    'offers','offer_scenarios','counter_proposals','comp_benchmarks',
    'reference_application_uses','counter_benchmarks'
  ] loop
    execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);
    execute format('create policy "%s_delete_own" on public.%I for delete to authenticated
      using (user_id = (select auth.uid()) and public.ccc_p1_unlocked((select auth.uid())))', t, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The maturity/override predicates report only on the calling user
--
--    The public entry points take NO user parameter — they derive the subject
--    from auth.uid(), so there is nothing to point at another account. The
--    real implementations keep a uid parameter because triggers must evaluate
--    a row's owner, but they are NOT granted to `authenticated`: only the
--    SECURITY DEFINER callers can reach them.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_override_active_for(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select o.enabled_bool from owner_overrides o
     where o.user_id = uid and o.override_key = 'maturity_dev_override'
     order by o.created_at desc limit 1), false);
$$;

create or replace function public.ccc_maturity_met_for(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_and((v.value->>'met')::boolean), false)
    from jsonb_each(public.ccc_maturity_criteria_for(uid)) v;
$$;

create or replace function public.ccc_p1_unlocked_for(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ccc_maturity_met_for(uid) or public.ccc_override_active_for(uid);
$$;

-- Public, parameterless: the caller can only ever ask about itself.
create or replace function public.ccc_p1_unlocked()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ccc_p1_unlocked_for(auth.uid()), false);
$$;

create or replace function public.ccc_maturity_met()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ccc_maturity_met_for(auth.uid()), false);
$$;

create or replace function public.ccc_override_active()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ccc_override_active_for(auth.uid()), false);
$$;

-- The criteria RPC keeps its parameter (the UI passes its own id) but refuses
-- to report on anyone else.
create or replace function public.ccc_maturity_criteria(uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if uid is distinct from auth.uid() then
    raise exception 'maturity criteria are readable only for the calling user';
  end if;
  return public.ccc_maturity_criteria_for(uid);
end; $$;

-- Every P1 policy now calls the parameterless predicate.
do $$
declare t text;
begin
  foreach t in array array[
    'companies','contacts','outreach','referrals','applications','interviews',
    'offers','offer_scenarios','counter_proposals','comp_benchmarks',
    'reference_application_uses','counter_benchmarks'
  ] loop
    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert to authenticated
      with check (user_id = (select auth.uid()) and public.ccc_p1_unlocked())', t, t);
    execute format('create policy "%s_update_own" on public.%I for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()) and public.ccc_p1_unlocked())', t, t);
    execute format('create policy "%s_delete_own" on public.%I for delete to authenticated
      using (user_id = (select auth.uid()) and public.ccc_p1_unlocked())', t, t);
  end loop;
end $$;

-- Internal callers evaluate a row's owner; the audit trigger is one of them.
create or replace function public.ccc_log_override_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid := coalesce(new.user_id, old.user_id); ev record;
begin
  if public.ccc_maturity_met_for(owner) then return coalesce(new, old); end if;
  select o.id, o.reason into ev from owner_overrides o
   where o.user_id = owner and o.override_key = 'maturity_dev_override' and o.enabled_bool
   order by o.created_at desc limit 1;
  if ev.id is null then return coalesce(new, old); end if;
  insert into override_mutations (user_id, table_name, row_id, operation, override_event_fk, reason_snapshot)
  values (owner, tg_table_name, coalesce(new.id, old.id), tg_op, ev.id, ev.reason);
  return coalesce(new, old);
end; $$;

create or replace function public.ccc_recompute_maturity()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c jsonb; all_met boolean;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  c := public.ccc_maturity_criteria_for(uid);
  select coalesce(bool_and((v.value->>'met')::boolean), false) into all_met from jsonb_each(c) v;
  insert into maturity_state (user_id, unlocked_bool, criteria, computed_at)
  values (uid, all_met, c, now())
  on conflict (user_id) do update
    set unlocked_bool = excluded.unlocked_bool, criteria = excluded.criteria, computed_at = now();
  return jsonb_build_object('unlocked', all_met, 'override_active', public.ccc_override_active(), 'criteria', c);
end; $$;

-- The parameterised implementations are reachable only through the definer
-- functions above, never directly by a client.
revoke all on function public.ccc_maturity_criteria_for(uuid) from public, authenticated;
revoke all on function public.ccc_maturity_met_for(uuid) from public, authenticated;
revoke all on function public.ccc_override_active_for(uuid) from public, authenticated;
revoke all on function public.ccc_p1_unlocked_for(uuid) from public, authenticated;
drop function if exists public.ccc_p1_unlocked(uuid);
drop function if exists public.ccc_maturity_met(uuid);
drop function if exists public.ccc_override_active(uuid);

grant execute on function public.ccc_p1_unlocked() to authenticated;
grant execute on function public.ccc_maturity_met() to authenticated;
grant execute on function public.ccc_override_active() to authenticated;
grant execute on function public.ccc_maturity_criteria(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Keep the propagation path trusted end to end. It writes both
--    career_assets (derived fields) and collection_assets (staleness), and now
--    that BOTH carry validators it must hold the trusted flag across the whole
--    body rather than toggling it around one statement.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_propagate_source_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid := coalesce(new.user_id, old.user_id); a record; verdict jsonb;
begin
  perform set_config('ccc.trusted_path', 'on', true);
  for a in select id from career_assets where user_id = owner loop
    verdict := public.ccc_asset_graph_eligible(a.id);
    update career_assets
       set eligibility_stale_bool = not (verdict->>'eligible')::boolean,
           eligibility_reason = case
             when (verdict->>'eligible')::boolean then ''
             else (select string_agg(format('%s: %s', x->>'label', x->>'reason'), ' | ')
                     from jsonb_array_elements(verdict->'reasons') x)
           end
     where id = a.id;
    update collection_assets ca
       set membership_stale_bool = true,
           membership_stale_reason = 'a source changed after packaging; revalidate the collection'
     where ca.user_id = owner and ca.asset_fk = a.id
       and not (verdict->>'eligible')::boolean;
  end loop;
  perform set_config('ccc.trusted_path', 'off', true);
  return coalesce(new, old);
end; $$;

-- Staleness is written only by the database. Clients that want a single asset
-- re-checked (for example right before generating) ask for it here instead of
-- writing the derived columns themselves.
create or replace function public.ccc_refresh_asset_eligibility(p_asset uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); verdict jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from career_assets where id = p_asset and user_id = uid) then
    raise exception 'asset not found';
  end if;
  verdict := public.ccc_asset_graph_eligible(p_asset);
  perform set_config('ccc.trusted_path', 'on', true);
  update career_assets
     set eligibility_stale_bool = not (verdict->>'eligible')::boolean,
         eligibility_reason = case
           when (verdict->>'eligible')::boolean then ''
           else (select string_agg(format('%s: %s', x->>'label', x->>'reason'), ' | ')
                   from jsonb_array_elements(verdict->'reasons') x)
         end
   where id = p_asset and user_id = uid;
  perform set_config('ccc.trusted_path', 'off', true);
  return verdict;
end; $$;

grant execute on function public.ccc_author_manual_version(uuid, text, text, text) to authenticated;
grant execute on function public.ccc_remove_collection_version(uuid, uuid) to authenticated;
grant execute on function public.ccc_refresh_asset_eligibility(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Composite ON DELETE SET NULL nulls EVERY referencing column, including
--    user_id, which is NOT NULL — so deleting any parent raised a not-null
--    violation instead of clearing the link. Migration 4 fixed one instance of
--    this; the hermetic integration-contract gate surfaced the rest. Restrict
--    each to its own foreign-key column.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.applications drop constraint applications_archetype_same_user_fkey;
alter table public.applications add constraint applications_archetype_same_user_fkey
  foreign key (target_archetype_fk, user_id) references public.target_archetypes (id, user_id)
  on delete set null (target_archetype_fk);
alter table public.applications drop constraint applications_company_same_user_fkey;
alter table public.applications add constraint applications_company_same_user_fkey
  foreign key (company_fk, user_id) references public.companies (id, user_id)
  on delete set null (company_fk);
alter table public.asset_collections drop constraint asset_collections_archetype_same_user_fkey;
alter table public.asset_collections add constraint asset_collections_archetype_same_user_fkey
  foreign key (target_archetype_fk, user_id) references public.target_archetypes (id, user_id)
  on delete set null (target_archetype_fk);
alter table public.career_assets drop constraint career_assets_archetype_same_user_fkey;
alter table public.career_assets add constraint career_assets_archetype_same_user_fkey
  foreign key (target_archetype_fk, user_id) references public.target_archetypes (id, user_id)
  on delete set null (target_archetype_fk);
alter table public.career_assets drop constraint career_assets_current_version_same_user_fkey;
alter table public.career_assets add constraint career_assets_current_version_same_user_fkey
  foreign key (current_version_fk, user_id) references public.asset_versions (id, user_id)
  on delete set null (current_version_fk);
alter table public.comp_benchmarks drop constraint comp_benchmarks_archetype_same_user_fkey;
alter table public.comp_benchmarks add constraint comp_benchmarks_archetype_same_user_fkey
  foreign key (archetype_fk, user_id) references public.target_archetypes (id, user_id)
  on delete set null (archetype_fk);
alter table public.contacts drop constraint contacts_company_same_user_fkey;
alter table public.contacts add constraint contacts_company_same_user_fkey
  foreign key (company_fk, user_id) references public.companies (id, user_id)
  on delete set null (company_fk);
alter table public.ingested_items drop constraint ingested_items_evidence_same_user_fkey;
alter table public.ingested_items add constraint ingested_items_evidence_same_user_fkey
  foreign key (converted_evidence_fk, user_id) references public.evidence_items (id, user_id)
  on delete set null (converted_evidence_fk);
alter table public.offers drop constraint offers_application_same_user_fkey;
alter table public.offers add constraint offers_application_same_user_fkey
  foreign key (application_fk, user_id) references public.applications (id, user_id)
  on delete set null (application_fk);
alter table public.offers drop constraint offers_company_same_user_fkey;
alter table public.offers add constraint offers_company_same_user_fkey
  foreign key (company_fk, user_id) references public.companies (id, user_id)
  on delete set null (company_fk);
alter table public."references" drop constraint references_narrative_same_user_fkey;
alter table public."references" add constraint references_narrative_same_user_fkey
  foreign key (current_narrative_version_fk, user_id) references public.asset_versions (id, user_id)
  on delete set null (current_narrative_version_fk);
alter table public.referrals drop constraint referrals_application_same_user_fkey;
alter table public.referrals add constraint referrals_application_same_user_fkey
  foreign key (application_fk, user_id) references public.applications (id, user_id)
  on delete set null (application_fk);
alter table public.skill_development_plans drop constraint sdp_gap_report_same_user_fkey;
alter table public.skill_development_plans add constraint sdp_gap_report_same_user_fkey
  foreign key (gap_report_fk, user_id) references public.gap_reports (id, user_id)
  on delete set null (gap_report_fk);
alter table public.skill_development_progress drop constraint sdpr_achievement_same_user_fkey;
alter table public.skill_development_progress add constraint sdpr_achievement_same_user_fkey
  foreign key (linked_achievement_fk, user_id) references public.achievements (id, user_id)
  on delete set null (linked_achievement_fk);
alter table public.weekly_briefs drop constraint weekly_briefs_action_same_user_fkey;
alter table public.weekly_briefs add constraint weekly_briefs_action_same_user_fkey
  foreign key (market_motion_action_fk, user_id) references public.action_items (id, user_id)
  on delete set null (market_motion_action_fk);
