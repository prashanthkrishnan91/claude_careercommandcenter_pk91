# BUILD_REPORT — Career Command Center (complete P0 + P1, one PR)

Built 2026-07-29/30 against the full locked document chain (committed
verbatim in `docs/architecture/`): v2.1 architecture, v2.1.1 amendments +
v2.2 experience design, v2.2.1 final schema amendment, v2.2.2 errata (v1/v2
included as lineage; v2 §5–§8 normative where v2.1 references them). By
explicit owner instruction this PR delivers the entire locked product —
the documents' multi-PR rollout is treated as the original strategy, not the
build constraint. The architecture content itself was not altered.

## Correction history (root cause → fix)

PR #1's first iteration was built with only the v2.2.2 errata available and
substituted field names, enum sets, hard deletion, a modal quick-log, and an
empty Pipeline. This branch is a ground-up correction (history rewritten):

| Substitution (removed) | Canonical (implemented) |
|---|---|
| `summary/role/organization` on projects | `employer, role_at_time, description, business_context, my_scope, team_size, stakeholders[]` |
| `title/description`, nullable project link, standalone achievements | `headline, narrative, action_taken, outcome`, **required** `project_fk` |
| `label/value/source/measured_on` metrics with project links | `metric_name, value, unit, time_period, baseline_value, calculation_notes`, `achievement_fk` only |
| `kind NOTE/QUOTE/…`, `title/content/url` evidence with project links | `type link/email_ref/note/testimonial/metric_source`, `content_summary, external_url, verified_at, verified_by` |
| 3-value truth set with `EVIDENCED`; `SENSITIVE/EXTERNAL_OK` privacy | six canonical truth statuses; `PUBLIC_SAFE/INTERNAL_ONLY/PRIVATE` |
| `ACTIVE/COMPLETED/ARCHIVED` lifecycle, truth/candidate on every table | per-entity canonical statuses (`draft/active/archived` etc.), fields only where the model defines them |
| Hard delete buttons + repo delete functions | archival lifecycle; restore; **no** product delete path |
| Quick Log = evidence modal | Quick Log = inline non-blocking bar creating draft achievements (headline+project), focus-return batch entry |
| Pipeline = empty placeholder | working layer: drafts / recent 20 / archived + restore, filtered |
| JSON export in Settings | removed (v2.2.2 C1 defers export) |
| Cmd+Shift+A = new achievement | Cmd+Shift+A = archive focused item; N = quick log in context |

## Release-blocker correction pass (semantic review → fixes)

Ten confirmed blockers, each fixed at the trust boundary (database, server
route, or canonical service) — not by hiding UI:

| # | Root cause | Fix |
|---|---|---|
| 1 | OAuth `state` carried a sealed blob (sensitive data adjacent to the URL) and no PKCE | State is now an opaque single-use random nonce; the full binding (user, provider, redirect, PKCE verifier, session token, iat/exp) lives in an AES-256-GCM HttpOnly/Secure/SameSite cookie scoped to `/api/google`; constant-time nonce check, closed provider enum, generic error redirects, `no-store` headers, cookie cleared on every callback (`lib/server/oauthState.ts`) |
| 2 | Asset generation gated only the primary achievement; sanitized text was appended, not substituted | One canonical source-resolution service (`lib/sourceGraph.ts`) resolves achievements + metrics + evidence + claims + archetype via junction tables, classifies each source by its own rules, REPLACES private text with the approved claim, and builds a deterministic payload manifest; the suite inspects the exact serialized outbound payload |
| 3 | Eligibility checked only at generation | `lib/assetService.ts` revalidates the full graph on generate / author / approve / collection-add / external-use, persists `eligibility_stale_bool` + reason, audits every attempt (including unavailable) to `ai_outputs` |
| 4 | UUID-array relationships (no FK integrity) | Nine junction tables with `user_id` + composite same-user FKs to both parents + uniqueness + RLS; array columns dropped; version-chain triggers |
| 5 | Offer acceptance enforced only on UPDATE; Gate 7 unlinked to an offer | Trigger runs on INSERT + UPDATE and requires `attorney_reviewed_doc_ref`; Gate 7 must reference the specific qualifying offer (`qualifying_offer_fk`, same-user FK) and regresses if that offer disappears |
| 6 | Maturity enforced by hiding UI; override could be set silently | Database-authoritative: `ccc_recompute_maturity` (corrected v2.1 §15 semantics) persists client-read-only `maturity_state`; P1 write policies check it inside RLS; `ccc_set_override` demands a reason and logs every change; override-era mutations audited to `override_mutations` |
| 7 | Vault stripped the status filter before matching; keyboard not wired to the hierarchy | Status filter passes through; J/K/E/⌘↵/⌘⇧A/Esc operate on the flattened canonical hierarchy with the real promotion gate behind ⌘↵; browser checks added |
| 8 | Integration script only asserted route titles | Deterministic end-to-end flows for all modules, real Supabase (no interception), stub transport AFTER the real gate, cleanup, artifacts |
| 9 | Regression gaps | 39 new behavioral tests (OAuth state, exact payload, lifecycle, version chain, offers/Gate 7, DB maturity + bypass + audit, filters) |
| 10 | PR/report claims drifted from the code | This document and the PR body rewritten to the verified state only |

