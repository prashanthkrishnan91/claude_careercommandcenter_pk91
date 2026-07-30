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

## Stack

Next.js 15 (App Router, TS, Tailwind; client data layer over
`@supabase/supabase-js`; AI/OAuth server-only in route handlers) · Supabase
Postgres/Auth/RLS (dedicated project `claude_careercommandcenter_pk91`, ref
`loejfyzocsuzzmifxxhw`, us-east-1, $0/mo) · Vitest + PGlite (hermetic tests
execute the real migration files with RLS enforced per simulated user) ·
Playwright (visual proof + real integration flow) · IBM Plex Sans/Mono
vendored from npm.

## Schema

Two-migration chain, applied identically to the remote project and loaded
verbatim by the hermetic suite (drift breaks tests):

1. `20260730000100_p0a_canonical_schema.sql` — the four canonical entities.
2. `20260730002000_full_product_schema.sql` — sanitized_claims,
   grader_evaluations, target_archetypes, archetype_sources, gap_reports,
   career_assets, asset_versions, asset_collections, story_bank,
   visa_checklist_items, weekly_briefs, action_items, ai_outputs, companies,
   contacts, applications, outreach, referrals, interviews, comp_benchmarks,
   offers, offer_scenarios, counter_proposals, skills, skill_evidence,
   skill_development_plans, skill_development_progress, "references",
   google_connections, ingestion_runs, ingested_items, owner_overrides
   (36 tables total).

Every table: `user_id` default `auth.uid()`, RLS select/insert/update/delete
scoped to the user, and **composite same-user foreign keys** — a child row's
`(fk, user_id)` must match a parent owned by the same user, so cross-user
linking fails in the database, not in application code. Enforcement objects:
sanitized-claim approval ⇒ PUBLIC_SAFE (check), attorney-gated visa states
(check), one current resume/profile collection (partial unique index),
offer-acceptance Gate-7 trigger, `has_metric_bool` sync trigger. All `ccc_*`
functions are invoker-rights (no SECURITY DEFINER).

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
4. `SECURITY DEFINER` removed from the updated-at trigger function (all
   functions invoker-rights; schema test enforces this).
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

Travel and Finance Supabase projects were not touched at any point.
(Housekeeping note from the previous iteration remains: the paused travel
project still holds four empty leftover tables from before the dedicated
project existed; drop SQL is in the PR discussion. Pre-existing advisory:
8 travel-app tables have RLS disabled — unrelated to this repo.)

## Verification evidence

### Automated suites — 66 passing

```
behavior suite backend: pglite (hermetic, real migrations + RLS)

 ✓ tests/crud.test.ts (26 tests) 16785ms
 ✓ tests/model.test.ts (24 tests) 25ms
 ✓ tests/schema.test.ts (16 tests) 12725ms

 Test Files  3 passed (3)
      Tests  66 passed (66)
```

Coverage map against the test contract: canonical schema/constraints ✓ ·
RLS + cross-user isolation ✓ · archive/restore ✓ · hierarchy/persistence ✓ ·
truth/privacy gates + PRIVATE exclusion ✓ · sanitization approval ✓ · grader
rubric + director threshold + ceilings ✓ · archetype approval + JD retention ✓
· comparator output ✓ · asset blocking/collections ✓ · visa dependencies +
market-motion gating ✓ · weekly workflows ✓ · maturity calculation + logged
override ✓ · P1 lock behavior ✓ · offers Gate-7 acceptance block ✓ ·
reference willingness enforcement ✓ · quick-log defaults ✓ · no product
delete/export/PDF/LinkedIn-automation code ✓ · spoofed user_id ✓.

### Build

`next build` clean — 27 routes.

### Visual proof

22 desktop + mobile screenshots of every principal surface in
`docs/validation/` with a deterministic realistic dataset; reviewed for
clipping, overflow, semantic-color correctness (truth = blue spectrum,
privacy = green/amber/red, lifecycle = opacity/dashed), flat background, no
decorative color. See `docs/validation/README.md`.

### Real integration (no interception)

`scripts/integration-live.mjs` + `integration.yml` — full real-browser flow
against the live project. **Gated on GitHub Secrets the owner must add**
(the build environment can neither write GitHub secrets nor reach
supabase.co through its egress policy). Fails closed until then; the run
link becomes the final evidence once dispatched.

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
