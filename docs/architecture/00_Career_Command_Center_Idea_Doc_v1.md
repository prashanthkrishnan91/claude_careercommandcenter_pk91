# Career Command Center — Idea Document

**Author:** Prashanth
**Reviewers:** Claude (architect), ChatGPT (critic/second opinion), Self
**Status:** Draft v1, for review
**Last updated:** June 2026

---

## 1. Vision

Build a personal, AI-orchestrated career operations system that compounds my professional brand, relationships, and pipeline during the 12–18 month visa stabilization window — so that the moment my I-140 is approved and held for 180+ days, I can move quickly into a high-tier role at a branded multinational (FAANG-class comp, stock, bonus, international exposure).

This is not a CRM. It is an opinionated coach + ops manager that does work for me, enforces weekly discipline, and surfaces only the next action — so my marginal time commitment stays low (~3 hours/week) while the system compounds in the background.

---

## 2. Strategic Context

**Current situation (June 2026):**
- BI/Analytics professional at DIRECTV (Call Center Retention Analytics).
- H1B, 5th year, expires Oct 2027 (will extend one more year).
- PERM filed Jan 30, 2026 by DIRECTV.
- I-140 expected sometime in 2027.
- Wife on H1B (Microsoft) through Dec 2027, then transitioning to H4 EAD.

**Window definition:**
- **Build phase:** June 2026 → I-140 approval + 180 days. ~18 months of compounding network, brand, narrative, and pipeline.
- **Jump phase:** Once safe, move to branded multinational. New employer files fresh PERM/I-140 with priority date retention (Jan 30, 2026 carries forward). Same/similar occupation requirement does NOT apply pre-I-485, so role flexibility is intact.

**The constraint becomes the advantage.** Most candidates scramble in 6–8 weeks. I get to compound for 18 months and arrive at the market with: strong brand, warm network at target companies, vetted narrative, prepped stories, and a triaged pipeline.

**Goal end-state:** Receive 2–4 competing offers from tier-1 multinationals within 90 days of becoming visa-portable.

---

## 3. Goals & Non-Goals

### Goals
- Compress weekly career-investment time to ~3 hours through AI automation.
- Build measurable brand presence (LinkedIn content + engagement from target-company employees).
- Maintain a warm, healthy network at 20–30 target companies.
- Maintain narrative consistency across resume, LinkedIn, posts, and outreach.
- Track visa milestones and surface the "safe to jump" date.
- Be a portfolio-grade artifact I can demo (the app itself is a director-pivot signal).

### Non-Goals
- Not a public product. Single-user, my account only.
- Not a job board aggregator. Quality pipeline > volume.
- Not a substitute for an immigration attorney.
- Not storing anything DIRECTV-confidential.
- Not optimizing for unauthorized scraping or LinkedIn ToS gray areas.

---

## 4. Architecture (Five-Layer Model)

```
LAYER 1: INGESTION (automated, runs without me)
  Gmail MCP        → recruiter emails, LinkedIn alerts, interview mail
  Calendar MCP     → upcoming interviews, networking sessions
  Claude in Chrome → weekly LinkedIn Sweep (1 click, ~10 min)
                     • post analytics, DMs, connection requests
                     • target company job posts, saved jobs
  Quick Capture    → voice memos on phone → Whisper → app
                     (post-meetup notes, ideas, action items)

LAYER 2: DATA (Supabase — the spine, locked in v1)
  Core tables, Edge Functions for scoring + scheduled jobs

LAYER 3: INTELLIGENCE (Claude API + targeted ChatGPT)
  Sunday Brief, outreach drafts, role scoring, narrative checks

LAYER 4: INTERFACE (Vercel + Next.js, mobile-first)
  Visa Clock, Action Queue, Sunday Brief, Search

LAYER 5: ACTION (I act, AI prepares)
  Claude in Chrome pastes drafts into LinkedIn for my review
  I clear the Action Queue in 5–10 min/day
```

---

## 5. Data Model (The Spine — Lock Before Building)