## Authoritative-boundary pass (second semantic review)

A follow-up review found that four rules lived in the database but were still
reachable only through cooperative client code, and that maturity was a cached
snapshot. Migration `20260730030000_authoritative_boundaries.sql` closes that:

| # | Finding | Correction |
|---|---|---|
| 1 | Clearing a cookie is not replay prevention | Server-side `oauth_states` ledger (hashed nonce, provider, redirect, encrypted PKCE verifier + session binding, issued/expiry/consumed). `ccc_claim_oauth_state` claims it with ONE conditional UPDATE whose guard is in the WHERE clause, so concurrent callbacks contend on the row lock and exactly one wins — the cookie is irrelevant to the outcome. Documented 24-hour purge. |
| 2 | `commitVersion` was several PostgREST calls | `ccc_commit_asset_version`: locks the asset, allocates the number, inserts, supersedes the open prior, repoints `current_version_fk`, derives truth/privacy — one transaction, full rollback on failure. Concurrency and forced-failure rollback tested. |
| 3 | External use was mutable JSON with a caller-supplied version number | `asset_external_uses` table: version-exact, validated on insert (resolves, same asset+user, approved, unblocked, IS the current version, graph currently eligible). `used_externally_bool` is trigger-derived and rejected if set directly. |
| 4 | Collections referenced abstract assets | `collection_assets.version_fk` — the exact approved version, same-user and same-asset enforced. Approval and current selection are RPC-only and revalidate contents; a later source change marks memberships stale; maturity requires the approved current collection's exact versions to be valid. |
| 5 | Unverified evidence and unapproved archetypes could enter payloads | Canonical evidence-verification policy (`verified_at` + `verified_by` required — PUBLIC_SAFE is privacy, not proof) and approved-active archetype requirement, both in SQL and TypeScript, with exact-payload tests. Raw retained JD text never travels. |
| 6 | `maturity_state` was refreshed only when the UI asked | `ccc_p1_unlocked` now evaluates `ccc_maturity_criteria` live; `maturity_state` is a display cache. Regressing a source revokes P1 writes on the next statement, and a forged cache cannot grant access. |
| 7 | `comp_benchmarks` and the P1 junctions were unenforced; the audit could be re-read through a later reason | All twelve P1 tables enforced; `override_mutations` records INSERT/UPDATE/DELETE with the override event id and an immutable reason snapshot; both audit tables are append-only. |
| 8 | Safety-critical writes went through generic `updateRow` | Approval, collection approve/current/membership and external use are RPC-only, with guard triggers rejecting the generic update. Direct-PostgREST bypass tests prove each refusal. |
| 9 | Integration script probed route titles | 39 checks that execute the workflows — grader persistence/ceilings/dispute, JD archetype + comparator + persisted gap report, metric/evidence eligibility, version-exact collections through approval → current → invalidation, the full P1 relationship chain, benchmark + scenario + counter, skills → evidence → plan → progress → stale, Monthly Board, maturity regression, and a concurrent OAuth-claim race at the real storage boundary. |

