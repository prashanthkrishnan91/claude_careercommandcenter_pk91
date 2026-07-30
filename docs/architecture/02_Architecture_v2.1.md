# Career Command Center — Architecture v2.1

**Author:** Prashanth
**Reviewers:** Claude (architect), ChatGPT (critic), Self
**Status:** Build-ready draft; first PR (P0A) authorized after this doc is locked
**Last updated:** June 2026
**Supersedes:** v2 (June 2026)

---

## 1. Product Thesis (Unchanged from v2)

Career Command Center is a **private career evidence engine**. It converts real work, relationships, target roles, and immigration timing into high-quality weekly actions and durable career assets.

It refuses to polish weak input. It surfaces only claims that are true, attributable, and useful. It blocks unsupported assertions from reaching resumes, interviews, or outreach.

**Core loop (unchanged):**
```
work evidence → achievement quality → seniority signal →
narrative asset → target-role match → action queue
```

---

## 2. Scope — P0 Sliced, P1, P2

### P0 — Evidence Foundation (sliced for implementation)

| Slice | Module | First-class entities introduced |
|-------|--------|--------------------------------|
| **P0A** | Schema + auth + manual evidence capture | projects, achievements, metrics, evidence_items |
| **P0B** | Truth & privacy enforcement primitives | truth_status, privacy_class fields fully active; sanitization gate |
| **P0C** | Achievement Grader with **visible rubric** | grader_score, grader_dimensions, grader_notes |
| **P0D** | Target Archetypes + JD paste + Comparator | target_archetypes, archetype_sources, gap_reports |
| **P0E** | Career Asset Generator + versioning + collections | career_assets, asset_versions, asset_collections |
| **P0F** | Visa Decision Checklist | visa_checklist_items, attorney_confirmations |
| **P0G** | Friday Capture / Sunday Review loop | weekly_briefs, action_items, market-motion engine |

Each slice ships as its own PR. P0B unlocks all downstream slices because no AI module may run before truth/privacy enforcement is in place.

### P1 — Distribution Layer (gated by Maturity Gates in §15)
Contacts, referrals, outreach, applications, interviews, comp benchmarks, companies, LinkedIn paste-in flows, real Google OAuth for Gmail/Calendar ingestion.

### P2 — Optimization
Voice capture, AI mock interviews, multi-archetype variants, competitive intel, mobile UX polish.

### Explicitly deferred from P0
- File uploads / source document storage (deferred to P0H or later — start with manual structured capture)
- LinkedIn automation of any kind
- Voice / OCR / extraction pipelines
- PDF rendering

---

## 3. Canonical Schema (v2.1)

### P0A Entities (first PR — no AI, no uploads)

```sql
projects (
  id, name, employer, role_at_time, start_date, end_date,
  description, business_context, my_scope, team_size, stakeholders[],
  privacy_class, created_at, updated_at
)

achievements (
  id, project_fk, headline, narrative, action_taken, outcome,
  start_date, end_date, claimed_seniority_level[ic|sr|mgr|sr_mgr|dir],
  truth_status,                  -- see §4 (P0B activates enforcement)
  privacy_class,                 -- see §4
  has_metric_bool,
  approved_for_external_bool,    -- user gate, defaults false
  created_at, updated_at
)

metrics (
  id, achievement_fk, metric_name, value, unit, time_period,
  baseline_value, calculation_notes,
  truth_status, privacy_class,
  created_at
)

evidence_items (
  id, achievement_fk,
  type[link|email_ref|note|testimonial|metric_source],
  content_summary, external_url,
  privacy_class,
  verified_at, verified_by[self|peer|manager|document],
  created_at
)
```

### P0B+ Entities (added in subsequent slices)

