-- Closing the version-commit authority bypass.
--
-- The previous pass made `asset_versions` client-read-only, but left the
-- low-level `ccc_commit_asset_version` RPC executable by `authenticated`. A
-- browser client could therefore call it directly with caller-supplied
-- content, model name, prompt hash, privacy class and truth summary, make the
-- result the asset's CURRENT version, and skip the AI route and its audit
-- entirely. The table was locked; the door beside it was not.
--
--  1. The low-level commit and manual-author functions are revoked from
--     PUBLIC, anon and authenticated, and re-signed to take the acting user
--     EXPLICITLY — there is no `auth.uid()` under the service role, so the
--     identity must be passed and enforced, never inferred.
--  2. Privacy class and truth summary are DERIVED inside the commit from the
--     authoritative source graph. They are no longer parameters at all, so
--     they cannot be supplied by any caller, browser or server.
--  3. The AI audit row is written IN THE SAME TRANSACTION as the version. A
--     version presented as model-generated cannot exist without its audit.
--  4. career_assets derived fields are forced to canonical defaults on INSERT,
--     so a new asset cannot arrive already PUBLIC_SAFE, externally used,
--     eligible, or pointing at an arbitrary current version.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. A role for the server-only path. In hosted Supabase `service_role`
--    already exists; this makes the chain self-contained for hermetic runs.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Truth summary derived from the graph, never supplied
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_truth_summary(p_user uuid, p_asset uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(distinct t, ','), '') from (
    select s.truth_status as t
      from asset_source_achievements j join achievements s on s.id = j.achievement_fk
     where j.asset_fk = p_asset and j.user_id = p_user
    union
    select m.truth_status
      from asset_source_metrics j join metrics m on m.id = j.metric_fk
     where j.asset_fk = p_asset and j.user_id = p_user
  ) x;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The server-only transactional commit
--
--    Signature change is deliberate, not cosmetic: the old
--    (asset, content, model, hash, blocked, reason, privacy, truth, ack)
--    signature is DROPPED. Privacy and truth are gone as inputs; the acting
--    user is now required; the audit travels with the commit.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.ccc_author_manual_version(uuid, text, text, text);
drop function if exists public.ccc_commit_asset_version(uuid, text, text, text, boolean, text, text, text, boolean);

