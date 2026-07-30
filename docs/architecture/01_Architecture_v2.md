# Career Command Center — Revised Architecture (v2)

**Author:** Prashanth
**Reviewers:** Claude (architect), ChatGPT (critic), Self
**Status:** Revised draft, supersedes v1
**Last updated:** June 2026

---

## 1. Product Thesis

**Career Command Center is a private career evidence engine.** It converts real work, relationships, target roles, and immigration timing into high-quality weekly actions and durable career assets.

It refuses to polish weak input. It surfaces only claims that are true, attributable, and useful. It blocks unsupported assertions from reaching resumes, interviews, or outreach. It treats career advancement as a problem of evidence quality, not activity volume.

**Core loop:**
```
work evidence → achievement quality → seniority signal →
narrative asset → target-role match → action queue
```

**What changed from v1:** The previous architecture optimized for pipeline motion (outreach, posts, sweeps). That is downstream work. A director-level jump at a tier-1 multinational is won on documented, quantified, defensible impact. Distribution amplifies substance; it cannot replace it. v2 makes evidence primary, distribution secondary.

---

## 2. Scope (P0 / P1 / P2)

### P0 — Evidence Foundation (Build first, ship before adding anything)

| Module | Purpose |
|--------|---------|
| **Source Document Intake** | Upload, classify, and structure raw inputs (perf reviews, project docs, dashboards, emails) with privacy class assigned at ingest |
| **Career Evidence Vault** | Projects → Achievements → Evidence Items → Metrics, with provenance trail |
| **Achievement Grader** | Scores each achievement on seniority signal, quantification, defensibility, archetype-fit |
| **Target Role Comparator** | Gap analysis between vault and target archetypes; surfaces what's missing |
| **Career Asset Generator** | Produces resume bullets, LinkedIn content, interview stories — grounded only in VERIFIED/ATTESTED + PUBLIC_SAFE content |
| **Visa Decision Checklist** | Multi-gate state model with attorney confirmation requirements; replaces deterministic "safe jump date" |
| **Weekly Action Queue** | Friday Capture + Sunday Review + Monthly Board Review |

### P1 — Distribution Layer (After 8+ weeks of P0 usage)
- Contacts, referrals, outreach tracking
- Application & interview tracking with debrief structuring
- Comp benchmark tracking
- LinkedIn assist (manual paste-in flows; Claude in Chrome as on-demand helper only)
- Companies & target list management

### P2 — Optimization & Convenience
- Voice quick-capture
- AI mock interviewing against story bank
- Multi-archetype narrative variants
- Competitive intelligence on target functions
- Mobile UX polish

**Explicitly NOT in P0:** LinkedIn automation, browser sweeps, voice capture, competitive intel, multi-archetype narratives, application submission, mock interviews.

---

## 3. Canonical Schema (Revised — Lock Before Code)

### P0 Entities