```sql
-- P0B: sanitization
sanitized_claims (
  id, source_achievement_fk, source_metric_fk,
  raw_private_text,              -- never sent to external AI
  sanitized_public_text,
  sanitization_method[manual|template|guided],
  user_approved_at,
  privacy_class                  -- output class, always public_safe when approved
)

-- P0C: grader
grader_evaluations (
  id, achievement_fk, evaluated_at, model_used,
  dimensions[json],              -- see §9 for rubric
  total_score, written_rationale,
  rubric_version
)

-- P0D: archetypes
target_archetypes (
  id, name, source_type[user_defined|jd_derived|hybrid],
  required_skills[json], expected_scope[json], expected_metrics[json],
  seniority_signals[json], comp_band_low, comp_band_high,
  visa_friendliness_score,
  approved_by_user_bool, created_at
)

archetype_sources (
  id, archetype_fk, source_type[pasted_jd|company_page|user_note],
  raw_content, parsed_summary, used_in_archetype_bool
)

gap_reports (
  id, archetype_fk, generated_at,
  covered_dimensions[json], gap_dimensions[json],
  recommended_actions[json]
)

-- P0E: assets, versioning, collections
career_assets (
  id, asset_type[resume_bullet|story|li_post|cover_letter|positioning|interview_answer],
  current_version_fk, source_achievement_refs[], source_evidence_refs[],
  truth_status_summary, privacy_class,
  used_externally_bool, external_use_log[json],
  created_at
)

asset_versions (
  id, asset_fk, version_number, content,
  generated_by_model, generation_prompt_hash,
  blocked_bool, block_reason,
  approved_by_user_bool, approved_at,
  superseded_by_fk, created_at
)

asset_collections (
  id, name, collection_type[resume_version|interview_pack|li_profile_draft|promotion_packet],
  asset_refs[], target_archetype_fk,
  notes, current_bool, created_at
)

-- P0F: visa
visa_checklist_items (
  id, state_name, ordinal, status, assumptions[json], risks[json],
  required_documents[], attorney_confirmation_required_bool,
  attorney_confirmed_at, attorney_confirmation_doc_ref,
  do_not_act_until_confirmed_bool, notes
)

-- P0G: weekly loop
weekly_briefs (
  id, week_of, brief_type[friday_capture|sunday_review|monthly_board|quarterly_narrative],
  content_markdown, market_motion_action_fk,
  generated_at, reviewed_at
)

action_items (
  id, week_of, priority_rank, title, rationale,
  category[evidence|asset|archetype|outward|visa|other],
  outward_facing_bool,            -- §14 requirement
  visa_gate_required_minimum,    -- §14 state-awareness
  status, completed_at
)

-- Cross-cutting
ai_outputs (
  id, output_type, model_used, input_refs[],
  output_text, truth_classifications[json],
  blocked_bool, block_reason, created_at
)
```

---

## 4. AI Truth Policy (Refined)

**Two orthogonal axes. Truth status is now finer-grained.**

### Axis A: Truth Status

| Status | Definition | Eligible for external asset? |
|--------|------------|------------------------------|
| **VERIFIED** | Backed by ≥1 evidence_item with documented source (link, email, doc reference, dashboard) | Yes |
| **ATTESTED_WITH_METRIC** | User-confirmed AND carries a concrete metric (value + unit + time period), but no document attached yet | Yes, with user approval + acknowledgment |
| **ATTESTED_NO_METRIC** | User-confirmed but no quantification | Yes only with explicit user override per asset; downgrades grader score |
| **INFERRED** | AI-derived from context; not yet user-confirmed | No — must be promoted to ATTESTED_* or VERIFIED |
| **NEEDS_PROOF** | Claim exists but lacks evidence; flagged as gap | No — blocks generation |
| **DISPUTED** | Conflicting evidence items | No — requires resolution |

### Axis B: Privacy Class

| Class | Definition | External use? |
|-------|------------|---------------|
| **PUBLIC_SAFE** | Generic enough to share externally (LinkedIn, resume, interview) | Yes |
| **INTERNAL_ONLY** | Usable for personal prep and practice; not external | No |
| **PRIVATE** | Confidential (employer-sensitive, NDA-bound, identifying numbers) | Never |

### Enforcement Rules

1. **External asset generation requires:** `truth_status ∈ {VERIFIED, ATTESTED_WITH_METRIC, ATTESTED_NO_METRIC} AND privacy_class = PUBLIC_SAFE`. ATTESTED_NO_METRIC requires explicit per-asset override.
2. **No PRIVATE content** is sent verbatim to any external LLM. Route through Sanitized Claim Builder (§5) first.
3. **Defaults at creation:** new achievements → `truth_status = NEEDS_PROOF`, `privacy_class = INTERNAL_ONLY`. User must promote both deliberately.
4. **Every ai_outputs record** stores model, input refs, classifications of inputs, block status, and reason.
5. **Achievement Grader treats** ATTESTED_NO_METRIC at a lower ceiling than ATTESTED_WITH_METRIC across the quantified-impact and evidence-quality dimensions.