## Write-bypass closure pass (third semantic review)

The prior pass guarded specific COLUMNS but left whole OPERATIONS open.
`20260730040000_close_write_bypasses.sql` closes them:

| # | Finding | Correction |
|---|---|---|
| 1 | A client could INSERT an asset version outright (forging model/prompt metadata, skipping the audit), DELETE one, or break the chain | `asset_versions` is client-read-only: all DML revoked, write policies dropped. Creation goes through `ccc_commit_asset_version`; hand-authoring through `ccc_author_manual_version`, which records the version as hand-authored and does not accept model metadata from the caller. |
| 2 | `career_assets` derived fields were guarded one at a time | One guard covers `current_version_fk`, `truth_status_summary`, `privacy_class`, `used_externally_bool` and `eligibility_*`. Staleness is refreshed only by `ccc_refresh_asset_eligibility` / the propagation trigger — `lib/assetService.ts` no longer writes those columns at all. |
| 3 | `collection_assets` accepted direct UPDATE and DELETE | Client-read-only; add/remove through `ccc_add_collection_version` / `ccc_remove_collection_version`. Validation runs on INSERT **and UPDATE** (version resolves, belongs to the stated asset, same user for asset+version+collection, approved, unblocked, graph eligible, not stale). Revalidation explicitly reports `version.asset_fk <> membership.asset_fk`. Any membership change atomically re-checks the collection and DEMOTES an approved/current one that would be left invalid or empty. |
| 4 | P1 DELETE was ungated | All twelve P1 tables gate DELETE on `ccc_p1_unlocked()` alongside INSERT and UPDATE; a locked-delete rejection test covers every table, and override-era deletes are audited. |
| 5 | Maturity/override predicates accepted an arbitrary user id | The public predicates take **no parameter** and derive the subject from `auth.uid()`; `ccc_maturity_criteria(uid)` rejects any id that is not the caller's. The parameterised implementations exist for triggers and are not granted to `authenticated`. |
| 6 | The integration script named columns and enums that do not exist | Every operation corrected against the canonical schema (`gc_sponsorship_history`, `channel = linkedin`, `summary`, `stage = requested`, `round`/`debrief_markdown`/`themes`/`outcome`, `total_comp_low/high`/`as_of`, `dimension_disputes`, canonical skill fields, `demonstration_strength_1_to_5`, plan gap/level/method fields, `progress_date`/`notes`/linked-achievement/assessment fields). |
| 7 | A schema mismatch could only be discovered during a live run | The dataset lives in `scripts/integration-dataset.mjs` and is executed TWICE: by the browser certification and by `tests/integrationContract.test.ts` against the full PGlite chain. The hermetic gate now fails on a bad column, invalid enum, missing required field or violated constraint — plus a structural scan that checks every column the module names against `information_schema`. |
| 8 | *(found by the new gate)* Fifteen composite `ON DELETE SET NULL` constraints nulled `user_id` too, so deleting any parent raised a not-null violation | Each restricted to its own foreign-key column. |

## Version-commit authority pass (fourth semantic review)

`asset_versions` was locked, but the low-level `ccc_commit_asset_version` RPC
was still executable by `authenticated` — so a browser could commit a version
with caller-supplied content, model name, prompt hash, privacy and truth, make
it current, and never touch the AI route or its audit. The table was locked;
the door beside it was not. `20260730050000_server_only_commit.sql` closes it:

