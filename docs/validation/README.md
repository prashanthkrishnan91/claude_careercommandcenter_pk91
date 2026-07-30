# Validation report

## 1. Automated suites — 165 tests (run in this repo, output in BUILD_REPORT.md)

- `tests/schema.test.ts` — fresh 7-migration chain applies from an empty
  database (49 tables); exact canonical columns/enums/defaults; substituted
  values (`EVIDENCED`, `SENSITIVE`, `EXTERNAL_OK`, `COMPLETED`) rejected;
  composite same-user FKs on every relationship including all nine junction
  tables + Gate 7's qualifying offer; SECURITY DEFINER confined to an exact
  allowlist, each with a pinned search_path; RLS on all 49 tables (×4
  policies, ×1 select-only on the seven client-read-only tables — including
  `asset_versions` and `collection_assets`, which no client may write); grants;
  enforcement triggers (offer acceptance, Gate 7, version chain, external-use
  and collection validation, approval/current guards, reference use,
  has_metric sync, append-only audit).
- `tests/model.test.ts` — canonical zod schemas; promotion gate reasons;
  external-asset gate (incl. ATTESTED_NO_METRIC override); grader ceilings +
  director-signal (Ownership floor); visa gate math + market-motion menus;
  filters; settings.
- `tests/oauthState.test.ts` — OAuth state security: the authorization URL
  carries only an opaque nonce (no token/user id/verifier); sealed cookie is
  ciphertext; round-trip; fail-closed on missing/malformed key; key rotation
  revokes; tamper/expiry/replay-nonce/provider-enum rejection; HttpOnly/
  Secure/SameSite/path cookie shape; immediate-expiry clearing (single-use).
- `tests/assetSafety.test.ts` — EXACT serialized outbound payload via a
  deterministic capturing transport (after the real gate): sanitized claim
  REPLACES private text, raw private text absent; zero transport calls on a
  blocked graph; blocked/unavailable attempts audited; lifecycle
  revalidation (approve/collection/external-use blocked on stale sources,
  recovery clears); atomic version chain + DB triggers (same-asset current
  version, no cross-asset/backward supersession); junction cross-user and
  duplicate rejection.
- `tests/filters.test.ts` — vault filter combinations; the status filter is
  matched (never stripped), plus truth/privacy/employer/date/candidate.
- `tests/authoritativeBoundaries.test.ts` — the database refuses forged
  transitions on its own, tested AROUND the TypeScript service layer:
  atomic single-use OAuth claim (including eight concurrent claims where
  exactly one wins, cross-user refusal, expiry, purge, and an assertion that
  the claim is a single conditional UPDATE); transactional version commits
  (concurrent commits produce a dense ordered chain; a forced failure rolls
  back completely); version-exact external-use records with a trigger-derived
  `used_externally_bool`; version-exact collections with RPC-only approval and
  current selection, revalidation, and staleness propagation; the evidence
  verification and approved-archetype policies with exact-payload checks and a
  TS↔SQL parity matrix; live maturity (regression revokes P1 with no recompute
  call; a forged `maturity_state` grants nothing); all twelve P1 tables
  enforced with an append-only, reason-snapshotted override audit;
  direct-PostgREST bypass rejection for every safety-critical transition;
  `asset_versions` and `collection_assets` client-read-only (insert, update and
  delete all match nothing, with the column guards still firing on a privileged
  path); membership validated on UPDATE and rejecting a version filed under the
  wrong asset; an emptied approved/current collection demoted; a locked DELETE
  rejected on every one of the twelve P1 tables; the maturity/override
  predicates refusing to report on another user; and — the version-commit
  authority — no browser role holding EXECUTE on any low-level lifecycle
  function, an authenticated client denied the low-level commit, `anon`
  denied, a service-role call unable to commit to another user's asset, a
  commit without an audit refused outright, every generated version carrying a
  matching audit while blocked and unavailable attempts still audit, privacy
  and truth absent from the commit signature entirely, a manual version on an
  ineligible graph saving but staying non-external and non-approved, and a
  direct asset INSERT unable to fabricate any derived field.
