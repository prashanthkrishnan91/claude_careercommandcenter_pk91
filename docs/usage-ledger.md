# Usage ledger

Per v2.1 §16 deliverable 2. Values below are actual where the build
environment exposes them, and explicitly **unavailable** where it does not —
never estimated or fabricated.

## Model usage

| Item | Value |
|---|---|
| Build agent model | `claude-fable-5` (Claude Code remote session) |
| Total tokens consumed by the build session | **unavailable** — the Claude Code harness does not expose token telemetry to the session itself |
| Approximate cost of the build session | **unavailable** — same reason; billing is visible only on the account console |
| Product-runtime AI calls during this build | 0 — no `ANTHROPIC_API_KEY` exists in the build environment; every AI surface was exercised through its gating/blocked/unavailable paths |

## Tool invocations (counted from the build transcript)

| Tool | Approx. count | Purpose |
|---|---|---|
| Supabase MCP (`apply_migration`, `execute_sql`, project/keys/tables) | ~25 | project creation, two schema replacements, test-user rotation, verification |
| GitHub MCP (PR, workflows, logs) | ~10 | PR management, CI dispatch/evidence |
| Vercel MCP | 3 | team/project discovery; deploy attempt (refused: cannot create projects) |
| Local shell / file edits / tests / builds / screenshots | ~150 | implementation and verification |

## Infrastructure

| Item | Value |
|---|---|
| Supabase project `claude_careercommandcenter_pk91` (`loejfyzocsuzzmifxxhw`) | $0/month (org free tier at creation time) |
| GitHub Actions | hermetic runs on push/PR (~1–2 min each); live/integration dispatch-gated |
| Vercel | no deployment created by the build (permission-blocked); one-click import documented |