| # | Correction |
|---|---|
| 1 | `ccc_commit_asset_version`, `ccc_author_manual_version`, `ccc_record_ai_audit`, `ccc_asset_graph_eligible_for` and `ccc_truth_summary` are revoked from PUBLIC, `anon` and `authenticated`, and granted only to `service_role`. Not a rename: the old signature is DROPPED. |
| 2 | A server-only service-role client (`lib/server/supabaseAdmin.ts`, `import "server-only"`) reads `SUPABASE_SERVICE_ROLE_KEY` — no `NEXT_PUBLIC_` name, no committed fallback. Routes authenticate the caller with the user-bound client, resolve the user id server-side, and pass it to the database function, which enforces it and locks only that user's asset. A service-role call to another user's asset fails. |
| 3 | Generation is reachable only via `/api/ai/generate-asset`: authenticate → gate the graph → build the payload → call the model or test transport → commit through the server-only function → audit. Model name and prompt hash come from this server's own call; privacy and truth are derived in the database. The audit is written IN THE SAME TRANSACTION, so a version presented as model-generated cannot exist without it, and a commit carrying no audit is refused. |
| 4 | Manual authoring moves to `/api/assets/manual-version`, which accepts only an asset id and content. Privacy, truth, model metadata, prompt hash, blocking, supersession and current-version are all derived. A manual version on an ineligible graph is saved but stays non-PUBLIC_SAFE, unapprovable, unpackageable and visibly stale, and is audited as user-authored. |
| 5 | `career_assets` derived fields are forced to canonical defaults on INSERT, so a new asset cannot arrive PUBLIC_SAFE, externally used, eligible, or pointing at an arbitrary current version. |
| 6 | The shared integration dataset no longer calls the low-level RPC as a browser user. It takes an injected `createVersion` adapter: the browser certification posts to the protected API, the hermetic suite uses a privileged `service_role` harness. Its bypass matrix now also asserts the low-level RPCs are denied. |

## Stack

Next.js 15 (App Router, TS, Tailwind; client data layer over
`@supabase/supabase-js`; AI/OAuth server-only in route handlers) · Supabase
Postgres/Auth/RLS (dedicated project `claude_careercommandcenter_pk91`, ref
`loejfyzocsuzzmifxxhw`, us-east-1, $0/mo) · Vitest + PGlite (hermetic tests
execute the real migration files with RLS enforced per simulated user) ·
Playwright (visual proof + real integration flow) · IBM Plex Sans/Mono
vendored from npm.

## Schema

Seven-migration chain, applied identically to the remote project and loaded
verbatim by the hermetic suite (drift breaks tests):

1. `20260730000100_p0a_canonical_schema.sql` — the four canonical entities.
2. `20260730002000_full_product_schema.sql` — sanitized_claims,
   grader_evaluations, target_archetypes, archetype_sources, gap_reports,
   career_assets, asset_versions, asset_collections, story_bank,
   visa_checklist_items, weekly_briefs, action_items, ai_outputs, companies,
   contacts, applications, outreach, referrals, interviews, comp_benchmarks,
   offers, offer_scenarios, counter_proposals, skills, skill_evidence,
   skill_development_plans, skill_development_progress, "references",
   google_connections, ingestion_runs, ingested_items, owner_overrides.
3. `20260730010000_integrity_and_enforcement.sql` — release-blocker
   corrections: nine normalized junction tables replacing every UUID-array
   relationship (asset_source_achievements / _evidence / _metrics,
   collection_assets, story_achievements, story_archetypes, plan_archetypes,
   reference_application_uses, counter_benchmarks — each with `user_id`,
   composite same-user FKs to BOTH parents, uniqueness, RLS), version-chain
   triggers, offer acceptance on INSERT + UPDATE, Gate 7 ⇢ specific
   qualifying offer (`qualifying_offer_fk`), database-authoritative maturity
   (`maturity_state`, `override_mutations`, `ccc_recompute_maturity`,
   `ccc_set_override`, P1 write policies gated on `ccc_p1_unlocked`).
4. `20260730020000_enforcement_corrections.sql` — defects the hermetic suite
   found running the full chain from empty: `date - bigint` cast, composite
   SET NULL column list, Gate-7 regression when its offer disappears,
   unreachable acceptance branch folded, override-audit NULL guard.
