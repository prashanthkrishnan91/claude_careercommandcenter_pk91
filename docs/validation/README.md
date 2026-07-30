# Validation report

## 1. Automated suites — 105 tests (run in this repo, output in BUILD_REPORT.md)

- `tests/schema.test.ts` — fresh 4-migration chain applies from an empty
  database (47 tables); exact canonical columns/enums/defaults; substituted
  values (`EVIDENCED`, `SENSITIVE`, `EXTERNAL_OK`, `COMPLETED`) rejected;
  composite same-user FKs on every relationship including all nine junction
  tables + Gate 7's qualifying offer; SECURITY DEFINER confined to the exact
  five-function maturity/override allowlist (pinned search_path); RLS on all
  47 tables (×4 policies, ×1 select-only on the client-read-only tables);
  grants; enforcement triggers (offer acceptance, Gate 7, version chain,
  reference use, has_metric sync).
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
reference willingness enforcement (blocked → confirmed → recorded) — then
screenshots of every surface (`live/` artifacts) and cleanup.

**Status: gated on GitHub Secrets** (`CCC_TEST_EMAIL_A`, `CCC_TEST_PASSWORD`)
which only the repository owner can add — the build environment cannot write
GitHub secrets, and its egress policy blocks supabase.co, so this run could
not be executed from the build session. On push without secrets the browser
job skips (the hermetic workflow gates the commit); an explicit dispatch
without secrets fails closed. Dispatch it once they are added and the run
link becomes the final integration evidence.
