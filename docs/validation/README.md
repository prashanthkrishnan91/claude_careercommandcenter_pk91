# Validation report

## 1. Automated suites (run in this repo, output in BUILD_REPORT.md)

- `tests/schema.test.ts` — fresh migration chain applies; exact canonical
  columns/enums/defaults; substituted values (`EVIDENCED`, `SENSITIVE`,
  `EXTERNAL_OK`, `COMPLETED`) rejected; composite same-user FKs; no
  SECURITY DEFINER on `ccc_*`; RLS ×4 policies on all 36 tables; grants;
  enforcement triggers.
- `tests/model.test.ts` — canonical zod schemas; promotion gate reasons;
  external-asset gate (incl. ATTESTED_NO_METRIC override); grader ceilings +
  director-signal (Ownership floor); visa gate math + market-motion menus;
  filters; settings.
- `tests/crud.test.ts` — behavior against the real migrations + RLS (PGlite
  hermetic; identical spec runs live with `TEST_LIVE=1`): CRUD/persistence,
  archive/restore + default-list exclusion, cross-user linking fails at the
  DB, spoofed user_id insert/update fail, quick-log defaults, promotion,
  pipeline, sanitization approval constraint + PRIVATE grader firewall,
  comparator + gap reports, one-current collections, visa seeding + attorney
  constraint, offer Gate-7 trigger (both block paths), references willingness
  constraint, rhythm briefs + gated candidate actions, maturity gates + logged
  override, no product delete/export.

## 2. Visual proof (this directory)

`desktop-*.png` / `mobile-*.png` — 22 screenshots of every principal surface,
rendered by `scripts/visual-proof.mjs` through the real production bundle with
a deterministic, realistic dataset (Supabase served by an in-process fake so
the offline build environment can render; reviewed for clipping, overflow,
semantic-color correctness, and absence of gradients/decorative color).

## 3. Real end-to-end integration (no interception)

`scripts/integration-live.mjs`, run by the `integration` workflow: real
sign-in through the auth UI against the dedicated Supabase project, creates
1 project + 2 achievements (Quick Log batch entry, focus-return verified) +
2 metrics + 2 evidence items, verifies the Vault hierarchy and achievement
proof, promotes one draft through the gate, archives + restores via the
Pipeline, verifies mobile capture, screenshots every surface (`live/`
artifacts), and cleans up its rows.

**Status: gated on GitHub Secrets** (`CCC_TEST_EMAIL_A/B`, `CCC_TEST_PASSWORD`)
which only the repository owner can add — the build environment cannot write
GitHub secrets, and its egress policy blocks supabase.co, so this run could
not be executed from the build session. The workflow fails closed until the
secrets exist; dispatch it once they are added and the run link becomes the
final integration evidence.
