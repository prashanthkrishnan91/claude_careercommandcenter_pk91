# AI safety / truth contract

Implements v2.1 §4 (truth policy), v2 §5 (privacy boundary), v2.1 §5
(sanitization). Enforced in `lib/aiSafety.ts` + the three server routes; the
database independently enforces the structural halves (sanitized-claim
approval constraint, RLS, same-user FKs).

## Invariants

1. **Server-only AI.** Anthropic is called exclusively from route handlers
   (`app/api/ai/*`); `ANTHROPIC_API_KEY` never reaches a client bundle. The
   model id comes from `ANTHROPIC_MODEL` (default `claude-sonnet-5`) — an
   environment choice, never a hardcoded product assumption.
2. **Checks before calls.** Every route runs the truth/privacy gate before
   any network call to a model. A blocked request never leaves the server.
3. **PRIVATE firewall.** Raw `PRIVATE` content is never included in any model
   payload. A PRIVATE achievement participates in grading or generation only
   through its **approved** sanitized claim (approval forces PUBLIC_SAFE at
   the database level). Metrics/evidence marked PRIVATE are dropped from
   payloads.
4. **External-asset eligibility** (generation): every source must be
   `PUBLIC_SAFE` and `VERIFIED | ATTESTED_WITH_METRIC | ATTESTED_NO_METRIC`;
   `ATTESTED_NO_METRIC` additionally requires the explicit per-asset override
   checkbox. `INTERNAL_ONLY` may be seen by AI for internal analysis
   (grading) but never feeds an external asset.
5. **Blocking names the claim.** Refusals return per-source reasons
   (headline + failing check) and are surfaced verbatim in the UI, stored on
   the blocked `asset_versions` row, and recorded in `ai_outputs`.
6. **Audit everything.** Every attempt — success, block, transport failure,
   invalid structure — writes an `ai_outputs` row: output_type, model,
   input_refs, truth/privacy classifications of inputs, blocked flag, reason.
   Retention policy (v2 §5): 90 days then archive via `archived_bool`.
7. **No AI numbers.** The comparator is deterministic; grader ceilings are
   applied in code (ATTESTED_NO_METRIC caps impact/evidence dimensions);
   scenario totals in the Offer Workbench are user-entered snapshots. JD
   extraction returns `null` comp bands unless numerically present in a JD.
8. **Graceful unavailability.** Without `ANTHROPIC_API_KEY`, AI surfaces
   return an honest 503 "unavailable" state; nothing is generated or faked.
   Manual authoring paths remain available everywhere.
