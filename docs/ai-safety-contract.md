# AI safety / truth contract

Implements v2.1 §4 (truth policy), v2 §5 (privacy boundary), v2.1 §5
(sanitization). The DATABASE is the authority: `ccc_asset_graph_eligible`
implements the source-graph rules in SQL and gates every asset lifecycle
transition through `ccc_*` functions, with guard triggers rejecting the
equivalent generic PostgREST update. `lib/sourceGraph.ts` implements the same
policy in TypeScript to build the outbound payload (and is pinned to the SQL
authority by a parity test); `lib/assetService.ts` and
`lib/server/assetGeneration.ts` call the database functions rather than
carrying the decision themselves.

## Invariants

1. **Server-only AI.** Anthropic is called exclusively from route handlers
   (`app/api/ai/*`); `ANTHROPIC_API_KEY` never reaches a client bundle. The
   model id comes from `ANTHROPIC_MODEL` (default `claude-sonnet-5`) — an
   environment choice, never a hardcoded product assumption.
2. **One source graph, two implementations, one policy.** Every flow that can
   put asset content in front of a model or the outside world resolves the
   asset's complete source graph (achievements + metrics + evidence via
   junction tables, sanitized-claim substitutions, archetype context). The
   TypeScript resolver (`lib/sourceGraph.ts`) builds the PAYLOAD; the SQL
   function `ccc_asset_graph_eligible` is the AUTHORITY and gates every
   lifecycle transition regardless of what any client believes. A parity test
   asserts the two agree across a matrix of source states. Each source is
   classified by ITS OWN truth/privacy rules; dangling or archived references
   block rather than silently disappear.

   **Evidence verification policy (canonical):** an evidence item may enter an
   external payload only when it is active, PUBLIC_SAFE, AND carries both a
   verification timestamp and a verifier. `PUBLIC_SAFE` is a privacy
   statement, not a proof statement — unverified evidence is refused with that
   exact reason.

   **Archetype policy:** targeting an archetype requires it to be active and
   user-approved. Only approved parsed configuration travels; raw retained JD
   text (`archetype_sources.raw_content`) never enters a payload.
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
6. **Lifecycle enforcement in the database.** Approval, collection
   membership, collection approval/current selection, and external-use
   logging run only through `ccc_*` functions that re-derive eligibility
   inside one transaction; guard triggers reject the equivalent generic
   PostgREST update. A source that turns ineligible propagates immediately
   through `ccc_propagate_source_change`, which marks the affected assets and
   the collection memberships that package them — staleness is derived by the
   database, not maintained by a client.
7. **Transactional version chain.** `ccc_commit_asset_version` locks the
   asset, allocates the next number, inserts, supersedes the open prior,
   repoints `current_version_fk` and derives truth/privacy — all in one
   transaction that rolls back completely on failure. Triggers additionally
   reject a current version belonging to another asset, cross-asset
   supersession, and supersession by an earlier version (cycles).
8. **External use is a record, not a log.** `asset_external_uses` holds
   version-exact rows validated on insert (version resolves, belongs to the
   asset and user, approved, not blocked, is the current version, graph
   currently eligible). `career_assets.used_externally_bool` is derived by
   trigger and rejected if a client tries to set it.

   **OAuth state retention:** an unconsumed state row lives at most 10
   minutes; consumed and expired rows are deleted 24 hours after issuance by
   `ccc_purge_oauth_states`, called on every new connect.
9. **Blocking names the claim.** Refusals return per-source reasons
   (label + failing check), surfaced verbatim in the UI, stored on the
   blocked `asset_versions` row, and recorded in `ai_outputs`.
10. **Audit everything.** Every attempt — success, block, unavailability,
   transport failure, approval, external-use rejection — writes an
   `ai_outputs` row: output_type, model, input_refs, truth/privacy
   classifications, blocked flag, reason. Retention policy (v2 §5): 90 days
   then archive via `archived_bool`.
11. **No AI numbers.** The comparator is deterministic; grader ceilings are
    applied in code (ATTESTED_NO_METRIC caps impact/evidence dimensions);
    scenario totals in the Offer Workbench are user-entered snapshots. JD
    extraction returns `null` comp bands unless numerically present in a JD.
12. **Graceful unavailability.** Without `ANTHROPIC_API_KEY` (and no injected
    or stub transport), AI surfaces return an honest 503 "unavailable" state
    — and the attempt is still audited to `ai_outputs`. Manual authoring
    paths remain available everywhere. CI integration runs set
    `CCC_AI_TRANSPORT=stub`: a deterministic canned transport applied AFTER
    the real gate, producing clearly-labeled `[stub]` content.