5. `20260730030000_authoritative_boundaries.sql` — `oauth_states` (atomic
   single-use claim), `asset_external_uses` (version-exact records; the
   mutable `external_use_log` JSON column is dropped),
   `collection_assets.version_fk`, `ccc_asset_graph_eligible` (the source
   rules in SQL, incl. the evidence-verification policy and approved-archetype
   requirement), `ccc_commit_asset_version`, the approval / collection /
   external-use RPCs with their guard triggers, live maturity
   (`ccc_maturity_criteria` inside `ccc_p1_unlocked`), full P1 coverage and the
   durable override audit.
6. `20260730040000_close_write_bypasses.sql` — `asset_versions` and
   `collection_assets` become client-read-only (all DML revoked, policies
   dropped, every mutation through a validating RPC); `career_assets` derived
   fields guarded as a set; membership validated on UPDATE as well as INSERT
   with an atomic demote of an approved/current collection that would be left
   invalid or empty; P1 DELETE gated on maturity; the maturity/override
   predicates made parameterless; and the 15 remaining composite
   `ON DELETE SET NULL` constraints scoped to their own column.
7. `20260730050000_server_only_commit.sql` — the low-level commit,
   manual-author, audit-record, explicit-user graph gate and truth-summary
   functions are revoked from PUBLIC, `anon` and `authenticated` and granted
   only to `service_role`; the commit is re-signed to take the acting user
   explicitly, derives privacy and truth itself, and writes the `ai_outputs`
   audit row in the same transaction; `career_assets` derived fields are forced
   to canonical defaults on INSERT.

49 public tables. Every table: `user_id` default `auth.uid()`, RLS scoped to
the user, and **composite same-user foreign keys** — a child row's
`(fk, user_id)` must match a parent owned by the same user, so cross-user
linking fails in the database, not in application code. Enforcement objects:
sanitized-claim approval ⇒ PUBLIC_SAFE (check), attorney-gated visa states
(check), one current resume/profile collection (partial unique index),
offer-acceptance + Gate-7 triggers (insert AND update), version-chain
triggers (same-asset current version, no cross-asset or backward
supersession), external-use and collection-membership validation triggers,
guard triggers on approval / current selection / derived flags,
reference-willingness trigger, `has_metric_bool` sync trigger, append-only
audit triggers. `ccc_*` functions are invoker-rights except the SECURITY
DEFINER set that must write client-read-only tables or act as the
authorization predicate; each pins `search_path` and is scoped to
`auth.uid()`. The schema test enforces the exact allowlist.

## Security remediation (from the correction mandate)

1. Hardcoded test emails/passwords removed from source; the live suite reads
   credentials only from `CCC_TEST_EMAIL_A/B` + `CCC_TEST_PASSWORD` and fails
   closed when absent (no fallbacks anywhere; verified by repo-wide grep).
2. The exposed test users were **deleted** from the Supabase project and
   replaced with rotated accounts (`ci-a@…`/`ci-b@…`, random password held
   only for handoff to GitHub Secrets — never committed).
3. Branch history **rewritten**: the PR branch now contains no commit with
   the old credentials (single clean commit atop `main`). GitHub may retain
   orphaned commits by SHA — which is why rotation was done regardless.
4. `SECURITY DEFINER` removed from the updated-at trigger function; the only
   definers are the five maturity/override functions that must write
   client-read-only tables (schema test enforces the exact allowlist and
   pinned search_path).
5. Same-user relational integrity via composite FKs on all 25+ relationships
   (tested: cross-user project/achievement/metric/evidence linking fails).
6. Public sign-up removed from the login surface; owner bootstrap documented
   (`docs/deployment.md`): Supabase dashboard → Add user → disable sign-ups.
7. Publishable key remains client-side by design; no service-role or secret
   key exists anywhere in the repo; AI + Google secrets are server-env only.

## Remote database actions (complete log)