- `tests/integrationContract.test.ts` — executes the SAME dataset module the
  browser certification runs (`scripts/integration-dataset.mjs`) against the
  full migration chain, so a nonexistent column, an invalid enum, a missing
  required field or a violated constraint fails on push instead of waiting for
  a live run. Covers the vault seed, grader persistence/ceilings/canonical
  `dimension_disputes`, user-defined + JD-derived archetypes with a retained
  source and a gap report, metric/evidence eligibility, version-exact
  collections, the whole P1 relationship chain, benchmark/scenario/counter,
  skills → strength-scored evidence → plan → dated progress, the Monthly
  Board, the OAuth race, the maturity regression, the full direct-write bypass
  matrix, and a structural scan asserting every column the module names exists.
- `tests/crud.test.ts` — behavior against the real migrations + RLS (PGlite
  hermetic; identical spec runs live with `TEST_LIVE=1`): CRUD/persistence,
  archive/restore, cross-user linking fails at the DB, spoofed user_id
  fails, quick-log defaults, promotion, pipeline, sanitization approval
  constraint + PRIVATE grader firewall, comparator + gap reports,
  one-current collections, visa seeding + attorney constraint, P1 writes
  rejected at the database while locked, offer acceptance on INSERT and
  UPDATE + Gate-7 specific-offer relationship (both directions), reference
  willingness via junction + uniqueness, rhythm briefs + gated candidate
  actions, maturity computed in the database + override (reason mandatory,
  direct writes rejected, changes logged, override-era mutations audited),
  no product delete/export.

## 2. Visual proof (this directory)

`desktop-*.png` / `mobile-*.png` — 22 screenshots of every principal surface,
rendered by `scripts/visual-proof.mjs` through the real production bundle with
a deterministic, realistic dataset (Supabase served by an in-process fake so
the offline build environment can render; reviewed for clipping, overflow,
semantic-color correctness, and absence of gradients/decorative color).

## 3. Real end-to-end integration (no interception)

`scripts/integration-live.mjs`, run by the `integration` workflow (dispatch +
push): real sign-in through the auth UI against the dedicated Supabase
project, then deterministic flows across every module — project + Quick Log
batch capture (focus-return verified) + metrics + evidence, hierarchy +
achievement proof, promotion gate, archive/restore via the Pipeline,
keyboard on the canonical hierarchy (J/K/E, ⌘↵ promotion gate with visible
blocked reasons, ⌘⇧A archive, Esc), filter combinations, P1 writes rejected
by the database while locked, owner override enabled through Settings
(reason prompted and logged), offer recording + Gate-7 qualifying-offer
acceptance (blocked first, accepted after), STAR story approval, archetype
creation, asset generation blocked by the truth gate then generated via the
deterministic stub transport (`CCC_AI_TRANSPORT=stub`, applied AFTER the
real gate), version approval + external-use logging, Sunday Review brief,
reference willingness enforcement (blocked → confirmed → recorded).

It then EXECUTES the remaining module workflows rather than probing their
routes: a concurrent OAuth-claim race at the real storage boundary; grader
evaluation persistence with 7 scored dimensions, rationales, the
ATTESTED_NO_METRIC ceiling and a recorded dispute; a JD-derived archetype
through approval, comparator and a persisted gap report; metric and evidence
source-graph eligibility (unverified evidence refused with its exact reason,
then cleared); a version-exact collection through membership → approval →
current → invalidation by a regressed source; the full P1 relationship chain
(company → contact → outreach → application → referral → interview →
debrief, plus a rejected dangling link); comp benchmark, offer scenario and
counter-proposal with its benchmark link; skill → linked evidence →
development plan → progress → stale detection; the Monthly Board Review; and
a maturity regression that revokes P1 writes with no recompute call. Then
screenshots of every surface (`live/` artifacts) and cleanup.

**Status: gated on GitHub Secrets** (`CCC_TEST_EMAIL_A`, `CCC_TEST_PASSWORD`)
which only the repository owner can add — the build environment cannot write
GitHub secrets, and its egress policy blocks supabase.co, so this run could
not be executed from the build session. On push without secrets the browser
job skips (the hermetic workflow gates the commit); an explicit dispatch
without secrets fails closed. Dispatch it once they are added and the run
link becomes the final integration evidence.
