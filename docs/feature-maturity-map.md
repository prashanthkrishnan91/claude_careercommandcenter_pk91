# Feature & maturity-gate map

## Implementation status legend

- **validated** — implemented and exercised by the automated suites in this repo
- **externally unconfigured** — implemented; needs a user credential to operate (honest unavailable state until then)
- **maturity-gated** — implemented; product behavior locks it until the gates are met (or the logged owner override)
- **usage-dependent** — computed from real stored data; cannot be truthfully satisfied without real weeks of use

## Features

| Feature | Status |
|---|---|
| Evidence foundation (4 entities, hierarchy, quick log, pipeline, filters, inline autosave, shortcuts, mobile capture) | validated |
| Truth/privacy gating + blocking reasons + PRIVATE firewall | validated (hermetic + unit) |
| Sanitized Claim Builder (manual/template/guided, approval, provenance) | validated |
| Achievement Grader (7 dimensions, rationale, ceilings, disputes, director-signal) | logic validated; model calls **externally unconfigured** (`ANTHROPIC_API_KEY`) |
| Archetypes + JD sources + 90-day retention + comparator + gap reports | validated (extraction route externally unconfigured) |
| Career assets: source-graph gating, versions (atomic chain, DB triggers), approval + lifecycle revalidation, staleness, external-use log, collections (one-current, approved-only membership) | validated |
| Story bank | validated |
| Visa Checklist (8 gates, attorney constraints, do-not-act) | validated |
| Weekly OS (Friday/Sunday/Monthly/Quarterly, top-5 → top-3, market motion, logged overrides) | validated |
| Maturity gates computation (database RPC `ccc_recompute_maturity`) + Career lock | validated |
| Companies/contacts/outreach/referrals/applications/interviews/benchmarks | validated; **maturity-gated at the database** (RLS write policies check `ccc_p1_unlocked`; override-era mutations audited to `override_mutations`) |
| Offer Workbench + Gate-7 acceptance block + scenarios + counters | validated (DB trigger tested) |
| Skills, skill evidence, development plans + progress + stale detection | validated |
| References overlay (willingness enforcement, do-not-ask permanence, re-brief surfacing) | validated (DB constraint tested) |
| Gmail/Calendar OAuth ingestion (encrypted tokens, idempotent sync, revocation) | **externally unconfigured** (`GOOGLE_*`) |

## Maturity gates (v2.1 §15 — all usage-dependent)

4 consecutive Friday Captures · 4 Sunday Reviews with top-3 selected · 1 Monthly
Board · 15+ achievements · 10+ graded · 5+ director-signal · 5+ approved
sanitized claims · 2+ approved archetypes (≥1 JD-derived) · approved resume
bullet per archetype · approved Leadership/Scope-Scale STAR story · approved
current collection · zero NEEDS_PROOF in approved versions · zero PRIVATE in
external-use logs.

The AUTHORITATIVE computation lives in the database
(`ccc_recompute_maturity`, SECURITY DEFINER — justified because it writes the
client-read-only `maturity_state`): director-signal from the LATEST active
evaluation per achievement, explicit approvals required for STAR stories and
collections, archived rows excluded, hygiene checked over every source of
approved asset versions. `lib/maturity.ts` is a thin client over the RPC —
one implementation of the rules. P1 write policies check the persisted state
(or the logged override) INSIDE Postgres, so hidden UI is not the enforcement
mechanism. The override goes through `ccc_set_override` (reason mandatory,
every change logged to the client-read-only `owner_overrides`); P1 mutations
made while gates are unmet are additionally audited to `override_mutations`.
The suite verifies the locked state, direct-bypass rejection at RLS, and that
the override unlocks surfaces **without** marking criteria met. No
real-usage criterion is or can be fabricated by this build.