```sql
-- Raw inputs
source_documents (
  id, filename, doc_type[perf_review|project_doc|dashboard|email|other],
  privacy_class[public_safe|internal_only|private],
  uploaded_at, storage_uri, extracted_text, processed_bool,
  source_period_start, source_period_end, employer
)

-- Bodies of work
projects (
  id, name, employer, role_at_time, start_date, end_date,
  description, business_context, my_scope, team_size, stakeholders[],
  privacy_class, source_document_refs[]
)

-- Discrete outcomes within projects
achievements (
  id, project_fk, headline, narrative, action_taken, outcome,
  start_date, end_date, claimed_seniority_level[ic|sr|mgr|sr_mgr|dir],
  truth_status[verified|attested|inferred|needs_proof|disputed],
  privacy_class, grader_score, grader_notes, last_graded_at
)

-- Quantified impact
metrics (
  id, achievement_fk, metric_name, value, unit, time_period,
  baseline_value, source_evidence_fk, calculation_notes,
  truth_status
)

-- Proof artifacts
evidence_items (
  id, achievement_fk, type[document_ref|link|email_ref|screenshot|testimonial],
  source_document_fk, external_url, content_summary,
  privacy_class, verified_at, verified_by[self|peer|manager]
)

-- Skills taxonomy
skills (
  id, name, category[technical|domain|leadership|tooling],
  director_relevance_score
)

skill_evidence (
  id, skill_fk, achievement_fk, demonstration_strength_1_to_5
)

-- Target role profiles
target_archetypes (
  id, name[e.g., "Director, Analytics @ Tier-1 Tech"],
  required_skills[json], expected_scope[json],
  expected_metrics[json], comp_band_low, comp_band_high,
  representative_jds[],  visa_friendliness_score
)

-- Generated outputs
career_assets (
  id, asset_type[resume_bullet|li_post|story|cover_letter|positioning],
  content, source_achievement_refs[], source_evidence_refs[],
  truth_status_summary, privacy_class, generated_by_model,
  generation_prompt_hash, created_at, approved_by_user_bool,
  used_externally_bool
)

-- Interview-ready STAR stories
story_bank (
  id, theme[leadership|conflict|ambiguity|scale|metric_impact|...],
  situation, task, action, result,
  source_achievement_refs[], target_archetype_refs[],
  freshness_score, last_practiced_at
)

-- AI provenance
ai_outputs (
  id, output_type, model_used, input_refs[], output_text,
  truth_classifications[json], blocked_bool, block_reason,
  created_at
)

-- Weekly cadence
action_items (
  id, week_of, priority_rank, title, rationale,
  evidence_refs[], status, completed_at
)

weekly_briefs (
  id, week_of, brief_type[friday_capture|sunday_review|monthly_board],
  content_markdown, generated_at, reviewed_at
)

-- Visa state
visa_checklist_items (
  id, state_name, status[not_started|in_progress|complete|blocked],
  assumptions[json], risks[json], required_documents[],
  attorney_confirmed_at, attorney_confirmation_doc_ref,
  notes
)
```

### P1 Entities (defined now to avoid future refactor)

```sql
contacts (id, name, company_fk, role, source, last_touch, ...)
companies (id, name, tier, gc_sponsorship_history, ...)
outreach (id, contact_fk, channel, direction, ...)
referrals (id, contact_fk, role_fk, status, ...)
applications (id, role_fk, applied_at, channel, status, ...)
interviews (id, application_fk, round, debrief_ref, ...)
comp_benchmarks (id, archetype_fk, source, total_comp_low, total_comp_high, ...)
```

---

## 4. AI Truth Policy

**Two orthogonal axes, not one enum.** Every claim and every generated asset carries both.

### Axis A: Truth Status

| Status | Definition | Usable in external asset? |
|--------|------------|---------------------------|
| **VERIFIED** | Backed by ≥1 evidence_item with documented source (perf review, dashboard, email, project doc) | Yes |
| **ATTESTED** | User-confirmed in writing within the app, no document attached | Yes, with explicit acknowledgment |
| **INFERRED** | AI-generated from context; not yet user-confirmed | No — must be promoted to ATTESTED or VERIFIED first |
| **NEEDS_PROOF** | Claim exists but no evidence; flagged as gap | No — blocks generation |
| **DISPUTED** | Multiple conflicting evidence items | No — requires resolution |

### Axis B: Privacy Class

| Class | Definition | External use? |
|-------|------------|---------------|
| **PUBLIC_SAFE** | Generic enough to share publicly (LinkedIn, resume, interview) | Yes |
| **INTERNAL_ONLY** | Usable for personal prep/practice, not external sharing | No |
| **PRIVATE** | Confidential (employer-sensitive, NDA-bound, identifying numbers) | Never |

### Enforcement Rules

1. **Career assets** (resume bullets, LinkedIn drafts, stories) can be generated only from content that is `(VERIFIED OR ATTESTED) AND PUBLIC_SAFE`.
2. When generation is blocked, the app must surface *which* underlying claim failed and *what evidence* would unblock it.
3. Every `ai_outputs` record stores truth classifications of source inputs and reasons for any block.
4. Privacy class is set at ingest (Source Document Intake) and propagates to all derived achievements, metrics, and evidence items.
5. Truth status defaults to `NEEDS_PROOF` for any AI-extracted claim until user confirms or evidence is attached.