---

## 5. Sanitized Claim Builder (New)

The single most important workflow for protecting employer confidentiality while preserving career value.

### Pipeline
```
PRIVATE fact
   ↓ user-driven sanitization (no AI on raw private text)
de-identified claim (PUBLIC_SAFE)
   ↓ Asset Generator
external-grade career asset
```

### UI Flow
1. User logs a PRIVATE achievement with raw confidential context.
2. App surfaces a **Sanitization Workspace** with the original text on the left and a sanitized draft on the right.
3. App offers templates (e.g., "replace specific revenue with order-of-magnitude band", "replace customer count with size descriptor", "drop product name, keep function").
4. User edits and approves the sanitized version.
5. Approved `sanitized_claim` becomes `PUBLIC_SAFE` and is the only version downstream AI can see.
6. Original `raw_private_text` remains in storage, encrypted, never leaves the database.

### Rules
- Sanitization is **always user-driven**. AI may suggest templates but never auto-rewrite raw PRIVATE text.
- Sanitized claims carry provenance back to their source achievement, but the source's raw text is firewalled from any LLM payload.
- A PRIVATE achievement with no sanitized claim cannot contribute to any external asset.
- Sanitization quality is itself a tracked metric: how many PRIVATE achievements have been successfully sanitized into PUBLIC_SAFE claims.

---

## 6. Career Asset Versioning (New)

Every generated asset (`career_assets`) has a chain of `asset_versions`. Versioning rules:

1. **Immutable history.** Versions are append-only. Edits create a new version with `superseded_by_fk` linkage back.
2. **Approval gating.** Only `approved_by_user_bool = true` versions can be placed in a Collection or marked `used_externally_bool`.
3. **External use logging.** Each time a version is used externally (sent in an application, posted to LinkedIn, etc.), log to `external_use_log` with timestamp and destination. This prevents conflicting versions of the same bullet appearing in different applications.
4. **Provenance.** Every version stores the prompt hash, model used, and input refs. Reproducible.
5. **Cross-collection consistency.** When a resume is duplicated for a different target archetype, the asset is *forked* into a new version branch — the user explicitly authors a variant rather than silently divergence.

---

## 7. Asset Collections (New)

Packaged groups of approved assets used as a unit.

### Collection types
- **resume_version** — tailored to one or more archetypes
- **interview_pack** — story_bank entries + positioning + key bullets for an upcoming loop
- **li_profile_draft** — headline, about, experience bullets
- **promotion_packet** — for internal use (if it ever becomes relevant), an evidence-backed case

### Rules
- A collection contains only approved asset versions.
- A collection has a `current_bool` flag — exactly one resume_version, one li_profile_draft can be current at a time.
- Collections do not render PDFs. Export is markdown / structured text only; final formatting happens externally.

---

## 8. Target Archetypes — Manual + JD-Derived

### Bootstrap Path

1. User pastes 5–10 representative JDs for the target role (e.g., "Director, Analytics" at various tier-1 companies).
2. AI extracts: required skills, expected scope, common metrics, seniority signals, comp band.
3. Each pasted JD becomes an `archetype_sources` record.
4. AI proposes an aggregated `target_archetype` profile.
5. **User reviews and approves** before the archetype becomes active. No archetype is used by the Comparator without `approved_by_user_bool = true`.

### Per-Archetype Lifecycle
- Active archetypes generate gap_reports when the Comparator runs.
- Archetypes carry a `visa_friendliness_score` derived from public sponsorship history of source companies.
- Archetypes can be re-tiered or retired in Monthly Board Review.

### User-Defined Archetypes
User may author an archetype from scratch (no JD source) — useful for hypothetical targets. These are flagged `source_type = user_defined`.

---

## 9. Achievement Grader Rubric (Visible)

**Scoring is transparent. The rubric is visible to the user with per-dimension explanations.**

### Dimensions (each scored 1–5)