```sql
contacts (
  id, name, current_company, current_role, linkedin_url,
  email, connection_strength_1_to_5, target_company_fk,
  last_touch_date, source, notes, tags[]
)

companies (
  id, name, tier_1_to_3, gc_sponsorship_track_record,
  comp_band, hq_location, status[target|watching|pass],
  why_interesting, last_scanned_date
)

roles (
  id, company_fk, title, posted_date, jd_url, jd_text,
  fit_score, visa_status_inferred, scored_at,
  status[reviewing|applied|in_loop|passed|parked]
)

outreach (
  id, contact_fk, channel[li_dm|email|in_person],
  direction[out|in], message_text, sent_at, response_at,
  response_summary, follow_up_due, status
)

posts (
  id, platform, content, posted_at, impressions,
  reactions, comments, reshares,
  target_company_engagement_count, performance_notes
)

interviews (
  id, role_fk, round, date, interviewer_name, format,
  questions_asked[], my_answers_summary,
  went_well, to_improve, outcome
)

narrative (
  id, version, positioning_statement, star_stories[json],
  differentiators[], updated_at
)

visa_clock (
  perm_priority_date, perm_status, i140_status,
  i140_approval_date, safe_jump_date,
  h1b_expiration, wife_visa_status, wife_visa_expiration
)

weekly_briefs (
  id, week_of, content_markdown, top_3_priorities[json],
  generated_at, reviewed_at
)

quick_captures (
  id, raw_text, transcript, processed_bool,
  routed_to_table, created_at
)
```

This is the locked spine. UI, workflows, and AI prompts can iterate freely on top.

---

## 6. AI Tool Orchestration

| Tool | Role | When |
|------|------|------|
| **Claude API (Sonnet 4.6)** | App brain — generates Sunday Brief, outreach drafts, scores roles, checks narrative consistency, structures interview debriefs | Embedded in app, server-side calls |
| **Claude in Chrome** | Browser hands — runs LinkedIn Sweep, scans target company pages, composes DMs in LinkedIn UI for my review | Weekly + on-demand |
| **Claude Code (browser via GitHub/Vercel)** | Builder — all app code, schema migrations, components, edge functions via PRs to main | Build phase + iteration |
| **Claude Design (artifacts)** | UI sketches and component prototypes before committing to code | Pre-build for each new screen |
| **ChatGPT** | Critic + second voice — code diff review, strategy second-opinion, resume polish in a different voice, cover letter drafting | Manual, on-demand |
| **Gmail MCP** | Email ingestion pipeline | Daily cron |
| **Calendar MCP** | Calendar ingestion + meeting reminders | Daily cron |
| **Anthropic web search** | Company research, comp data, news on target firms | On-demand within app |
| **Supabase** | Database, auth, storage, edge functions, scheduled jobs | Always |
| **Vercel** | Hosting, cron, server actions, preview deploys | Always |
| **GitHub** | Source of truth, direct-to-main commits per existing workflow | Always |

---

## 7. Key Workflows

### 7.1 Sunday Executive Review (the keystone — 30–45 min/week)
1. Sunday 7 AM PT: Supabase Edge Function triggers Claude API.
2. Brief is generated from prior week's data: pipeline movement, content performance, relationships gone cold, narrative inconsistencies, visa clock check.
3. Brief lands in dashboard + emailed to me.
4. I review, approve next week's top 3 priorities, edit any flagged drafts.

### 7.2 LinkedIn Weekly Sweep (~10 min, Sunday)
Triggered via Claude in Chrome saved workflow:
- Reads my post analytics (last 7 days), extracts metrics + names of engagers.
- Lists new DMs since last sweep with context snippets.
- Scans connection requests.
- POSTs structured JSON to `/api/linkedin-sweep`.
- Supabase stores + flags items needing action.

### 7.3 Outreach Loop
- App surfaces "cold relationships" (no touch in 8+ weeks).
- Claude API drafts context-aware re-engagement message using last conversation + recent activity.
- I review on phone, edit, approve.
- Claude in Chrome opens LinkedIn, pastes into DM compose, leaves for my final click.

### 7.4 Role Triage
- New roles ingested via Gmail (LinkedIn alerts) and Chrome (target company scans).
- Claude API scores each on: GC sponsorship history, comp band, level fit, same/similar to current role, skill gap.
- Roles below threshold auto-archived; high-fit roles enter Action Queue.

### 7.5 Interview Debrief
- Calendar event flagged as interview → 2 hours post-meeting, app prompts debrief.
- Voice memo or text → Claude API structures into questions asked, my answers, went-well, to-improve.
- Stored in `interviews` table, searchable for future prep.

### 7.6 Content Engine Feedback Loop
- LinkedIn Sweep pulls post performance.
- Claude API analyzes which post types/topics drove engagement from target-company employees specifically (not just total impressions).
- Surfaces in Sunday Brief as content strategy recommendation for upcoming week.

---

## 8. Phased Build Plan