**This is the policy that prevents the app from becoming a confident-sounding hallucinator.**

---

## 5. Privacy & Data Boundary Policy

### Storage
- All source documents stored in Supabase Storage with server-side encryption.
- `privacy_class = PRIVATE` documents are stored separately and accessed via a dedicated service role.
- No DIRECTV-confidential numbers, customer data, or internal strategy enters the system at any classification level. (PRIVATE is for confidential-but-personal context, not for proprietary employer data.)

### AI Prompting
- PRIVATE content is never sent verbatim to external LLM APIs.
- For PRIVATE achievements, user manually enters de-identified versions for any AI processing (e.g., "improved retention by ~Xpp on a major segment" rather than the specific numbers).
- INTERNAL_ONLY content may be sent to AI but is excluded from generated external assets.
- All prompt payloads logged with truth and privacy classifications attached.

### Retention
- Source documents reviewed quarterly; stale or no-longer-needed PRIVATE items purged.
- AI output logs retained 90 days then archived.

### Access
- Single-user. No sharing. No collaborative features.
- Hard rule: no work-issued device touches this app. Personal account, personal device only.

---

## 6. Visa Decision Checklist Model

**The Visa Clock is replaced by a multi-gate checklist with explicit assumption and risk tracking.** The app never displays a single "safe to jump" date.

### Gates (in order)

| # | Gate | Current Status | Attorney Confirmation Required? |
|---|------|----------------|--------------------------------|
| 1 | PERM filed with priority date | Complete (Jan 30, 2026) | No |
| 2 | PERM approved | Pending | No |
| 3 | I-140 filed | Pending | No |
| 4 | I-140 approved | Pending | No |
| 5 | I-140 approval + 180 days elapsed (revocation window cleared) | Pending | No (date-based) |
| 6 | Portability strategy reviewed and confirmed by immigration attorney | Pending | **YES** |
| 7 | New employer's GC sponsorship and priority date retention commitment confirmed in writing | Pending | **YES** (attorney reviews offer terms) |
| 8 | H1B transfer approved at new employer | Pending | No (mechanical) |

### Per-Gate Metadata

Each gate carries:
- **Status:** not_started | in_progress | complete | blocked
- **Assumptions:** what must remain true for this gate to hold (e.g., "DIRECTV does not revoke I-140 within 180 days of approval")
- **Risks:** RFE, denial, employer revocation, attorney-flagged concerns, regulation changes
- **Required documents:** approval notices, attorney letters, offer letters
- **Attorney confirmation timestamp** (where applicable)
- **"Do not act until confirmed" flag** that gates dependent actions in the app

### Behavior

- The Weekly Action Queue cannot surface "begin active job search" actions until **Gate 5** completes.
- The app cannot surface "accept offer" actions until **Gates 6 AND 7** are both attorney-confirmed.
- Gate transitions trigger Monthly Board Review prompts to reassess strategy.
- All gate transitions logged with timestamps and supporting document refs.

### Out of Scope
- The app does not interpret immigration law.
- The app does not advise on RFE responses, denials, or category changes.
- Attorney consultations are scheduled and logged in the app, but conducted externally.

---

## 7. LinkedIn-Safe Ingestion Strategy

**System of record ingestion is manual and email-based. Claude in Chrome assists on-demand only, never as scheduled backbone.**

### Primary Ingestion (System of Record)

1. **Manual paste-in forms** for:
   - Post analytics (weekly, copy-paste from LinkedIn analytics tab)
   - Notable DM threads (paste when worth capturing)
   - New connections worth tracking (manual add with context)

2. **Gmail-based ingestion via real Google OAuth** (P1, not P0):
   - LinkedIn job alerts (parsed into roles)
   - LinkedIn weekly profile-view summary emails
   - Connection request notifications
   - Recruiter InMails forwarded to email
   - Full OAuth flow with explicit scopes, token storage, refresh, consent, and deletion implemented per Google's published requirements

3. **CSV import** for periodic LinkedIn data exports (monthly archive download — fully ToS-compliant)

### Secondary (Assist Only)

Claude in Chrome may be invoked **on-demand by the user**, per session, to:
- Extract structured JD data from a single company page the user has open
- Draft a DM into LinkedIn's compose window when the user initiates outreach