| Dimension | What it measures |
|-----------|------------------|
| **Quantified business impact** | Magnitude + clarity of measurable outcome (revenue, retention, cost, time, etc.) |
| **Scope / scale** | Size of team, budget, audience, system, or customer base affected |
| **Ownership** | Were you the driver, contributor, or supporter? Distinguished from team credit. |
| **Cross-functional influence** | Did this require leading or aligning across functions, levels, or organizations? |
| **Strategic ambiguity** | Was the problem well-defined, or did you have to frame it from scratch? |
| **Technical / analytical difficulty** | Sophistication of methods, novelty of approach, depth of analysis |
| **Evidence quality** | Strength and verifiability of supporting evidence_items |

### Total Score
- Weighted sum (weights configurable in app settings; default equal weighting).
- Written rationale per dimension is always generated and stored.
- User can challenge a dimensional score, which logs a `disputed` flag for grader review.

### Director-level threshold
- An achievement is considered "director-signal" when it scores ≥4 on at least 4 of the 7 dimensions, including **Cross-functional influence** and **Scope/scale** as mandatory.

### Why visible
- Transparency drives the user's own development (they learn what director-level looks like).
- Prevents AI overconfidence; user can audit individual dimension scores.
- Enables targeted action items ("you need one more achievement that scores ≥4 on Strategic Ambiguity").

---

## 10. Privacy & Data Boundary Policy

(Unchanged from v2 §5. Summary: PRIVATE never sent verbatim to LLMs; Sanitized Claim Builder is the bridge; quarterly purge of stale items; single-user; no work-issued device.)

---

## 11. Visa Decision Checklist Model

(Unchanged from v2 §6. Summary: 8-gate checklist replacing single "safe date"; attorney confirmation required at Gates 6 and 7; "do not act until confirmed" flag gates dependent actions in the app.)

---

## 12. LinkedIn-Safe Ingestion Strategy

(Unchanged from v2 §7. Summary: manual paste-in primary; real Google OAuth for Gmail email parsing in P1; Claude in Chrome assist-only on demand; no scheduled sweeps.)

---

## 13. Background Ingestion Architecture

(Unchanged from v2 §8. Summary: real Google OAuth with `gmail.readonly` / `calendar.readonly` scopes, encrypted refresh tokens, idempotent scheduled runs, one-click revocation.)

---

## 14. Weekly Operating Loop (Updated)

### Friday Capture (15 min, end of workday)
- App prompts: "What did you accomplish this week worth capturing?"
- User logs 1–5 achievements with project link, claimed outcome, and (where available) metric and evidence.
- Truth status defaults to NEEDS_PROOF; user promotes deliberately.
- Overnight: Achievement Grader runs on new entries.

### Sunday Review (30 min)
Brief includes:
1. This week's graded achievements with rubric scores
2. Gaps surfaced by Target Role Comparator
3. Visa Checklist deltas
4. Asset version drift (any assets used externally diverging from current approved versions)
5. **Top 5 candidate actions** drawn from gaps, stale items, and the market-motion engine

User picks **top 3 actions** for the upcoming week.

#### Market-Motion Requirement (State-Aware)

**At least one action per Sunday Review must be outward-facing.** The menu of "outward" actions is gated by Visa Checklist state:

| Visa Gates Status | Permitted Outward Actions |
|-------------------|---------------------------|
| Gates 1–4 incomplete | Public LinkedIn content (brand-building, not job-shopping); archetype research from public JDs; story-bank refinement against archetypes; resume version updates; comp benchmark research from public sources |
| Gate 5 complete (180-day window cleared) | All of the above + light referral preparation (no asks yet); identify warm contacts at target companies |
| Gate 6 complete (attorney portability sign-off) | All of the above + warm outreach for informational conversations; explicit referral requests |
| Gate 7 complete (employer commitment) | Full active job search; formal applications; interview prep |

**This gating is enforced in the app.** Sunday Review cannot surface "reach out to recruiter at Company X" as an action while Gates 1–4 are pending. The user can always override, but the override is logged.

### Monthly Board Review (60 min, last Sunday of month)
- Evidence trajectory: are quantified achievements compounding month-over-month?
- Archetype coverage scorecard
- Asset Collection currency check
- Visa state assessment
- Decision: add, retire, or re-tier archetypes; rebalance Friday Capture focus

### Quarterly Narrative Review (90 min)
- Positioning statement accuracy check
- Differentiator audit
- Story bank rebalancing
- Skill development plan adjustments

