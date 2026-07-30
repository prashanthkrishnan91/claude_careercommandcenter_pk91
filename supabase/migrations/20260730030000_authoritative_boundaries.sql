-- Authoritative trust boundaries.
--
-- The prior pass moved rules into the database but left four of them reachable
-- only through cooperative client code: OAuth single-use, version-chain
-- atomicity, external-use truth, and collection contents. This migration makes
-- the DATABASE the authority for all of them, and makes maturity live rather
-- than cached.
--
--  1. oauth_states — server-side single-use ledger, claimed atomically.
--  2. ccc_commit_asset_version — one transaction: lock, allocate, insert,
--     supersede, repoint, derive.
--  3. asset_external_uses — normalized, version-exact, validated on insert;
--     career_assets.used_externally_bool becomes trigger-maintained and is no
--     longer client-writable; external_use_log (mutable JSON) is dropped.
--  4. collection_assets references the exact approved asset_version.
--  5. ccc_asset_graph_eligible — the source-graph rules in SQL, including the
--     evidence-verification policy and the approved-archetype requirement.
--  6. ccc_maturity_criteria — pure, recomputed inside the P1 authorization
--     function, so regressing a source revokes P1 writes immediately.
--  7. comp_benchmarks + the remaining P1 tables enforced; override auditing
--     covers INSERT/UPDATE/DELETE and snapshots the reason immutably.
--  8. Safety-critical transitions (approve, collection approve/current,
--     collection membership, external use) run only through RPCs; generic
--     PostgREST updates to those columns are rejected.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Trusted-path flag. Set transaction-locally by the RPCs below; the guard
--    triggers reject safety-critical column changes when it is absent, so a
--    direct PostgREST update cannot fabricate an approval or an external use.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_trusted()
returns boolean language sql stable as $$
  select coalesce(current_setting('ccc.trusted_path', true), '') = 'on';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. OAuth state: server-side, atomically claimed, single-use
-- ─────────────────────────────────────────────────────────────────────────────
create table public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- the opaque nonce is never stored in the clear
  nonce_hash text not null,
  provider text not null check (provider in ('gmail','calendar')),
  redirect_uri text not null,
  -- PKCE verifier and the session binding are encrypted by the server before
  -- they arrive here (AES-256-GCM, key never leaves the server env)
  code_verifier_encrypted text not null,
  session_binding_encrypted text not null default '',
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_states_nonce_unique unique (user_id, nonce_hash)
);
alter table public.oauth_states enable row level security;
-- read-only to clients; ALL writes go through the definer RPCs below
create policy "oauth_states_select_own" on public.oauth_states
  for select to authenticated using (user_id = (select auth.uid()));
create index oauth_states_user_id_idx on public.oauth_states (user_id);
create index oauth_states_expiry_idx on public.oauth_states (expires_at);

-- Retention policy (documented in docs/ai-safety-contract.md): a state row
-- lives at most 10 minutes unconsumed. Consumed and expired rows are deleted
-- 24 hours after issuance — long enough to investigate a failed connect, short
-- enough that no OAuth material lingers.
create or replace function public.ccc_purge_oauth_states()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from oauth_states
   where user_id = auth.uid()
     and (consumed_at is not null or expires_at < now())
     and issued_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end; $$;

