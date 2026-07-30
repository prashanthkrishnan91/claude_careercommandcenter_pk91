# Career Command Center

A private career evidence engine (single operator). It converts real work,
relationships, target roles, and immigration timing into high-quality weekly
actions and durable career assets — and it refuses to polish weak input:
claims that aren't true, attributable, and useful never reach resumes,
interviews, or outreach.

Built to the locked architecture chain in `docs/architecture/` (v2.1 →
v2.1.1 + v2.2 → v2.2.1 → v2.2.2). Full P0 + P1 in this repo:

- **Vault** — Employer → Project → Achievement → Metrics/Evidence, canonical
  fields, inline autosave, Quick Log batch capture (`N`), archival lifecycle.
- **Truth & privacy** — six truth statuses × three privacy classes enforced
  before any AI call; PRIVATE text never leaves the database; Sanitized Claim
  Builder is the only bridge outward; every AI attempt audited.
- **Intelligence** — visible 7-dimension Achievement Grader (director-signal
  rule with Ownership floor), JD-derived Target Archetypes with 90-day raw
  retention, deterministic Comparator + gap reports, versioned Career Assets
  with approval/blocking/external-use logs, Collections, Story Bank.
- **Rhythm** — Friday Capture / Sunday Review (top-5 → top-3) / Monthly Board
  / Quarterly Narrative, with the market-motion engine gated by visa state.
- **Decisions** — 8-gate Visa Decision Checklist (attorney-confirmed gates;
  never a "safe jump date"; not legal advice), Offer Workbench with the
  Gate-7 acceptance block, comp benchmarks.
- **Career** — companies, contacts (manual LinkedIn paste-in only), outreach,
  referrals, applications, interviews, all locked behind the v2.1 §15
  Maturity Gates computed from real stored data.
- **Development** — skills + evidence, skeletal development plans with
  progress, references as a willingness-enforced overlay on contacts.

## Running

```bash
npm install
npm test        # 137 tests: schema, logic, OAuth state, AI payload gating, database authority, behavior
npm run dev
npm run build
```

Deployment, owner-account bootstrap, and optional integrations
(`ANTHROPIC_API_KEY`, Google OAuth): `docs/deployment.md`.
Validation evidence: `BUILD_REPORT.md` + `docs/validation/`.

Keyboard: `N` quick log · `E` edit focused field · `Esc` blur-and-save ·
`J/K` navigate · `⌘↵` promote eligible draft · `⌘⇧A` archive · `?` help.