---

## 15. Maturity Gates (Replacing 8-Week Calendar Gate)

P1 unlocks **only when all of the following are simultaneously true**, not on a calendar:

### Minimum usage discipline
- [ ] 4+ consecutive Friday Captures completed
- [ ] 4+ Sunday Reviews completed with top-3 actions picked
- [ ] 1+ Monthly Board Review completed

### Minimum evidence base
- [ ] 15+ achievements logged
- [ ] 10+ achievements graded by P0C
- [ ] 5+ achievements scoring ≥4 on at least 4 rubric dimensions (director-signal achievements)
- [ ] 5+ approved sanitized claims (PRIVATE → PUBLIC_SAFE pipeline exercised)

### Minimum archetype + asset readiness
- [ ] 2+ target archetypes approved (at least 1 JD-derived)
- [ ] 1+ approved resume bullet per archetype
- [ ] 1+ approved STAR story covering Leadership OR Scope/Scale theme
- [ ] 1+ approved Asset Collection (resume_version OR interview_pack)

### Minimum truth/privacy hygiene
- [ ] Zero NEEDS_PROOF content in any approved asset version
- [ ] Zero PRIVATE content present in any external_use_log entry

**Rationale:** calendar gates produce theater; output gates produce readiness. If these criteria take 6 weeks, P1 unlocks at 6 weeks. If they take 14, P1 unlocks at 14. The system enforces discipline through outputs, not time.

---

## 16. First PR Contract — P0A Only

**This is the contract for the first implementation PR. The Claude Code browser session opens exactly one PR and stops.**

### Scope (in)
- Supabase project provisioned
- Schema migration for P0A tables only: `projects`, `achievements`, `metrics`, `evidence_items`
- All P0A tables include `truth_status` and `privacy_class` columns (enums defined, defaults set, but **enforcement logic deferred to P0B**)
- Supabase Auth wired up (single-user, email/password or magic link)
- Next.js app on Vercel with:
  - Auth gate
  - Vault list view (projects → achievements drill-down)
  - Vault detail view per achievement (metrics, evidence_items)
  - Manual entry forms for project / achievement / metric / evidence_item
  - Truth/privacy fields visible and editable in UI
- Row-level security in Supabase scoping all data to the authenticated user
- Mobile-responsive layout (no native mobile app)

### Scope (out — explicitly not in this PR)
- No AI of any kind
- No file uploads / source documents
- No Gmail / Google OAuth
- No LinkedIn integration of any kind
- No Visa Decision Checklist UI (schema for it not yet migrated)
- No Sunday Brief / Friday Capture flows
- No Achievement Grader
- No Career Asset Generator
- No Target Archetypes
- No Sanitized Claim Builder
- No PDF rendering

### PR Deliverables (all required before review)

1. **PR body must include:**
   - Summary of scope (matching above)
   - List of tables created with column definitions
   - List of routes/pages added
   - Screenshots or screen recording of the four manual entry forms working end-to-end
   - Confirmation that no out-of-scope code is included

2. **Usage ledger:**
   - Total Claude/Anthropic API tokens consumed during build
   - Approximate cost
   - Tool invocations summary
   - Logged in `/docs/usage-ledger.md`

3. **Docs truth-state:**
   - `/docs/architecture-v2.1.md` committed (this document)
   - Each section in the doc tagged with a state: `STABLE`, `IN_PROGRESS`, or `DEFERRED`
   - For P0A PR: §3 (P0A entities only), §16 marked STABLE; everything else DEFERRED

4. **Tests:**
   - Migration runs cleanly on a fresh Supabase project
   - Unit tests for any validation logic (e.g., date constraints, enum defaults)
   - At least one integration test: authenticated user creates a project, adds an achievement, adds a metric, adds an evidence_item, retrieves it via the vault detail view

5. **Validation evidence:**
   - Test data created during local validation: 1 project, 2 achievements, 2 metrics, 2 evidence_items
   - Screenshot of vault list and vault detail showing the data
   - Confirmation that truth_status and privacy_class defaults are applied correctly (NEEDS_PROOF, INTERNAL_ONLY)
   - Confirmation that no AI calls, no external API calls (other than Supabase), and no third-party integrations are present in the codebase