Claude in Chrome is **never** used for:
- Scheduled sweeps of any kind
- Bulk extraction of contacts, messages, or analytics
- Background or automated tasks while the user is away
- Anything that could trigger behavioral anomaly detection on the LinkedIn account

### Hard Prohibitions

- No third-party LinkedIn automation tools.
- No session cookie sharing.
- No scraping libraries.
- No browser extensions other than Claude in Chrome (and only in assist mode).

**Rationale:** during PERM/I-140 stabilization, the cost of a flagged or suspended LinkedIn account is materially higher than the value of automation convenience. This is a hard constraint until at least Gate 7 of the Visa Checklist completes.

---

## 8. Background Ingestion Architecture (Real, not MCP)

**Gmail MCP is a Claude-chat-side connector, not a production backend service.** For the app's background ingestion, implement real integrations:

### Google OAuth (P1)
- Standard OAuth 2.0 flow, user-initiated consent
- Scopes: `gmail.readonly` only; nothing broader
- Refresh tokens stored in Supabase with row-level security, encrypted at rest
- User-visible audit log of every ingestion run
- One-click revocation in app settings
- Deletion endpoint that purges tokens and ingested mail metadata on request

### Calendar (P1)
- Same OAuth pattern with `calendar.readonly`
- Interview events flagged; not used for any modification

### Scheduling
- Supabase Edge Functions or Vercel Cron for scheduled ingestion
- Idempotent runs with last-seen cursors
- Failures logged and surfaced in the Monthly Board Review

This is the right way. Do not ship without it.

---

## 9. Weekly Operating Loop

### Friday Capture (15 min, end of workday, Fridays)
- App prompts: "What did you accomplish this week worth capturing?"
- User logs 1–5 achievements while memory is fresh
- For each: project link, claimed outcome, link to evidence (or NEEDS_PROOF flag)
- Overnight: Achievement Grader scores each entry

### Sunday Review (30 min, Sundays)
- Brief includes:
  - This week's graded achievements with grader notes
  - Gaps surfaced by Target Role Comparator (what's still missing for archetypes you're targeting)
  - Visa Checklist deltas (any gate transitions or attorney follow-ups due)
  - Top 5 candidate actions for the week (drawn from gaps and stale items)
- User picks top 3 actions → Weekly Action Queue
- User reviews any AI-generated career assets pending approval

### Monthly Board Review (60 min, last Sunday of month)
- Career evidence trajectory: are quantified achievements compounding month-over-month?
- Archetype coverage scorecard: which target profiles are well-supported, which have evidence gaps?
- Asset readiness check: resume version current? Story bank covers anticipated interview themes?
- Visa state assessment: gate changes, attorney touchpoints needed
- Decision: any archetype to add, retire, or re-tier?

### Quarterly Narrative Review (90 min, end of quarter)
- Positioning statement still accurate?
- Differentiators still differentiating?
- Story bank rebalancing
- Skill development plan adjustments

---

## 10. Acceptance Criteria — Phase 1 (P0)

Phase 1 is complete only when **all** of the following are demonstrably true:

### Data
- [ ] All P0 schema tables deployed with constraints and indexes
- [ ] Source document upload works with privacy class assigned at ingest
- [ ] At least 15 real achievements logged with linked evidence_items
- [ ] At least 5 source documents (perf reviews, project docs) uploaded and classified
- [ ] At least 2 target_archetypes defined with required_skills and expected_metrics

### Truth Policy
- [ ] Truth status is set on every achievement, metric, and evidence_item
- [ ] Privacy class is set on every source_document and propagated to derived records
- [ ] Career Asset Generator demonstrably blocks output when source claim is NEEDS_PROOF or INFERRED
- [ ] Career Asset Generator demonstrably blocks PRIVATE content from external assets
- [ ] Every ai_outputs record stores model used, input refs, and truth classifications