| Phase | Weeks | Deliverable | Stop Criteria |
|-------|-------|-------------|---------------|
| **1. Spine** | 1–2 | Supabase schema, Visa Clock dashboard, manual entry forms, basic auth | Schema is queryable, Visa Clock is accurate |
| **2. Ingestion** | 3–4 | Gmail MCP integration, Claude in Chrome LinkedIn Sweep, role intake endpoint | Data flows in without manual typing |
| **3. Intelligence** | 5–6 | Sunday Brief generator, outreach drafter, role scorer | First real Sunday Brief is useful |
| **4. Polish** | 7–8 | Voice quick-capture, mobile UX refinement, Action Queue UX | Daily use feels frictionless |
| **HARD STOP** | 9–16 | Use the app. No new features. | 8 weeks of real usage data |
| **5. Iterate** | 17+ | Build only what 8 weeks of usage proved necessary | — |

---

## 9. Success Metrics

**Leading indicators (monthly):**
- LinkedIn posts published vs. planned (target: 4/month minimum).
- Profile views from target-company employees (target: trending up).
- DMs initiated vs. responded (target: 50%+ response).
- Relationships kept warm (no cold relationships in tier-1 companies for 8+ weeks).
- Pipeline coverage: # of target companies with ≥1 warm contact (target: 15+ within 6 months, 25+ within 12).

**Lagging indicators (quarterly):**
- Inbound recruiter quality (tier of companies reaching out).
- Interview invitations received passively.
- Comp data gathered on target roles.

**Final goal (at jump time):**
- 2–4 competing offers from tier-1 multinationals within 90 days of becoming visa-portable.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| App becomes procrastination from actual job search | Hard 8-week build budget, then forced usage-only phase |
| LinkedIn account flagged for unusual activity | Chrome extension acts in my logged-in session at human pace, no bulk scraping, no third-party cookie tools |
| DIRECTV-confidential data leaks into app | Strict rule: nothing work-confidential in Supabase. Reviewed monthly. |
| Building too many features, none polished | Locked phased plan, stop criteria per phase |
| Wife's visa situation needs separate sponsorship track | Out of scope for app. Schedule attorney consult for Microsoft sponsorship of her independent GC track |
| I-140 revoked within 180 days of approval | Visa Clock surfaces the safe-jump date explicitly; do not act until then |
| Claude API costs scale unexpectedly | Monitor token usage in Supabase, set monthly budget alerts |
| Chrome extension Pro plan limits Haiku-only for browser | Acceptable for v1; upgrade to Max plan if browser usage scales |
| Burnout from "always on" career mode | Sunday-only deep work; weekday queue capped at 10 min |

---

## 11. Out-of-Scope (Explicitly)

- Wife's career tracking (separate app if needed later).
- Public-facing features or any multi-user functionality.
- Direct LinkedIn API integration (locked to enterprise partners; not pursuing).
- Scraping or third-party LinkedIn automation tools (account risk).
- Immigration legal advice (attorney handles).
- Resume building from scratch (use existing resume, app maintains versions).

---

## 12. Open Questions for ChatGPT Review

1. Does the phased plan look realistic given my no-CLI, browser-only workflow with Claude Code?
2. Is the data model missing any critical entity? (Candidates: skills tracking, certifications, salary history, referral tracking?)
3. Should the Sunday Brief be the keystone, or is daily friction lower with a Friday brief instead?
4. Is there a better way to handle the LinkedIn data ingestion problem than Claude in Chrome sweeps?
5. Are there tier-1 multinationals known for *not* doing priority date retention I should preemptively filter out?
6. What's missing in the risk matrix?
7. Should I add a competitive intelligence module (tracking when target-company employees in my function leave, signaling potential backfills)?
8. Is the 8-week post-build usage gate too long? Too short?
9. Should the narrative engine support multiple positioning variants (e.g., "Director, Analytics" vs. "Head of BI" vs. "Senior Manager, Data") for different target archetypes?
10. Recommended single change that would 10x this plan?

---

## 13. Next Steps

1. ChatGPT reviews this doc → consolidated feedback.
2. Lock data model based on review (one and only schema-set-in-stone moment).
3. Phase 1 kickoff: Claude Code creates Supabase project + initial schema migration via GitHub PR.
4. Vercel project linked, basic auth + Visa Clock dashboard live.
5. First Sunday Review run on real data within 6 weeks.

---

*This document is the source of truth for the Career Command Center project. All major architectural and strategic decisions should be traced back here or explicitly amended in a new version.*