### Acceptance
- Reviewer (user + ChatGPT review of diff) confirms PR matches contract exactly.
- No additional features added before review.
- After merge: P0A is live; P0B PR is authored next, **not before this is merged and the four manual entry flows are used in real life for at least one week**.

---

## 17. Full P0 Acceptance Criteria (Across All Slices)

P0 is complete (and Maturity Gates §15 can begin counting) only when:

- All P0A–P0G slices merged and live
- Truth policy enforcement demonstrably blocks non-compliant generations
- Privacy enforcement demonstrably prevents PRIVATE content from reaching external assets
- Sanitized Claim Builder used successfully on ≥3 real PRIVATE achievements
- Achievement Grader generates rubric-aligned scores with written rationale
- Target Archetype Comparator runs against ≥2 approved archetypes
- Career Asset Generator produces ≥1 approved bullet and ≥1 approved story
- Asset Versioning is functional (creating a new version, marking superseded, logging external use)
- At least 1 Asset Collection created and marked current
- Visa Decision Checklist displays all 8 gates with current status
- Friday Capture / Sunday Review loop is operational with market-motion engine enforcing Visa-state gating

---

## 18. Explicit Non-Goals

(Unchanged from v2 §11. Plus:)
- No raw file uploads or source document storage in P0
- No PDF rendering at any phase
- No auto-rewriting of raw PRIVATE text by AI under any circumstance
- No opaque AI scoring; all grader output must be dimensionally transparent

---

## 19. Open Questions for Round 3 Review

1. Is the P0A scope tight enough? Or should auth itself be its own pre-P0A PR?
2. The market-motion gating by Visa state (§14) is conservative. Is the action menu at Gates 1–4 sufficiently meaningful, or does it risk feeling like busywork during a long quiet stretch?
3. Should ATTESTED_NO_METRIC be blocked from external assets entirely (stricter), or kept with explicit override (current design)?
4. Sanitized Claim Builder is user-driven by design. Is there a safe middle ground where AI can suggest a sanitization template based on patterns without seeing the raw PRIVATE text?
5. Asset Versioning's "external use log" — is this realistic to maintain manually? If the user posts a version to LinkedIn or sends it in an application, will they actually log it?
6. The Director-Signal threshold (≥4 on ≥4 dimensions including Cross-functional + Scope/Scale) — is this calibrated correctly for tier-1 multinational expectations?
7. Should archetype_sources retain the raw pasted JD indefinitely, or expire after the archetype is approved?
8. Maturity Gates require "1 Monthly Board Review completed" — should this be 2 to confirm the monthly cadence is real rather than a one-shot?
9. P0 still does not include file uploads. Is the manual-entry burden during the evidence-backfill phase tolerable, or does it kill momentum?
10. Single biggest weakness of v2.1 that v2 didn't have?

---

## 20. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Jun 2026 | v2 superseded by v2.1 | P0 too broad to build; needed slicing |
| Jun 2026 | File uploads deferred out of P0 | Structured manual entry simpler; defer OCR/parse until vault proves useful |
| Jun 2026 | Sanitized Claim Builder added | Bridges PRIVATE → PUBLIC_SAFE without exposing raw confidential text to LLMs |
| Jun 2026 | ATTESTED split into WITH_METRIC / NO_METRIC | Reflects meaningful difference in claim strength for grader and generator |
| Jun 2026 | Career Asset Versioning added | Traceability across resume iterations and external use |
| Jun 2026 | Asset Collections added | Packaged use (resume version, interview pack) without PDF rendering scope creep |
| Jun 2026 | Archetypes support JD-derived path | Bootstrap from real market signal, not user imagination |
| Jun 2026 | Grader rubric made visible with 7 dimensions | Transparency drives learning; prevents AI overconfidence |
| Jun 2026 | 8-week calendar gate replaced with Maturity Gates | Output-based readiness, not theater |
| Jun 2026 | Sunday Review market-motion requirement added, gated by Visa state | Prevents inward-only drift while respecting visa risk |
| Jun 2026 | First PR contract for P0A locked | Forces discipline; one PR, one slice, stop |

---

*This document is the build-ready architecture for Career Command Center. Round 3 review by ChatGPT is the last gate before the P0A PR is authored. No code is written until this document is locked.*