create or replace function public.ccc_issue_oauth_state(
  p_nonce_hash text, p_provider text, p_redirect_uri text,
  p_code_verifier_encrypted text, p_session_binding_encrypted text,
  p_ttl_seconds integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_provider not in ('gmail','calendar') then raise exception 'unknown provider'; end if;
  if coalesce(p_nonce_hash, '') = '' then raise exception 'nonce hash required'; end if;
  if p_ttl_seconds is null or p_ttl_seconds <= 0 or p_ttl_seconds > 900 then
    raise exception 'ttl must be between 1 and 900 seconds';
  end if;
  perform public.ccc_purge_oauth_states();
  insert into oauth_states (
    user_id, nonce_hash, provider, redirect_uri,
    code_verifier_encrypted, session_binding_encrypted, expires_at
  ) values (
    auth.uid(), p_nonce_hash, p_provider, p_redirect_uri,
    p_code_verifier_encrypted, p_session_binding_encrypted,
    now() + make_interval(secs => p_ttl_seconds)
  ) returning id into new_id;
  return new_id;
end; $$;

-- ATOMIC CLAIM. The guard lives in the WHERE clause of a single UPDATE, so two
-- concurrent callbacks contend on the same row lock: the loser re-evaluates
-- `consumed_at is null` after the winner commits and matches zero rows. There
-- is no read-then-write window, and the caller's cookie is irrelevant to the
-- outcome — the row can only be claimed once, ever.
create or replace function public.ccc_claim_oauth_state(p_nonce_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare claimed record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update oauth_states s
     set consumed_at = now()
   where s.user_id = auth.uid()
     and s.nonce_hash = p_nonce_hash
     and s.consumed_at is null
     and s.expires_at > now()
  returning s.id, s.provider, s.redirect_uri, s.code_verifier_encrypted,
            s.session_binding_encrypted, s.issued_at, s.expires_at
    into claimed;
  if claimed.id is null then
    return jsonb_build_object('claimed', false);
  end if;
  return jsonb_build_object(
    'claimed', true,
    'id', claimed.id,
    'provider', claimed.provider,
    'redirect_uri', claimed.redirect_uri,
    'code_verifier_encrypted', claimed.code_verifier_encrypted,
    'session_binding_encrypted', claimed.session_binding_encrypted,
    'issued_at', claimed.issued_at,
    'expires_at', claimed.expires_at
  );
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Canonical source-graph eligibility, in SQL
--
--    EVIDENCE VERIFICATION POLICY (canonical): an evidence item may enter an
--    external payload only when it is active, PUBLIC_SAFE, and carries BOTH a
--    verification timestamp and a verifier (`verified_at`, `verified_by`).
--    PUBLIC_SAFE alone is a privacy statement, not a proof statement.
--
--    ARCHETYPE POLICY: an asset targeting an archetype requires that archetype
--    to be active AND user-approved. Only approved parsed configuration
--    (name, required skills) may enter a payload — raw retained JD text
--    (archetype_sources.raw_content) never does.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_asset_graph_eligible(p_asset uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a record;
  r jsonb := '[]'::jsonb;
  needs_ack boolean := false;
  claim_sources integer := 0;
  rec record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into a from career_assets where id = p_asset and user_id = uid;
  if a.id is null then
    return jsonb_build_object('eligible', false, 'requires_ack', false,
      'reasons', jsonb_build_array(jsonb_build_object('kind','asset','id',p_asset,'label','asset','reason','Asset not found.')));
  end if;

  -- achievements
  for rec in
    select j.achievement_fk as ref, s.id, s.headline, s.truth_status, s.privacy_class, s.status
      from asset_source_achievements j
      left join achievements s on s.id = j.achievement_fk and s.user_id = uid
     where j.asset_fk = p_asset and j.user_id = uid
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
                      where c.user_id = uid and c.source_achievement_fk = rec.id
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

  -- metrics
  for rec in
    select j.metric_fk as ref, m.id, m.metric_name, m.truth_status, m.privacy_class, m.status
      from asset_source_metrics j
      left join metrics m on m.id = j.metric_fk and m.user_id = uid
     where j.asset_fk = p_asset and j.user_id = uid
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
                      where c.user_id = uid and c.source_metric_fk = rec.id
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

  -- evidence (verification policy)
  for rec in
    select j.evidence_fk as ref, e.id, e.content_summary, e.privacy_class, e.status,
           e.verified_at, e.verified_by
      from asset_source_evidence j
      left join evidence_items e on e.id = j.evidence_fk and e.user_id = uid
     where j.asset_fk = p_asset and j.user_id = uid
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

  -- archetype (approval required; raw JD text never travels)
  if a.target_archetype_fk is not null then
    if not exists (
      select 1 from target_archetypes t
       where t.id = a.target_archetype_fk and t.user_id = uid
         and t.status = 'active' and t.approved_by_user_bool
    ) then
      r := r || jsonb_build_object('kind','archetype','id',a.target_archetype_fk,'label','target archetype',
        'reason','Target archetype must be active and user-approved before it can shape an external asset.');
    end if;
  end if;

  if claim_sources = 0 then
    r := r || jsonb_build_object('kind','asset','id',p_asset,'label','asset','reason','Asset has no source claims.');
  end if;

  return jsonb_build_object(
    'eligible', jsonb_array_length(r) = 0,
    'requires_ack', needs_ack,
    'reasons', r
  );
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Transactional version commit
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.asset_versions
  add column attested_no_metric_ack_bool boolean not null default false;

create or replace function public.ccc_commit_asset_version(
  p_asset uuid, p_content text, p_model text, p_prompt_hash text,
  p_blocked boolean, p_block_reason text, p_privacy text, p_truth_summary text,
  p_ack boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  locked record;
  next_no integer;
  v record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  -- lock the asset row: serializes concurrent commits for this asset
  select * into locked from career_assets
   where id = p_asset and user_id = uid for update;
  if locked.id is null then raise exception 'asset not found'; end if;
  if p_privacy is not null and p_privacy not in ('PUBLIC_SAFE','INTERNAL_ONLY','PRIVATE') then
    raise exception 'invalid privacy class';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_no
    from asset_versions where asset_fk = p_asset and user_id = uid;

  perform set_config('ccc.trusted_path', 'on', true);

  insert into asset_versions (
    user_id, asset_fk, version_number, content, generated_by_model,
    generation_prompt_hash, blocked_bool, block_reason, attested_no_metric_ack_bool
  ) values (
    uid, p_asset, next_no, coalesce(p_content,''), coalesce(p_model,''),
    coalesce(p_prompt_hash,''), coalesce(p_blocked,false), coalesce(p_block_reason,''),
    coalesce(p_ack,false)
  ) returning * into v;

  if not coalesce(p_blocked, false) then
    -- supersede every still-open, non-blocked prior version of THIS asset
    update asset_versions
       set superseded_by_fk = v.id
     where asset_fk = p_asset and user_id = uid and id <> v.id
       and superseded_by_fk is null and not blocked_bool;
    update career_assets
       set current_version_fk = v.id,
           truth_status_summary = coalesce(p_truth_summary, truth_status_summary),
           privacy_class = coalesce(p_privacy, privacy_class),
           updated_at = now()
     where id = p_asset and user_id = uid;
  end if;

  perform set_config('ccc.trusted_path', 'off', true);
  return to_jsonb(v);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. External use: normalized, version-exact, validated
-- ─────────────────────────────────────────────────────────────────────────────
create table public.asset_external_uses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_fk uuid not null,
  version_fk uuid not null,
  destination text not null check (char_length(destination) between 1 and 200),
  used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint aeu_asset_same_user_fkey foreign key (asset_fk, user_id)
    references public.career_assets (id, user_id) on delete cascade,
  constraint aeu_version_same_user_fkey foreign key (version_fk, user_id)
    references public.asset_versions (id, user_id) on delete cascade
);
alter table public.asset_external_uses enable row level security;
-- read-only to clients; insertion only through ccc_log_external_use
create policy "asset_external_uses_select_own" on public.asset_external_uses
  for select to authenticated using (user_id = (select auth.uid()));
create index asset_external_uses_user_id_idx on public.asset_external_uses (user_id);

-- the mutable JSON log is replaced by the table above
alter table public.career_assets drop column external_use_log;

-- Validation runs on the row itself, so even a future privileged path cannot
-- record an external use of an unapproved, blocked, superseded or ineligible
-- version.
create or replace function public.ccc_validate_external_use()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record; a record; verdict jsonb;
begin
  select * into v from asset_versions
   where id = new.version_fk and user_id = new.user_id;
  if v.id is null then raise exception 'external use: version does not resolve for this user'; end if;
  if v.asset_fk <> new.asset_fk then raise exception 'external use: version belongs to a different asset'; end if;
  if v.blocked_bool then raise exception 'external use: a blocked version can never be used externally'; end if;
  if not v.approved_by_user_bool then raise exception 'external use: only an approved version can be used externally'; end if;

  select * into a from career_assets where id = new.asset_fk and user_id = new.user_id;
  if a.status = 'archived' then raise exception 'external use: the asset is archived'; end if;
  -- explicit supersession policy: only the asset's CURRENT version may be used
  -- externally; a superseded version is history, not a distributable artifact.
  if v.superseded_by_fk is not null or a.current_version_fk is distinct from v.id then
    raise exception 'external use: only the current version may be used externally (this one is superseded)';
  end if;

  verdict := public.ccc_asset_graph_eligible(new.asset_fk);
  if not (verdict->>'eligible')::boolean then
    raise exception 'external use blocked by the source graph: %', verdict->'reasons';
  end if;
  if (verdict->>'requires_ack')::boolean and not v.attested_no_metric_ack_bool then
    raise exception 'external use: ATTESTED_NO_METRIC sources require the acknowledgment recorded on the version';
  end if;
  return new;
end; $$;
create trigger ccc_external_use_validate before insert on public.asset_external_uses
  for each row execute function public.ccc_validate_external_use();

-- used_externally_bool is DERIVED, never client-set
create or replace function public.ccc_sync_used_externally()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid := coalesce(new.asset_fk, old.asset_fk);
begin
  perform set_config('ccc.trusted_path', 'on', true);
  update career_assets c
     set used_externally_bool = exists (
           select 1 from asset_external_uses u where u.asset_fk = c.id)
   where c.id = target;
  perform set_config('ccc.trusted_path', 'off', true);
  return coalesce(new, old);
end; $$;
create trigger ccc_external_use_sync after insert or delete on public.asset_external_uses
  for each row execute function public.ccc_sync_used_externally();

create or replace function public.ccc_log_external_use(p_version uuid, p_destination text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v record; row_out record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into v from asset_versions where id = p_version and user_id = uid;
  if v.id is null then raise exception 'version not found'; end if;
  insert into asset_external_uses (user_id, asset_fk, version_fk, destination)
  values (uid, v.asset_fk, v.id, p_destination)
  returning * into row_out;
  return to_jsonb(row_out);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Approval through an RPC only
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_guard_version_approval()
returns trigger language plpgsql as $$
begin
  if not public.ccc_trusted() then
    if new.approved_by_user_bool is distinct from old.approved_by_user_bool
       or new.approved_at is distinct from old.approved_at
       or new.blocked_bool is distinct from old.blocked_bool
       or new.superseded_by_fk is distinct from old.superseded_by_fk
       or new.attested_no_metric_ack_bool is distinct from old.attested_no_metric_ack_bool then
      raise exception 'asset_versions: approval, blocking, acknowledgment and supersession are set only by the server (ccc_* functions)';
    end if;
  end if;
  return new;
end; $$;
create trigger ccc_versions_guard before update on public.asset_versions
  for each row execute function public.ccc_guard_version_approval();

create or replace function public.ccc_guard_asset_external_flag()
returns trigger language plpgsql as $$
begin
  if not public.ccc_trusted()
     and new.used_externally_bool is distinct from old.used_externally_bool then
    raise exception 'career_assets.used_externally_bool is derived from asset_external_uses and cannot be set directly';
  end if;
  return new;
end; $$;
create trigger ccc_assets_guard before update on public.career_assets
  for each row execute function public.ccc_guard_asset_external_flag();

create or replace function public.ccc_approve_asset_version(p_version uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v record; verdict jsonb; out_row record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into v from asset_versions where id = p_version and user_id = uid for update;
  if v.id is null then raise exception 'version not found'; end if;
  if v.blocked_bool then raise exception 'a blocked version cannot be approved'; end if;
  if v.superseded_by_fk is not null then raise exception 'a superseded version cannot be approved'; end if;

  verdict := public.ccc_asset_graph_eligible(v.asset_fk);
  if not (verdict->>'eligible')::boolean then
    raise exception 'approval blocked by the source graph: %', verdict->'reasons';
  end if;
  if (verdict->>'requires_ack')::boolean and not v.attested_no_metric_ack_bool then
    raise exception 'approval: ATTESTED_NO_METRIC sources require the acknowledgment recorded at generation';
  end if;

  perform set_config('ccc.trusted_path', 'on', true);
  update asset_versions set approved_by_user_bool = true, approved_at = now()
   where id = p_version and user_id = uid returning * into out_row;
  perform set_config('ccc.trusted_path', 'off', true);
  return to_jsonb(out_row);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Collections package exact approved VERSIONS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.collection_assets
  add column version_fk uuid,
  add column membership_stale_bool boolean not null default false,
  add column membership_stale_reason text not null default '',
  add constraint ca_version_same_user_fkey foreign key (version_fk, user_id)
    references public.asset_versions (id, user_id) on delete cascade;
-- membership is per exact version
alter table public.collection_assets drop constraint ca_unique;
alter table public.collection_assets
  add constraint ca_unique unique (collection_fk, version_fk);

create or replace function public.ccc_validate_collection_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record; verdict jsonb;
begin
  if new.version_fk is null then
    raise exception 'collection membership must reference an exact asset version';
  end if;
  select * into v from asset_versions where id = new.version_fk and user_id = new.user_id;
  if v.id is null then raise exception 'collection membership: version does not resolve for this user'; end if;
  if v.asset_fk <> new.asset_fk then raise exception 'collection membership: version belongs to a different asset'; end if;
  if v.blocked_bool then raise exception 'collection membership: a blocked version cannot be packaged'; end if;
  if not v.approved_by_user_bool then raise exception 'collection membership: only an approved version can be packaged'; end if;
  verdict := public.ccc_asset_graph_eligible(new.asset_fk);
  if not (verdict->>'eligible')::boolean then
    raise exception 'collection membership blocked by the source graph: %', verdict->'reasons';
  end if;
  return new;
end; $$;
create trigger ccc_collection_member_validate before insert on public.collection_assets
  for each row execute function public.ccc_validate_collection_member();

-- Revalidate every membership of a collection; mark stale rather than delete
-- (archival discipline), and report whether anything is now invalid.
create or replace function public.ccc_revalidate_collection(p_collection uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m record; bad integer := 0; reason text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  for m in select ca.*, v.approved_by_user_bool, v.blocked_bool, v.id as vid
             from collection_assets ca
             left join asset_versions v on v.id = ca.version_fk and v.user_id = uid
            where ca.collection_fk = p_collection and ca.user_id = uid
  loop
    reason := '';
    if m.vid is null then reason := 'the packaged version no longer resolves';
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
  return jsonb_build_object('checked', true, 'invalid', bad);
end; $$;

create or replace function public.ccc_guard_collection_state()
returns trigger language plpgsql as $$
begin
  if not public.ccc_trusted() then
    if new.approved_by_user_bool is distinct from old.approved_by_user_bool
       or new.approved_at is distinct from old.approved_at
       or new.current_bool is distinct from old.current_bool then
      raise exception 'asset_collections: approval and current selection are set only by the server (ccc_approve_collection / ccc_set_current_collection)';
    end if;
  end if;
  return new;
end; $$;
create trigger ccc_collections_guard before update on public.asset_collections
  for each row execute function public.ccc_guard_collection_state();

create or replace function public.ccc_approve_collection(p_collection uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c record; check_result jsonb; out_row record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into c from asset_collections where id = p_collection and user_id = uid for update;
  if c.id is null then raise exception 'collection not found'; end if;
  if not exists (select 1 from collection_assets where collection_fk = p_collection and user_id = uid) then
    raise exception 'an empty collection cannot be approved';
  end if;
  check_result := public.ccc_revalidate_collection(p_collection);
  if (check_result->>'invalid')::integer > 0 then
    raise exception 'collection cannot be approved: % member(s) are stale or invalid', check_result->>'invalid';
  end if;
  perform set_config('ccc.trusted_path', 'on', true);
  update asset_collections set approved_by_user_bool = true, approved_at = now(), updated_at = now()
   where id = p_collection and user_id = uid returning * into out_row;
  perform set_config('ccc.trusted_path', 'off', true);
  return to_jsonb(out_row);
end; $$;

create or replace function public.ccc_set_current_collection(p_collection uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c record; check_result jsonb; out_row record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into c from asset_collections where id = p_collection and user_id = uid for update;
  if c.id is null then raise exception 'collection not found'; end if;
  check_result := public.ccc_revalidate_collection(p_collection);
  if (check_result->>'invalid')::integer > 0 then
    raise exception 'collection cannot become current: % member(s) are stale or invalid', check_result->>'invalid';
  end if;
  perform set_config('ccc.trusted_path', 'on', true);
  update asset_collections set current_bool = false, updated_at = now()
   where user_id = uid and collection_type = c.collection_type and current_bool and id <> p_collection;
  update asset_collections set current_bool = true, updated_at = now()
   where id = p_collection and user_id = uid returning * into out_row;
  perform set_config('ccc.trusted_path', 'off', true);
  return to_jsonb(out_row);
end; $$;

create or replace function public.ccc_add_collection_version(p_collection uuid, p_version uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v record; out_row record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into v from asset_versions where id = p_version and user_id = uid;
  if v.id is null then raise exception 'version not found'; end if;
  if not exists (select 1 from asset_collections where id = p_collection and user_id = uid) then
    raise exception 'collection not found';
  end if;
  insert into collection_assets (user_id, collection_fk, asset_fk, version_fk)
  values (uid, p_collection, v.asset_fk, v.id) returning * into out_row;
  return to_jsonb(out_row);
end; $$;

-- A source regressing anywhere propagates immediately: the affected assets are
-- marked stale and the collection memberships that package them are marked
-- stale too. Staleness is therefore DERIVED BY THE DATABASE — it does not
-- depend on any client remembering to revalidate.
create or replace function public.ccc_propagate_source_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid := coalesce(new.user_id, old.user_id); a record; verdict jsonb;
begin
  for a in select id from career_assets where user_id = owner loop
    verdict := public.ccc_asset_graph_eligible(a.id);
    perform set_config('ccc.trusted_path', 'on', true);
    update career_assets
       set eligibility_stale_bool = not (verdict->>'eligible')::boolean,
           eligibility_reason = case
             when (verdict->>'eligible')::boolean then ''
             else (select string_agg(format('%s: %s', x->>'label', x->>'reason'), ' | ')
                     from jsonb_array_elements(verdict->'reasons') x)
           end
     where id = a.id;
    perform set_config('ccc.trusted_path', 'off', true);
    update collection_assets ca
       set membership_stale_bool = true,
           membership_stale_reason = 'a source changed after packaging; revalidate the collection'
     where ca.user_id = owner and ca.asset_fk = a.id
       and not (verdict->>'eligible')::boolean;
  end loop;
  return coalesce(new, old);
end; $$;
create trigger ccc_ach_source_change after update on public.achievements
  for each row execute function public.ccc_propagate_source_change();
create trigger ccc_met_source_change after update on public.metrics
  for each row execute function public.ccc_propagate_source_change();
create trigger ccc_evi_source_change after update on public.evidence_items
  for each row execute function public.ccc_propagate_source_change();
create trigger ccc_claim_source_change after insert or update on public.sanitized_claims
  for each row execute function public.ccc_propagate_source_change();
create trigger ccc_arch_source_change after update on public.target_archetypes
  for each row execute function public.ccc_propagate_source_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Live maturity: pure criteria function, evaluated inside authorization
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ccc_maturity_criteria(uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb;
  fridays int; sundays int; monthlies int; achv int; graded int; director int;
  sanitized int; archetypes int; jd int; bullets_ok boolean; star boolean;
  coll boolean; needs_proof boolean; private_ext boolean;
begin
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

  -- a resume bullet per archetype: an approved, non-superseded CURRENT version
  -- on an eligible asset
  select archetypes > 0 and not exists (
    select 1 from target_archetypes t
     where t.user_id = uid and t.status = 'active' and t.approved_by_user_bool
       and not exists (
         select 1 from career_assets ca
          join asset_versions v on v.id = ca.current_version_fk and v.user_id = uid
          where ca.user_id = uid and ca.status = 'active' and ca.asset_type = 'resume_bullet'
            and ca.target_archetype_fk = t.id
            and v.approved_by_user_bool and not v.blocked_bool
            and (public.ccc_asset_graph_eligible(ca.id)->>'eligible')::boolean)
  ) into bullets_ok;

  select exists (
    select 1 from story_bank s
     where s.user_id = uid and s.status = 'active' and s.approved_by_user_bool
       and s.theme in ('leadership','scale')
       and s.situation <> '' and s.task <> '' and s.action <> '' and s.result <> ''
  ) into star;

  -- an APPROVED CURRENT collection whose exact packaged versions are all
  -- approved, unblocked, non-stale and currently eligible
  select exists (
    select 1 from asset_collections col
     where col.user_id = uid and col.status = 'active' and col.current_bool
       and col.approved_by_user_bool
       and col.collection_type in ('resume_version','interview_pack')
       and exists (select 1 from collection_assets ca where ca.collection_fk = col.id)
       and not exists (
         select 1 from collection_assets ca
          left join asset_versions v on v.id = ca.version_fk and v.user_id = uid
          join career_assets a on a.id = ca.asset_fk
          where ca.collection_fk = col.id
            and (ca.membership_stale_bool
                 or v.id is null or not v.approved_by_user_bool or v.blocked_bool
                 or a.status <> 'active'
                 or not (public.ccc_asset_graph_eligible(a.id)->>'eligible')::boolean))
  ) into coll;

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
    'bullet_per_archetype', jsonb_build_object('met', bullets_ok, 'detail', case when bullets_ok then 'covered by an approved current version' else 'missing for at least one archetype' end),
    'star_story',         jsonb_build_object('met', star, 'detail', case when star then 'approved story present' else 'no approved Leadership/Scale story' end),
    'collection_current', jsonb_build_object('met', coll, 'detail', case when coll then 'approved current collection, all packaged versions valid' else 'none qualifying' end),
    'no_needs_proof',     jsonb_build_object('met', not needs_proof, 'detail', case when needs_proof then 'violation present' else 'clean' end),
    'no_private_external',jsonb_build_object('met', not private_ext, 'detail', case when private_ext then 'violation present' else 'clean' end)
  );
  return c;
end; $$;

create or replace function public.ccc_maturity_met(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_and((v.value->>'met')::boolean), false)
    from jsonb_each(public.ccc_maturity_criteria(uid)) v;
$$;

-- AUTHORITATIVE: recomputed live on every P1 authorization check. A source
-- regressing revokes P1 writes on the very next statement — no RPC call, no
-- page load, no cached state involved.
create or replace function public.ccc_p1_unlocked(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ccc_maturity_met(uid) or public.ccc_override_active(uid);
$$;

-- maturity_state is now a DISPLAY CACHE only, refreshed by the RPC below.
comment on table public.maturity_state is
  'Display cache of the last computed maturity snapshot. NOT the authorization source: ccc_p1_unlocked recomputes ccc_maturity_criteria live on every P1 write check.';

create or replace function public.ccc_recompute_maturity()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c jsonb; all_met boolean;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  c := public.ccc_maturity_criteria(uid);
  select coalesce(bool_and((v.value->>'met')::boolean), false) into all_met from jsonb_each(c) v;
  insert into maturity_state (user_id, unlocked_bool, criteria, computed_at)
  values (uid, all_met, c, now())
  on conflict (user_id) do update
    set unlocked_bool = excluded.unlocked_bool, criteria = excluded.criteria, computed_at = now();
  return jsonb_build_object('unlocked', all_met, 'override_active', public.ccc_override_active(uid), 'criteria', c);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Complete P1 coverage + a durable override audit
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.override_mutations
  add column override_event_fk uuid references public.owner_overrides(id) on delete set null,
  add column reason_snapshot text not null default '';

-- comp_benchmarks and the P1 junctions were omitted from enforcement
do $$
declare t text;
begin
  foreach t in array array['comp_benchmarks','reference_application_uses','counter_benchmarks'] loop
    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert to authenticated
      with check (user_id = (select auth.uid()) and public.ccc_p1_unlocked((select auth.uid())))', t, t);
    execute format('create policy "%s_update_own" on public.%I for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()) and public.ccc_p1_unlocked((select auth.uid())))', t, t);
  end loop;
end $$;

-- audit INSERT, UPDATE and DELETE, snapshotting the reason that was in force
create or replace function public.ccc_log_override_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid := coalesce(new.user_id, old.user_id); ev record;
begin
  if public.ccc_maturity_met(owner) then return coalesce(new, old); end if;
  select o.id, o.reason into ev from owner_overrides o
   where o.user_id = owner and o.override_key = 'maturity_dev_override' and o.enabled_bool
   order by o.created_at desc limit 1;
  if ev.id is null then return coalesce(new, old); end if;
  insert into override_mutations (user_id, table_name, row_id, operation, override_event_fk, reason_snapshot)
  values (owner, tg_table_name, coalesce(new.id, old.id), tg_op, ev.id, ev.reason);
  return coalesce(new, old);
end; $$;

do $$
declare t text;
begin
  foreach t in array array[
    'companies','contacts','outreach','referrals','applications','interviews',
    'offers','offer_scenarios','counter_proposals','comp_benchmarks',
    'reference_application_uses','counter_benchmarks'
  ] loop
    execute format('drop trigger if exists ccc_%s_override_log on public.%I', t, t);
    execute format('create trigger ccc_%s_override_log after insert or update or delete on public.%I
      for each row execute function public.ccc_log_override_mutation()', t, t);
  end loop;
end $$;

-- the audit trail is append-only to everyone, including its owner
create or replace function public.ccc_override_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'override_mutations is an append-only audit trail';
end; $$;
create trigger ccc_override_audit_immutable before update or delete on public.override_mutations
  for each row execute function public.ccc_override_audit_immutable();
create trigger ccc_owner_overrides_immutable before update or delete on public.owner_overrides
  for each row execute function public.ccc_override_audit_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS + grants for the new tables
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.oauth_states to authenticated;
grant select, insert, update, delete on public.asset_external_uses to authenticated;

grant execute on function public.ccc_issue_oauth_state(text, text, text, text, text, integer) to authenticated;
grant execute on function public.ccc_claim_oauth_state(text) to authenticated;
grant execute on function public.ccc_purge_oauth_states() to authenticated;
grant execute on function public.ccc_asset_graph_eligible(uuid) to authenticated;
grant execute on function public.ccc_commit_asset_version(uuid, text, text, text, boolean, text, text, text, boolean) to authenticated;
grant execute on function public.ccc_log_external_use(uuid, text) to authenticated;
grant execute on function public.ccc_approve_asset_version(uuid) to authenticated;
grant execute on function public.ccc_add_collection_version(uuid, uuid) to authenticated;
grant execute on function public.ccc_approve_collection(uuid) to authenticated;
grant execute on function public.ccc_set_current_collection(uuid) to authenticated;
grant execute on function public.ccc_revalidate_collection(uuid) to authenticated;
grant execute on function public.ccc_maturity_criteria(uuid) to authenticated;
grant execute on function public.ccc_maturity_met(uuid) to authenticated;
grant execute on function public.ccc_trusted() to authenticated;