create or replace function public.ccc_commit_asset_version(
  p_user uuid,
  p_asset uuid,
  p_content text,
  p_model text,
  p_prompt_hash text,
  p_blocked boolean,
  p_block_reason text,
  p_ack boolean,
  p_audit jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  locked record;
  next_no integer;
  v record;
  verdict jsonb;
  derived_privacy text;
begin
  -- The acting user is explicit and enforced. Under the service role there is
  -- no auth.uid() to fall back on, and a mismatched id must never pass.
  if p_user is null then raise exception 'commit: an acting user id is required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user then
    raise exception 'commit: refusing to act as a different user';
  end if;
  if coalesce(p_audit->>'output_type', '') = '' then
    raise exception 'commit: an audit record is required for every version';
  end if;

  -- lock the asset row: serializes concurrent commits, and scopes the whole
  -- operation to an asset this user actually owns
  select * into locked from career_assets
   where id = p_asset and user_id = p_user for update;
  if locked.id is null then raise exception 'asset not found for this user'; end if;

  select coalesce(max(version_number), 0) + 1 into next_no
    from asset_versions where asset_fk = p_asset and user_id = p_user;

  -- privacy is DERIVED from the authoritative graph, never supplied
  verdict := public.ccc_asset_graph_eligible_for(p_user, p_asset);
  derived_privacy := case
    when coalesce(p_blocked, false) then null
    when (verdict->>'eligible')::boolean then 'PUBLIC_SAFE'
    else null
  end;

  perform set_config('ccc.trusted_path', 'on', true);

  insert into asset_versions (
    user_id, asset_fk, version_number, content, generated_by_model,
    generation_prompt_hash, blocked_bool, block_reason, attested_no_metric_ack_bool
  ) values (
    p_user, p_asset, next_no, coalesce(p_content,''), coalesce(p_model,''),
    coalesce(p_prompt_hash,''), coalesce(p_blocked,false), coalesce(p_block_reason,''),
    coalesce(p_ack,false)
  ) returning * into v;

  if not coalesce(p_blocked, false) then
    update asset_versions
       set superseded_by_fk = v.id
     where asset_fk = p_asset and user_id = p_user and id <> v.id
       and superseded_by_fk is null and not blocked_bool;
    update career_assets
       set current_version_fk = v.id,
           truth_status_summary = public.ccc_truth_summary(p_user, p_asset),
           privacy_class = coalesce(derived_privacy, privacy_class),
           updated_at = now()
     where id = p_asset and user_id = p_user;
  end if;

  -- ATOMIC AUDIT: the version and its ai_outputs row commit together, so a
  -- version cannot exist without the record of how it came to be.
  insert into ai_outputs (
    user_id, output_type, model_used, input_refs, output_text,
    truth_classifications, blocked_bool, block_reason
  ) values (
    p_user,
    p_audit->>'output_type',
    coalesce(p_audit->>'model_used', ''),
    coalesce(p_audit->'input_refs', '[]'::jsonb),
    coalesce(p_audit->>'output_text', ''),
    coalesce(p_audit->'truth_classifications', '[]'::jsonb),
    coalesce((p_audit->>'blocked_bool')::boolean, false),
    coalesce(p_audit->>'block_reason', '')
  );

  -- staleness recomputed from the same verdict
  update career_assets
     set eligibility_stale_bool = not (verdict->>'eligible')::boolean,
         eligibility_reason = case
           when (verdict->>'eligible')::boolean then ''
           else (select string_agg(format('%s: %s', x->>'label', x->>'reason'), ' | ')
                   from jsonb_array_elements(verdict->'reasons') x)
         end
   where id = p_asset and user_id = p_user;

  perform set_config('ccc.trusted_path', 'off', true);
  return to_jsonb(v);
end; $$;

-- The graph gate also needs an explicit-user form for the service-role path.
create or replace function public.ccc_asset_graph_eligible_for(p_user uuid, p_asset uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a record;
  r jsonb := '[]'::jsonb;
  needs_ack boolean := false;
  claim_sources integer := 0;
  rec record;
begin
  if p_user is null then raise exception 'not authenticated'; end if;
  select * into a from career_assets where id = p_asset and user_id = p_user;
  if a.id is null then
    return jsonb_build_object('eligible', false, 'requires_ack', false,
      'reasons', jsonb_build_array(jsonb_build_object('kind','asset','id',p_asset,'label','asset','reason','Asset not found.')));
  end if;

  for rec in
    select j.achievement_fk as ref, s.id, s.headline, s.truth_status, s.privacy_class, s.status
      from asset_source_achievements j
      left join achievements s on s.id = j.achievement_fk and s.user_id = p_user
     where j.asset_fk = p_asset and j.user_id = p_user
  loop
    claim_sources := claim_sources + 1;
    if rec.id is null then
      r := r || jsonb_build_object('kind','achievement','id',rec.ref,'label','(missing achievement)','reason','Dangling reference: source achievement no longer resolves.');
    elsif rec.status = 'archived' then
      r := r || jsonb_build_object('kind','achievement','id',rec.id,'label',rec.headline,'reason','Source achievement is archived.');
    elsif rec.truth_status not in ('VERIFIED','ATTESTED_WITH_METRIC','ATTESTED_NO_METRIC') then
      r := r || jsonb_build_object('kind','achievement','id',rec.id,'label',rec.headline,'reason',format('Truth status %s blocks external use.', rec.truth_status));
    elsif rec.privacy_class = 'PRIVATE' then
      if not exists (select 1 from sanitized_claims c
                      where c.user_id = p_user and c.source_achievement_fk = rec.id
                        and c.status = 'active' and c.user_approved_at is not null) then
        r := r || jsonb_build_object('kind','achievement','id',rec.id,'label',rec.headline,'reason','PRIVATE content cannot reach external assets. Approve a sanitized claim first.');
      elsif rec.truth_status = 'ATTESTED_NO_METRIC' then
        needs_ack := true;
      end if;
    elsif rec.privacy_class <> 'PUBLIC_SAFE' then
      r := r || jsonb_build_object('kind','achievement','id',rec.id,'label',rec.headline,'reason','Privacy class INTERNAL_ONLY blocks external use. Promote to PUBLIC_SAFE or sanitize.');
    elsif rec.truth_status = 'ATTESTED_NO_METRIC' then
      needs_ack := true;
    end if;
  end loop;

  for rec in
    select j.metric_fk as ref, m.id, m.metric_name, m.truth_status, m.privacy_class, m.status
      from asset_source_metrics j
      left join metrics m on m.id = j.metric_fk and m.user_id = p_user
     where j.asset_fk = p_asset and j.user_id = p_user
  loop
    claim_sources := claim_sources + 1;
    if rec.id is null then
      r := r || jsonb_build_object('kind','metric','id',rec.ref,'label','(missing metric)','reason','Dangling reference: source metric no longer resolves.');
    elsif rec.status = 'archived' then
      r := r || jsonb_build_object('kind','metric','id',rec.id,'label',rec.metric_name,'reason','Source metric is archived.');
    elsif rec.truth_status not in ('VERIFIED','ATTESTED_WITH_METRIC','ATTESTED_NO_METRIC') then
      r := r || jsonb_build_object('kind','metric','id',rec.id,'label',rec.metric_name,'reason',format('Metric truth status %s blocks external use.', rec.truth_status));
    elsif rec.privacy_class = 'PRIVATE' then
      if not exists (select 1 from sanitized_claims c
                      where c.user_id = p_user and c.source_metric_fk = rec.id
                        and c.status = 'active' and c.user_approved_at is not null) then
        r := r || jsonb_build_object('kind','metric','id',rec.id,'label',rec.metric_name,'reason','PRIVATE metric cannot reach external assets. Approve a sanitized claim first.');
      elsif rec.truth_status = 'ATTESTED_NO_METRIC' then
        needs_ack := true;
      end if;
    elsif rec.privacy_class <> 'PUBLIC_SAFE' then
      r := r || jsonb_build_object('kind','metric','id',rec.id,'label',rec.metric_name,'reason','Metric privacy INTERNAL_ONLY blocks external use.');
    elsif rec.truth_status = 'ATTESTED_NO_METRIC' then
      needs_ack := true;
    end if;
  end loop;

  for rec in
    select j.evidence_fk as ref, e.id, e.content_summary, e.privacy_class, e.status,
           e.verified_at, e.verified_by
      from asset_source_evidence j
      left join evidence_items e on e.id = j.evidence_fk and e.user_id = p_user
     where j.asset_fk = p_asset and j.user_id = p_user
  loop
    claim_sources := claim_sources + 1;
    if rec.id is null then
      r := r || jsonb_build_object('kind','evidence_item','id',rec.ref,'label','(missing evidence)','reason','Dangling reference: source evidence no longer resolves.');
    elsif rec.status = 'archived' then
      r := r || jsonb_build_object('kind','evidence_item','id',rec.id,'label',left(rec.content_summary,80),'reason','Source evidence is archived.');
    elsif rec.privacy_class <> 'PUBLIC_SAFE' then
      r := r || jsonb_build_object('kind','evidence_item','id',rec.id,'label',left(rec.content_summary,80),'reason',format('Evidence privacy %s blocks external use.', rec.privacy_class));
    elsif rec.verified_at is null or coalesce(rec.verified_by,'') = '' then
      r := r || jsonb_build_object('kind','evidence_item','id',rec.id,'label',left(rec.content_summary,80),'reason','Unverified evidence cannot enter an external payload. Record who verified it and when.');
    end if;
  end loop;

  if a.target_archetype_fk is not null then
    if not exists (
      select 1 from target_archetypes t
       where t.id = a.target_archetype_fk and t.user_id = p_user
         and t.status = 'active' and t.approved_by_user_bool
    ) then
      r := r || jsonb_build_object('kind','archetype','id',a.target_archetype_fk,'label','target archetype',
        'reason','Target archetype must be active and user-approved before it can shape an external asset.');
    end if;
  end if;

  if claim_sources = 0 then
    r := r || jsonb_build_object('kind','asset','id',p_asset,'label','asset','reason','Asset has no source claims.');
  end if;

  return jsonb_build_object('eligible', jsonb_array_length(r) = 0, 'requires_ack', needs_ack, 'reasons', r);
end; $$;

-- The caller-scoped wrapper the browser uses for read-only verdicts delegates
-- to the same implementation, so there is exactly one rule set.
create or replace function public.ccc_asset_graph_eligible(p_asset uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return public.ccc_asset_graph_eligible_for(auth.uid(), p_asset);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Manual authoring: server-only, lifecycle fields derived
--
--    The caller supplies an asset and content. Nothing else. Privacy, truth
--    summary, blocking, supersession and current-version are all derived. A
--    manual version whose graph is ineligible is still SAVED (the locked
--    architecture keeps manual authoring available), but it stays
--    non-PUBLIC_SAFE and the asset is marked stale — so it cannot be approved,
--    packaged or used externally until the graph is clean.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_author_manual_version(
  p_user uuid, p_asset uuid, p_content text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare verdict jsonb; refs jsonb;
begin
  if p_user is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_content), '') = '' then
    raise exception 'a manual version needs content';
  end if;
  if not exists (select 1 from career_assets where id = p_asset and user_id = p_user) then
    raise exception 'asset not found for this user';
  end if;
  verdict := public.ccc_asset_graph_eligible_for(p_user, p_asset);
  refs := coalesce(verdict->'reasons', '[]'::jsonb);
  -- Recorded as USER-AUTHORED: model and prompt metadata are empty by
  -- construction, so a hand-written version can never look model-generated.
  return public.ccc_commit_asset_version(
    p_user, p_asset, p_content, '', '', false, '', false,
    jsonb_build_object(
      'output_type', 'asset_manual',
      'model_used', '',
      'output_text', p_content,
      'input_refs', refs,
      'blocked_bool', false,
      'block_reason', case when (verdict->>'eligible')::boolean then ''
                           else 'authored manually while the source graph is ineligible; the version stays non-external until it is clean' end
    ));
end; $$;

-- An audit-only record, for attempts that never produce a version (model
-- unavailable, transport failure).
create or replace function public.ccc_record_ai_audit(p_user uuid, p_audit jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out_row record;
begin
  if p_user is null then raise exception 'not authenticated'; end if;
  if coalesce(p_audit->>'output_type', '') = '' then
    raise exception 'an audit record needs an output type';
  end if;
  insert into ai_outputs (
    user_id, output_type, model_used, input_refs, output_text,
    truth_classifications, blocked_bool, block_reason
  ) values (
    p_user, p_audit->>'output_type', coalesce(p_audit->>'model_used', ''),
    coalesce(p_audit->'input_refs', '[]'::jsonb), coalesce(p_audit->>'output_text', ''),
    coalesce(p_audit->'truth_classifications', '[]'::jsonb),
    coalesce((p_audit->>'blocked_bool')::boolean, false),
    coalesce(p_audit->>'block_reason', '')
  ) returning * into out_row;
  return to_jsonb(out_row);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. career_assets: derived fields forced to canonical defaults on INSERT
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_default_asset_derived_fields()
returns trigger language plpgsql as $$
begin
  if public.ccc_trusted() then return new; end if;
  -- Overwrite rather than reject: a new asset is always born unproven.
  new.current_version_fk    := null;
  new.truth_status_summary  := '';
  new.privacy_class         := 'INTERNAL_ONLY';
  new.used_externally_bool  := false;
  new.eligibility_stale_bool := false;
  new.eligibility_reason    := '';
  return new;
end; $$;
-- Postgres fires BEFORE triggers in NAME order, and the version-chain check
-- would otherwise reject a forged current_version_fk before this could null
-- it. The `00` prefix makes the defaults run first, so a forged insert is
-- quietly normalised rather than erroring with a confusing chain message.
create trigger ccc_assets_00_insert_defaults before insert on public.career_assets
  for each row execute function public.ccc_default_asset_derived_fields();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Revoke the low-level lifecycle functions from every browser role
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.ccc_commit_asset_version(uuid, uuid, text, text, text, boolean, text, boolean, jsonb) from public;
revoke all on function public.ccc_commit_asset_version(uuid, uuid, text, text, text, boolean, text, boolean, jsonb) from anon;
revoke all on function public.ccc_commit_asset_version(uuid, uuid, text, text, text, boolean, text, boolean, jsonb) from authenticated;

revoke all on function public.ccc_author_manual_version(uuid, uuid, text) from public;
revoke all on function public.ccc_author_manual_version(uuid, uuid, text) from anon;
revoke all on function public.ccc_author_manual_version(uuid, uuid, text) from authenticated;

revoke all on function public.ccc_record_ai_audit(uuid, jsonb) from public;
revoke all on function public.ccc_record_ai_audit(uuid, jsonb) from anon;
revoke all on function public.ccc_record_ai_audit(uuid, jsonb) from authenticated;

revoke all on function public.ccc_asset_graph_eligible_for(uuid, uuid) from public;
revoke all on function public.ccc_asset_graph_eligible_for(uuid, uuid) from anon;
revoke all on function public.ccc_asset_graph_eligible_for(uuid, uuid) from authenticated;

revoke all on function public.ccc_truth_summary(uuid, uuid) from public;
revoke all on function public.ccc_truth_summary(uuid, uuid) from anon;
revoke all on function public.ccc_truth_summary(uuid, uuid) from authenticated;

-- Only the server-side service role may reach them.
grant execute on function public.ccc_commit_asset_version(uuid, uuid, text, text, text, boolean, text, boolean, jsonb) to service_role;
grant execute on function public.ccc_author_manual_version(uuid, uuid, text) to service_role;
grant execute on function public.ccc_record_ai_audit(uuid, jsonb) to service_role;
grant execute on function public.ccc_asset_graph_eligible_for(uuid, uuid) to service_role;
grant execute on function public.ccc_truth_summary(uuid, uuid) to service_role;

-- The read-only verdict stays available to the browser for UI messaging.
grant execute on function public.ccc_asset_graph_eligible(uuid) to authenticated;