| # | Action | Result |
|---|---|---|
| 1 | Row-count inspection of the four substituted tables | 0 rows each (throwaway CI data already cleaned) — destructive replacement authorized |
| 2 | Drop substituted tables + `ccc_set_updated_at`; delete migration record | done |
| 3 | Delete exposed test users (auth.users + identities) | 0 users remained |
| 4 | Apply `p0a_canonical_schema` | success |
| 5 | Create rotated CI users (pre-confirmed) | `ci-a@career-cc-tests.example.com`, `ci-b@…` |
| 6 | Apply `full_product_schema` | success (36 public tables) |
| 7 | Apply `integrity_and_enforcement` (junctions, triggers, maturity) | success (47 public tables) |
| 8 | Apply `enforcement_corrections` (fixes found by the hermetic chain) | success |
| 10 | Apply `close_write_bypasses` in three parts (read-only version/membership tables + RPCs, P1 DELETE gating + parameterless predicates, composite SET NULL corrections) | success (49 tables; 0 leftover DML grants, 12 gated DELETE policies, 0 unscoped composite SET NULL) |
| 9 | Apply `authoritative_boundaries` in six parts (OAuth ledger, SQL graph gate, transactional commits + external-use records, version-exact collections, live maturity, P1 coverage + grants) | success (49 public tables; verified to match the hermetic chain) |

Travel and Finance Supabase projects were not touched at any point.
(Housekeeping note from the previous iteration remains: the paused travel
project still holds four empty leftover tables from before the dedicated
project existed; drop SQL is in the PR discussion. Pre-existing advisory:
8 travel-app tables have RLS disabled — unrelated to this repo.)

## Verification evidence

### Automated suites — 165 passing

```
behavior suite backend: pglite (hermetic, real migrations + RLS)

 ✓ tests/model.test.ts                  (24 tests)
 ✓ tests/filters.test.ts                 (7 tests)
 ✓ tests/oauthState.test.ts             (14 tests)
 ✓ tests/schema.test.ts                 (16 tests)
 ✓ tests/assetSafety.test.ts            (14 tests)
 ✓ tests/crud.test.ts                   (30 tests)
 ✓ tests/authoritativeBoundaries.test.ts (46 tests)
 ✓ tests/integrationContract.test.ts     (14 tests)

 Test Files  8 passed (8)
      Tests  165 passed (165)
```

Coverage map against the test contract: full migration chain from an empty
database (49 tables) ✓ · canonical schema/constraints ✓ · RLS + cross-user
isolation (including junction tables) ✓ · archive/restore ✓ ·
hierarchy/persistence ✓ · OAuth state security (no sensitive data in
state/URL, tamper/expiry/replay/nonce/provider/key-rotation rejection,
cookie flags) ✓ · EXACT outbound AI payload via deterministic capturing
transport (sanitized claim REPLACES private text; zero transport calls when
blocked) ✓ · asset lifecycle revalidation + staleness + audit ✓ ·
version-chain integrity (DB triggers) ✓ · sanitization approval ✓ · grader
rubric + director threshold + ceilings ✓ · archetype approval + JD retention
✓ · comparator output ✓ · visa dependencies + market-motion gating ✓ ·
weekly workflows ✓ · maturity computed IN the database + direct P1 bypass
rejected at RLS + override reason/logging/audit ✓ · offer acceptance on
INSERT and UPDATE + Gate-7 specific-offer relationship ✓ · reference
willingness via junction ✓ · vault filter combinations (status never
stripped) ✓ · quick-log defaults ✓ · no product
delete/export/PDF/LinkedIn-automation code ✓ · spoofed user_id ✓ ·
**atomic single-use OAuth claim under concurrency** ✓ · **transactional
version commits (concurrency + forced-failure rollback)** ✓ · **version-exact
external-use records with a derived flag** ✓ · **version-exact collections
with revalidation on approve/current and staleness propagation** ✓ ·
**evidence-verification and approved-archetype policy, in SQL and TS, pinned
to agreement by a parity test** ✓ · **live maturity: regression revokes P1
without a recompute, and a forged cache grants nothing** ✓ · **all twelve P1
tables enforced; INSERT/UPDATE/DELETE audited with an immutable reason
snapshot; audit tables append-only** ✓ · **direct-PostgREST bypass rejected
for approval, collection membership/approval/current, and external use** ✓.

