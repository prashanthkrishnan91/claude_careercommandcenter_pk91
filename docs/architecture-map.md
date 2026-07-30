# Architecture map & truth-state

The authoritative document chain is committed verbatim under `docs/architecture/`
(v2.1 architecture → v2.1.1 amendments + v2.2 design → v2.2.1 schema amendment →
v2.2.2 errata; v1 and v2 included as lineage — v2 §5–§8 remain normative where
v2.1 references them). This build implements the complete locked P0 + P1 product
in one PR, superseding the original slice-by-slice rollout **by explicit owner
instruction**; the architecture content itself is unchanged.

## Section truth-state (per v2.1 §16 deliverable 3)

| Architecture area | Source | State | Where implemented |
|---|---|---|---|
| Canonical P0A entities (projects/achievements/metrics/evidence) | v2.1 §3 + v2.1.1 A1–A3 | **STABLE** | `supabase/migrations/20260730000100`, `lib/types.ts`, `lib/repos.ts`, Vault |
| Truth policy (6 statuses × 3 privacy classes, enforcement) | v2.1 §4 | **STABLE** | `lib/aiSafety.ts`, DB checks, AI routes |
| Sanitized Claim Builder | v2.1 §5 | **STABLE** | achievement detail workspace, `sanitized_claims` + approval constraint |
| Career Asset Versioning | v2.1 §6 | **STABLE** | `asset_versions`, asset detail page |
| Asset Collections | v2.1 §7 | **STABLE** | `asset_collections` + one-current index |
| Target Archetypes (manual + JD-derived) | v2.1 §8 + A7 | **STABLE** | archetypes pages, extract route, purge dates, pin/unpin |
| Achievement Grader (visible rubric, Ownership floor) | v2.1 §9 + A6 | **STABLE** | `lib/grader.ts`, `/api/ai/grade`, detail page panel |
| Privacy & data boundary | v2 §5 / v2.1 §10 | **STABLE** | PRIVATE firewall in `lib/aiSafety.ts`, ai_outputs audit |
| Visa Decision Checklist (8 gates) | v2 §6 / v2.1 §11 | **STABLE** | `lib/visa.ts`, `/decisions/visa`, Gate-7 DB trigger |
| LinkedIn-safe ingestion (manual paste-in) | v2 §7 / v2.1 §12 | **STABLE** | contacts paste-in; hard prohibitions honored (no automation) |
| Background ingestion (real Google OAuth) | v2 §8 / v2.1 §13 | **STABLE (externally unconfigured)** | `/api/google/*`, encrypted tokens, revocation; needs GOOGLE_* env |
| Weekly Operating Loop + market motion | v2.1 §14 + A5 | **STABLE** | `lib/rhythm.ts`, `/rhythm`, logged overrides |
| Maturity Gates | v2.1 §15 | **STABLE** | `lib/maturity.ts`, `/career` lock, logged dev override |
| P1 distribution entities | v2 §3 (P1) | **STABLE** | migration 2, `/career` |
| Offer Workbench (Gate-7 integration) | v2.2.1 §3 | **STABLE** | `/decisions/offers`, DB acceptance trigger |
| Skill Development Plans | v2.2.1 §4 | **STABLE** | `/development`, stale-plan surfacing in Rhythm |
| References overlay | v2.2.1 §5 | **STABLE** | `/development`, willingness DB constraint |
| Experience layer (cockpit, quick log, empty states, keys) | v2.2 | **STABLE** | shell, QuickLogBar, verbatim §6 empty states |
| P0A Settings narrowing / export deferral / footer omission | v2.2.2 C1–C2 | **STABLE** | Settings page (no export, no audit UI, footer omitted) |
| P2 (voice, mock interviews, competitive intel, native mobile, LinkedIn automation) | v2 §2 | **DEFERRED** | absent by design |
| PDF rendering / file uploads / source documents | v2.1 §2, §18 | **DEFERRED** | absent by design |

## Navigation map

Home (command view) · Vault (employer → project → achievement hierarchy) ·
Pipeline (drafts / recent 20 / archived + restore) · Intelligence (grader audit,
archetypes + comparator, assets + collections, story bank) · Rhythm
(Friday/Sunday/Monthly/Quarterly + gated action queue) · Career (P1 distribution,
maturity-locked) · Decisions (visa, offers, benchmarks) · Development (skills,
plans, references) · Settings.