### Functionality
- [ ] Achievement Grader produces a score + written rationale for each entry
- [ ] Target Role Comparator runs against ≥2 archetypes and outputs gap report
- [ ] Career Asset Generator can produce one resume bullet and one story from VERIFIED content end-to-end
- [ ] Visa Decision Checklist displays all 8 gates with current status, assumptions, and risks
- [ ] Friday Capture form works on mobile, routes inputs to correct tables
- [ ] Sunday Review brief generates and displays top 3 candidate actions

### Privacy & Safety
- [ ] PRIVATE content is never included verbatim in any AI prompt payload
- [ ] No DIRECTV-confidential data is present in any table
- [ ] No LinkedIn automation, scraping, or scheduled browser sweep is part of the system
- [ ] User can delete all data and revoke any future OAuth tokens with a single action

### Discipline
- [ ] User has completed at least 4 consecutive Friday Captures and Sunday Reviews before Phase 1 is declared "done"
- [ ] One Monthly Board Review has been run

**Hard rule: Phase 2 (P1) does not begin until Phase 1 has run for 8 consecutive weeks in real use.**

---

## 11. Explicit Non-Goals

The Career Command Center is **not**:
- A LinkedIn automation tool, scraper, or browser-sweep system
- A multi-user, family, or shared product
- A public-facing publishing platform
- A direct application submission system
- A resume PDF rendering engine (export to Word, finalize externally)
- A source of immigration legal advice or interpretation
- A real-time job board aggregator
- An AI mock-interviewing platform (P0)
- A voice transcription product (P0)
- A native mobile app (responsive web is sufficient)
- A competitive intelligence tool on individuals
- A storage location for any employer-confidential information at any classification

---

## 12. Stack Confirmation

No changes from existing workflow:
- **Supabase** (Postgres, Auth, Storage with encryption, Edge Functions)
- **Vercel** (Next.js, server actions, Cron)
- **GitHub** (direct-to-main per existing workflow)
- **Claude Code** (in browser, builds via PRs)
- **ChatGPT** (code review, second opinion, voice variation)
- **Claude API** (Sonnet 4.6+; Opus reserved for Monthly Board synthesis)
- **Claude in Chrome** (on-demand assist only, never scheduled)
- **Google OAuth** (P1, real integration with proper scopes)

---

## 13. Open Questions for ChatGPT Review (Round 2)

1. Is the Truth Policy enforcement model complete, or are there edge cases where INFERRED content should be permitted in assets with explicit caveats?
2. Should `target_archetypes` be defined by the user, sourced from real JDs, or both? What's the bootstrap path?
3. Is the 8-week post-P0 usage gate before P1 too rigid? Should specific P1 modules unlock based on P0 maturity metrics rather than calendar time?
4. The Visa Decision Checklist is intentionally conservative. Does it under-serve actionability? Is there a middle ground between "deterministic safe date" and "8-gate checklist"?
5. The privacy boundary is strict on DIRECTV content. Is the de-identification approach for AI prompting practical, or does it neuter the AI's usefulness on the most important achievements?
6. Should `career_assets` carry a versioning system so generated bullets are traceable across resume iterations?
7. Is the Friday Capture frequency right? Daily would yield more data but risks fatigue.
8. What's the single biggest weakness of v2 that v1 didn't have? (Honest pushback requested.)
9. Should the Achievement Grader expose its rubric to the user, or remain opaque? Transparency helps learning; opacity prevents gaming.
10. Is anything in P1 actually mis-classified and belongs in P0?

---

## 14. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Jun 2026 | v1 superseded | Pipeline-centered architecture was wrong; evidence must come first |
| Jun 2026 | LinkedIn sweeps removed from P0 | Account risk during visa stabilization too high; assist-only allowed |
| Jun 2026 | Gmail MCP removed as backbone | Production backend needs real OAuth, not chat connector |
| Jun 2026 | Visa Clock replaced with multi-gate checklist | Single-date model misrepresents legal complexity |
| Jun 2026 | AI Truth Policy adopted | Prevents app from becoming confident-sounding hallucinator |
| Jun 2026 | P0 narrowed to 7 evidence modules | Forces focus on substance before distribution |

---

*This document supersedes v1. All architectural decisions trace back here or to a future v3 amendment. No code is written until ChatGPT has reviewed and Round 2 questions are resolved.*