### Build

`next build` clean — 30 routes.

### Migration chain from empty

Re-applied file-by-file into a fresh in-process Postgres: all five migrations
apply cleanly and produce 49 tables — the same count the remote project
reports after the identical files were applied there.

### Visual proof

22 desktop + mobile screenshots of every principal surface in
`docs/validation/` with a deterministic realistic dataset; reviewed for
clipping, overflow, semantic-color correctness (truth = blue spectrum,
privacy = green/amber/red, lifecycle = opacity/dashed), flat background, no
decorative color. See `docs/validation/README.md`.

### Real integration (no interception)

`scripts/integration-live.mjs` + `integration.yml` (dispatch + push) — real
sign-in through the auth UI against the live Supabase project, then
deterministic end-to-end flows across the modules: vault capture → metrics /
evidence → promotion gate → archive/restore → **keyboard on the canonical
hierarchy (J/K/E, ⌘↵ promotion gate, ⌘⇧A archive, Esc)** → **filter
combinations** → P1 blocked at the database while locked → owner override
via settings (reason prompted, logged) → offer + Gate-7 qualifying-offer
acceptance → STAR story approval → archetype → asset generation blocked by
the truth gate, then generated through the stub transport
(`CCC_AI_TRANSPORT=stub`, applied AFTER the real gate), approved, external
use logged → Sunday Review brief → reference willingness enforcement.
Screenshots uploaded as run artifacts; cleanup runs afterwards (test
tooling; the product itself never deletes). **Gated on GitHub Secrets the
owner must add** (`CCC_TEST_EMAIL_A`, `CCC_TEST_PASSWORD`); fails closed
without them — the run id becomes the final evidence once secrets exist.

## Honest status classification

- **Fully implemented and validated:** everything in the test-coverage map
  above, hermetically against the real schema; live CI re-runs the identical
  spec once secrets exist.
- **Implemented but externally unconfigured:** Anthropic calls
  (`ANTHROPIC_API_KEY`), Google ingestion (`GOOGLE_CLIENT_ID/SECRET`,
  `CCC_TOKEN_ENCRYPTION_KEY`), Vercel deployment (owner one-click import).
- **Implemented and maturity-gated:** the Career distribution surfaces.
- **Impossible to validate without real historical usage:** the maturity
  criteria themselves (four real weeks of captures/reviews, 15 real
  achievements, etc.). No such usage occurred and none is claimed; the dev
  override exists for validation, is visibly labeled, and every use is logged.

## Judgment calls (doc-silent points, all logged)

1. P1 entity fields beyond v2's `…` sketches (contacts/outreach/etc.) filled
   minimally; domain state named `stage` where the archival `status`
   convention would collide (applications/referrals).
2. `career_assets.target_archetype_fk` added to satisfy v2.1 §15's "resume
   bullet per archetype" and §6.5 variant forking (marked as the variant
   link).
3. Grader ceilings mapped: ATTESTED_NO_METRIC caps quantified-impact and
   evidence-quality at 3; INFERRED/NEEDS_PROOF/DISPUTED at 2 (v2.1 §4.5's
   "lower ceiling" made concrete).
4. Restore of an archived achievement returns it to `draft` — promotion back
   to `active` must re-pass the gate.
5. Story-bank STAR gate satisfied by a complete Leadership/Scale entry
   (assets have no theme field).
6. `references` table name is a reserved word — quoted identifier kept to
   stay canonical.
7. Comparator is fully deterministic (no AI numbers); scope coverage is
   reported as partial/manual honestly.
8. Delete RLS policies exist per v2.1.1 A1 ("reads, writes, and deletes")
   for account cleanup and isolated test tooling; the product surface and
   repos expose archival only.
9. Narrative fields render as editable text (click-to-edit contract) rather
   than rendered markdown; deferred markdown display noted in the backlog.
