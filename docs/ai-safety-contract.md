# AI safety / truth contract

Implements v2.1 §4 (truth policy), v2 §5 (privacy boundary), v2.1 §5
(sanitization). Enforced in one canonical source-resolution service
(`lib/sourceGraph.ts`) used by every asset lifecycle step
(`lib/assetService.ts`, `lib/server/assetGeneration.ts`) and by the grader
payload builder (`lib/aiSafety.ts`); the database independently enforces the
structural halves (sanitized-claim approval constraint, RLS, same-user
composite FKs on the normalized junction tables, version-chain triggers).

## Invariants

1. **Server-only AI.** Anthropic is called exclusively from route handlers
   (`app/api/ai/*`); `ANTHROPIC_API_KEY` never reaches a client bundle. The
   model id comes from `ANTHROPIC_MODEL` (default `claude-sonnet-5`) — an
   environment choice, never a hardcoded product assumption.
2. **One source graph.** Every flow that can put asset content in front of a
   model or the outside world — generation, manual authoring, approval,
   collection membership, external-use logging, maturity hygiene — resolves
   the asset's complete source graph (achievements + metrics + evidence via
   junction tables, sanitized-claim substitutions, archetype context) through
   `resolveSourceGraph`. Each source is classified by ITS OWN truth/privacy
   rules; dangling or archived references block rather than silently
   disappear.
3. **Checks before calls.** The gate runs before any network call. A blocked
   request never leaves the server; the regression suite proves the transport
   receives zero calls on a blocked graph.
4. **PRIVATE firewall — replacement, not append.** Raw `PRIVATE` content
   never enters a model payload. A PRIVATE source participates only through
   its **approved** sanitized claim, whose text REPLACES the private text in
   the payload manifest. The suite inspects the EXACT serialized outbound
   payload (via a deterministic capturing transport injected AFTER the real
   gate) and asserts the sanitized text is present while the raw private text
   is absent.
5. **External-asset eligibility** (generation): every source must be
   `PUBLIC_SAFE` (or PRIVATE-with-approved-claim) and
   `VERIFIED | ATTESTED_WITH_METRIC | ATTESTED_NO_METRIC`;
   `ATTESTED_NO_METRIC` additionally requires the explicit per-generation
   override. `INTERNAL_ONLY` may be seen by AI for internal analysis
   (grading) but never feeds an external asset.
6. **Lifecycle revalidation.** The graph is re-resolved on approval,
   collection add, and external-use logging — not only at generation time. A
   source that turns ineligible afterwards marks the asset
   `eligibility_stale_bool` with the failing claim named, and approval /
   collection membership / external use are blocked until resolved.
7. **Atomic version chain.** New version → open priors superseded →
   `current_version_fk` repointed. Database triggers reject a current version
   belonging to another asset, cross-asset supersession, and supersession by
   an earlier version (cycles).
8. **Blocking names the claim.** Refusals return per-source reasons
   (label + failing check), surfaced verbatim in the UI, stored on the
   blocked `asset_versions` row, and recorded in `ai_outputs`.
9. **Audit everything.** Every attempt — success, block, unavailability,
   transport failure, approval, external-use rejection — writes an
   `ai_outputs` row: output_type, model, input_refs, truth/privacy
   classifications, blocked flag, reason. Retention policy (v2 §5): 90 days
   then archive via `archived_bool`.
10. **No AI numbers.** The comparator is deterministic; grader ceilings are
    applied in code (ATTESTED_NO_METRIC caps impact/evidence dimensions);
    scenario totals in the Offer Workbench are user-entered snapshots. JD
    extraction returns `null` comp bands unless numerically present in a JD.
11. **Graceful unavailability.** Without `ANTHROPIC_API_KEY` (and no injected
    or stub transport), AI surfaces return an honest 503 "unavailable" state
    — and the attempt is still audited to `ai_outputs`. Manual authoring
    paths remain available everywhere. CI integration runs set
    `CCC_AI_TRANSPORT=stub`: a deterministic canned transport applied AFTER
    the real gate, producing clearly-labeled `[stub]` content.
