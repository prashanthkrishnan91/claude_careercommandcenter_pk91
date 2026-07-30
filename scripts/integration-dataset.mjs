// The integration dataset, written ONCE and executed TWICE.
//
// `scripts/integration-live.mjs` runs these steps against the real Supabase
// project in the browser certification; `tests/integrationContract.test.ts`
// runs the SAME functions against the full PGlite migration chain in the
// hermetic suite. A nonexistent column, an invalid enum value, a missing
// required field or a violated constraint therefore fails the hermetic gate on
// every push — it can no longer be discovered only during a live run.
//
// Every helper asserts on persisted state, never on a rendered title. Each
// takes a supabase-js-compatible client, so both callers exercise real RLS,
// real triggers and the real RPCs.

/** Insert one row and fail loudly with the table name on any error. */
export async function insertRow(db, table, values) {
  const { data, error } = await db.from(table).insert(values).select().single();
  if (error) throw new Error(`${table} insert: ${error.message}`);
  return data;
}

export async function updateRow(db, table, id, values) {
  const { data, error } = await db.from(table).update(values).eq("id", id).select().single();
  if (error) throw new Error(`${table} update: ${error.message}`);
  return data;
}

export async function callRpc(db, fn, args) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/** The override is the only truthful way to reach P1 in a test run. */
export async function enableOverride(db, reason) {
  await callRpc(db, "ccc_set_override", {
    p_key: "maturity_dev_override",
    p_enabled: true,
    p_reason: reason,
  });
}

export async function disableOverride(db, reason) {
  await callRpc(db, "ccc_set_override", {
    p_key: "maturity_dev_override",
    p_enabled: false,
    p_reason: reason,
  });
}

// ── Vault foundation ────────────────────────────────────────────────────────
export async function seedVault(db) {
  const project = await insertRow(db, "projects", {
    name: "Churn forecasting overhaul",
    employer: "DIRECTV",
    role_at_time: "Sr Manager, Analytics",
  });
  const achievement = await insertRow(db, "achievements", {
    project_fk: project.id,
    headline: "Reduced churn forecast error by 18%",
    narrative: "Rebuilt the churn model end to end and shipped weekly retrains.",
    action_taken: "Framed the rebuild, led 3 analysts",
    outcome: "Forecast error down 18%",
    truth_status: "VERIFIED",
    privacy_class: "PUBLIC_SAFE",
    status: "active",
  });
  const metric = await insertRow(db, "metrics", {
    achievement_fk: achievement.id,
    metric_name: "Churn forecast error",
    value: "18% reduction (4.2pp → 3.4pp)",
    unit: "percentage points",
    time_period: "Q2 2026",
    truth_status: "VERIFIED",
    privacy_class: "PUBLIC_SAFE",
  });
  const evidence = await insertRow(db, "evidence_items", {
    achievement_fk: achievement.id,
    type: "email_ref",
    content_summary: "VP email confirming the Q2 result",
    privacy_class: "PUBLIC_SAFE",
    verified_at: new Date().toISOString(),
    verified_by: "manager",
  });
  return { project, achievement, metric, evidence };
}

// ── Grader: persistence, ceilings, dispute, director signal ─────────────────
export async function graderWorkflow(db, achievementId) {
  const dims = [
    "quantified_business_impact", "scope_scale", "ownership",
    "cross_functional_influence", "strategic_ambiguity",
    "technical_analytical_difficulty", "evidence_quality",
  ].map((dimension) => ({ dimension, score: 4, rationale: `[fixture] ${dimension} rationale` }));

  const evaluation = await insertRow(db, "grader_evaluations", {
    achievement_fk: achievementId,
    model_used: "fixture",
    dimensions: dims,
    total_score: 28,
    written_rationale: "[fixture] director-signal evaluation",
    rubric_version: "v2.1",
  });
  if (evaluation.dimensions.length !== 7) throw new Error("grader: 7 dimensions did not persist");
  if (!evaluation.dimensions.every((d) => d.rationale)) throw new Error("grader: a rationale is missing");

  // A dispute is recorded in the canonical dimension_disputes representation.
  const disputed = await updateRow(db, "grader_evaluations", evaluation.id, {
    dimension_disputes: [
      { dimension: "scope_scale", note: "understates a 3-team remit", at: new Date().toISOString() },
    ],
  });
  if (disputed.dimension_disputes.length !== 1) throw new Error("grader: dispute did not persist");

  // The director-signal criterion is computed from the stored evaluation.
  const criteria = await callRpc(db, "ccc_maturity_criteria", { uid: await currentUserId(db) });
  if (typeof criteria.director_5?.met !== "boolean") throw new Error("grader: director signal not computed");
  return { evaluation: disputed, criteria };
}

/** ATTESTED_NO_METRIC caps the impact and evidence dimensions at 3. */
export function applyGraderCeiling(truthStatus, dimensions) {
  const capped = new Set(["quantified_business_impact", "evidence_quality"]);
  const ceiling = truthStatus === "ATTESTED_NO_METRIC" ? 3
    : ["INFERRED", "NEEDS_PROOF", "DISPUTED"].includes(truthStatus) ? 2 : 5;
  return dimensions.map((d) => (capped.has(d.dimension) ? { ...d, score: Math.min(d.score, ceiling) } : d));
}

export async function graderCeilingWorkflow(db, achievementId) {
  await updateRow(db, "achievements", achievementId, { truth_status: "ATTESTED_NO_METRIC" });
  const dims = applyGraderCeiling("ATTESTED_NO_METRIC", [
    { dimension: "quantified_business_impact", score: 5, rationale: "x" },
    { dimension: "evidence_quality", score: 5, rationale: "x" },
    { dimension: "ownership", score: 5, rationale: "x" },
  ]);
  const evaluation = await insertRow(db, "grader_evaluations", {
    achievement_fk: achievementId, model_used: "fixture", dimensions: dims, rubric_version: "v2.1",
  });
  const scores = Object.fromEntries(evaluation.dimensions.map((d) => [d.dimension, d.score]));
  if (scores.quantified_business_impact > 3 || scores.evidence_quality > 3) {
    throw new Error("grader ceiling was not applied to a no-metric attestation");
  }
  if (scores.ownership !== 5) throw new Error("grader ceiling leaked to an uncapped dimension");
  await updateRow(db, "achievements", achievementId, { truth_status: "VERIFIED" });
  return evaluation;
}

// ── Archetypes: user-defined + JD-derived, approval, gap report ─────────────
export async function archetypeWorkflow(db) {
  const userDefined = await insertRow(db, "target_archetypes", {
    name: "Director, Analytics @ Tier-1 Tech",
    source_type: "user_defined",
    required_skills: ["forecasting", "org leadership"],
    expected_metrics: ["retention"],
    seniority_signals: ["multi-team scope"],
    approved_by_user_bool: true,
  });
  const jdDerived = await insertRow(db, "target_archetypes", {
    name: "Director, Data Platform",
    source_type: "jd_derived",
    required_skills: ["platform", "forecasting", "org leadership"],
  });
  const source = await insertRow(db, "archetype_sources", {
    archetype_fk: jdDerived.id,
    source_type: "pasted_jd",
    raw_content: "RAW-JD-TEXT retained for 90 days unless pinned",
    parsed_summary: "Director, Data Platform — multi-team scope",
    used_in_archetype_bool: true,
  });
  const approved = await updateRow(db, "target_archetypes", jdDerived.id, {
    approved_by_user_bool: true,
  });
  if (!approved.approved_by_user_bool) throw new Error("archetype approval did not persist");

  const report = await insertRow(db, "gap_reports", {
    archetype_fk: jdDerived.id,
    covered_dimensions: [{ dimension: "forecasting", evidence_count: 1 }],
    gap_dimensions: [{ dimension: "platform", reason: "no evidence" }],
    recommended_actions: [{ action: "log platform work" }],
  });
  if (!Array.isArray(report.gap_dimensions) || report.gap_dimensions.length === 0) {
    throw new Error("gap report did not persist structured gaps");
  }
  return { userDefined, jdDerived, source, report };
}

// ── Source-graph eligibility for metrics and evidence ──────────────────────
export async function assetWithSources(db, { achievementId, metricId, evidenceId, archetypeId }) {
  const asset = await insertRow(db, "career_assets", {
    asset_type: "resume_bullet",
    target_archetype_fk: archetypeId,
  });
  await insertRow(db, "asset_source_achievements", { asset_fk: asset.id, achievement_fk: achievementId });
  await insertRow(db, "asset_source_metrics", { asset_fk: asset.id, metric_fk: metricId });
  await insertRow(db, "asset_source_evidence", { asset_fk: asset.id, evidence_fk: evidenceId });
  return asset;
}

export async function eligibilityWorkflow(db, { assetId, metricId, evidenceId }) {
  // Unverified evidence is refused even though it is PUBLIC_SAFE.
  await updateRow(db, "evidence_items", evidenceId, { verified_at: null, verified_by: null });
  let verdict = await callRpc(db, "ccc_asset_graph_eligible", { p_asset: assetId });
  if (verdict.eligible) throw new Error("unverified evidence was accepted");
  if (!JSON.stringify(verdict.reasons).includes("Unverified evidence")) {
    throw new Error(`unexpected reason: ${JSON.stringify(verdict.reasons)}`);
  }
  await updateRow(db, "evidence_items", evidenceId, {
    verified_at: new Date().toISOString(), verified_by: "manager",
  });
  verdict = await callRpc(db, "ccc_asset_graph_eligible", { p_asset: assetId });
  if (!verdict.eligible) throw new Error(`still blocked: ${JSON.stringify(verdict.reasons)}`);

  // An INTERNAL_ONLY metric blocks; restoring it clears the block.
  await updateRow(db, "metrics", metricId, { privacy_class: "INTERNAL_ONLY" });
  verdict = await callRpc(db, "ccc_asset_graph_eligible", { p_asset: assetId });
  if (verdict.eligible) throw new Error("INTERNAL_ONLY metric was accepted");
  await updateRow(db, "metrics", metricId, { privacy_class: "PUBLIC_SAFE" });
  verdict = await callRpc(db, "ccc_asset_graph_eligible", { p_asset: assetId });
  if (!verdict.eligible) throw new Error("metric restore did not clear the block");
  return verdict;
}

// ── Version-exact collections: package → approve → current → invalidate ────
/**
 * @param createVersion an INJECTED adapter that produces a version. The
 *   low-level commit RPC is not executable by any browser role, so this module
 *   never calls it directly: the browser certification passes an adapter that
 *   posts to the protected application API, and the hermetic suite passes one
 *   backed by the privileged service-role harness. Neither needs — nor gets —
 *   production browser access to the internal function.
 */
export async function collectionWorkflow(db, { assetId, achievementId, createVersion }) {
  if (typeof createVersion !== "function") {
    throw new Error("collectionWorkflow needs a createVersion adapter (protected API or privileged harness)");
  }
  const committed = await createVersion(assetId);
  const version = await callRpc(db, "ccc_approve_asset_version", { p_version: committed.id });
  if (!version.approved_by_user_bool) throw new Error("version approval did not persist");

  const collection = await insertRow(db, "asset_collections", {
    name: "Resume — Director", collection_type: "resume_version",
  });
  await callRpc(db, "ccc_add_collection_version", { p_collection: collection.id, p_version: version.id });
  await callRpc(db, "ccc_approve_collection", { p_collection: collection.id });
  await callRpc(db, "ccc_set_current_collection", { p_collection: collection.id });

  let criteria = await callRpc(db, "ccc_maturity_criteria", { uid: await currentUserId(db) });
  if (!criteria.collection_current.met) throw new Error("collection criterion did not become met");

  // A regressed source marks the membership stale, demotes the collection and
  // fails the criterion.
  await updateRow(db, "achievements", achievementId, { truth_status: "DISPUTED" });
  const { data: members } = await db.from("collection_assets").select("*").eq("collection_fk", collection.id);
  if (!members?.[0]?.membership_stale_bool) throw new Error("membership was not marked stale");
  criteria = await callRpc(db, "ccc_maturity_criteria", { uid: await currentUserId(db) });
  if (criteria.collection_current.met) throw new Error("criterion still met with a stale member");
  await updateRow(db, "achievements", achievementId, { truth_status: "VERIFIED" });
  return { version, collection };
}

// ── P1 distribution: the full relationship chain ───────────────────────────
export async function p1Workflow(db) {
  const company = await insertRow(db, "companies", {
    name: "Meridian Data",
    tier: "target",
    gc_sponsorship_history: "Has sponsored EB-2 for senior analytics hires.",
    notes: "Warm intro available.",
  });
  const contact = await insertRow(db, "contacts", {
    name: "Alex Rivera",
    company_fk: company.id,
    role_title: "VP Analytics",
    source: "linkedin_paste",
    linkedin_paste_raw: "Alex Rivera — VP Analytics at Meridian Data",
  });
  const outreach = await insertRow(db, "outreach", {
    contact_fk: contact.id,
    channel: "linkedin",
    direction: "outbound",
    occurred_at: new Date().toISOString().slice(0, 10),
    summary: "Intro note about the platform role.",
  });
  const application = await insertRow(db, "applications", {
    role_title: "Director, Analytics — Meridian",
    company_fk: company.id,
    channel: "referral",
    stage: "applied",
    applied_at: new Date().toISOString().slice(0, 10),
  });
  const referral = await insertRow(db, "referrals", {
    contact_fk: contact.id,
    application_fk: application.id,
    stage: "requested",
    status: "active",
  });
  const interview = await insertRow(db, "interviews", {
    application_fk: application.id,
    round: "Hiring manager",
    scheduled_at: new Date().toISOString(),
    interviewer: "Alex Rivera",
  });
  const debriefed = await updateRow(db, "interviews", interview.id, {
    occurred_at: new Date().toISOString().slice(0, 10),
    debrief_markdown: "## Debrief\nScope questions went well; asked for platform depth.",
    themes: ["scope", "platform depth"],
    outcome: "passed",
  });
  if (!debriefed.debrief_markdown) throw new Error("interview debrief did not persist");
  if (debriefed.outcome !== "passed") throw new Error("interview outcome did not persist");
  if (referral.stage !== "requested") throw new Error("referral stage did not persist");
  if (outreach.channel !== "linkedin") throw new Error("outreach channel did not persist");
  return { company, contact, outreach, application, referral, interview: debriefed };
}

// ── Benchmark + scenario + counter proposal ────────────────────────────────
export async function offerWorkbenchWorkflow(db, { offerId, archetypeId }) {
  const benchmark = await insertRow(db, "comp_benchmarks", {
    archetype_fk: archetypeId,
    source: "levels_fyi",
    role_title: "Director, Analytics",
    total_comp_low: 285000,
    total_comp_high: 340000,
    as_of: new Date().toISOString().slice(0, 10),
    notes: "US remote band, 2026 H1.",
  });
  const scenario = await insertRow(db, "offer_scenarios", {
    offer_fk: offerId,
    scenario_name: "conservative / stock flat",
    total_comp_yr1: 289000,
    total_comp_yr4: 312000,
    assumptions: ["no refresh", "flat stock"],
    notes: "User-entered snapshot, not computed.",
  });
  if (Number(scenario.total_comp_yr1) !== 289000) throw new Error("scenario snapshot not stored verbatim");
  const counter = await insertRow(db, "counter_proposals", {
    offer_fk: offerId,
    rationale: "Base sits below the benchmark midpoint for this scope.",
    proposed_changes: [{ component: "base", from: 240000, to: 265000 }],
  });
  await insertRow(db, "counter_benchmarks", { counter_fk: counter.id, benchmark_fk: benchmark.id });
  const staged = await updateRow(db, "counter_proposals", counter.id, {
    sent_at: new Date().toISOString().slice(0, 10),
    response_at: new Date().toISOString().slice(0, 10),
    response_summary: "Base moved to 258k.",
    outcome: "partially_accepted",
  });
  if (staged.outcome !== "partially_accepted") throw new Error("counter outcome did not persist");
  return { benchmark, scenario, counter: staged };
}

// ── Skills: evidence, plan, progress, stale detection ──────────────────────
export async function skillsWorkflow(db, { achievementId, gapReportId }) {
  const skill = await insertRow(db, "skills", {
    name: "Platform architecture",
    category: "technical",
    director_relevance_score: 5,
  });
  const evidence = await insertRow(db, "skill_evidence", {
    skill_fk: skill.id,
    achievement_fk: achievementId,
    demonstration_strength_1_to_5: 3,
  });
  const plan = await insertRow(db, "skill_development_plans", {
    skill_fk: skill.id,
    gap_source: "archetype_comparator",
    gap_report_fk: gapReportId,
    current_level_1_to_5: 2,
    target_level_1_to_5: 4,
    rationale: "Comparator flagged platform depth against the Director archetype.",
    method: "work_project",
    method_details: "Lead the platform consolidation workstream.",
    estimated_hours: 120,
    start_date: new Date().toISOString().slice(0, 10),
    target_date: "2026-12-31",
    status: "in_progress",
  });
  const progress = await insertRow(db, "skill_development_progress", {
    plan_fk: plan.id,
    progress_date: new Date().toISOString().slice(0, 10),
    notes: "Kicked off the workstream and set the review cadence.",
    linked_achievement_fk: achievementId,
    hours_invested: 12,
    level_assessment_1_to_5: 3,
    assessed_by: "self",
  });
  if (evidence.demonstration_strength_1_to_5 !== 3) throw new Error("skill evidence strength did not persist");
  if (plan.method !== "work_project") throw new Error("plan method did not persist");
  if (!progress.progress_date) throw new Error("progress date did not persist");

  // Stale detection: backdate the only progress entry past the threshold.
  const stale = new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10);
  const backdated = await updateRow(db, "skill_development_progress", progress.id, { progress_date: stale });
  if (backdated.progress_date !== stale) throw new Error("progress backdate did not persist");
  return { skill, evidence, plan, progress: backdated, staleSince: stale };
}

// ── Weekly OS: Monthly Board Review ────────────────────────────────────────
export async function monthlyBoardWorkflow(db, weekOf) {
  const brief = await insertRow(db, "weekly_briefs", {
    week_of: weekOf,
    brief_type: "monthly_board",
    content_markdown: "# Monthly Board Review\nEvidence trajectory, archetype coverage, collection currency, visa assessment.",
  });
  const reviewed = await updateRow(db, "weekly_briefs", brief.id, { reviewed_at: new Date().toISOString() });
  if (!reviewed.reviewed_at) throw new Error("monthly board review did not persist");
  if (!reviewed.content_markdown) throw new Error("monthly board brief has no content");
  const criteria = await callRpc(db, "ccc_maturity_criteria", { uid: await currentUserId(db) });
  if (!criteria.monthly_board.met) throw new Error("monthly board criterion did not become met");
  return reviewed;
}

// ── Maturity regression: P1 authorization is revoked without a recompute ───
export async function maturityRegressionWorkflow(db) {
  const ok = await db.from("companies").insert({ name: "Still Unlocked" }).select();
  if (ok.error) throw new Error(`expected an unlocked write to succeed: ${ok.error.message}`);
  await disableOverride(db, "integration regression check");
  // No recompute RPC, no page load in between.
  const blocked = await db.from("companies").insert({ name: "Should Be Blocked" }).select();
  if (!blocked.error || !/row-level security/.test(blocked.error.message)) {
    throw new Error(`expected an RLS refusal, got: ${blocked.error?.message ?? "success"}`);
  }
  const del = await db.from("companies").delete().eq("name", "Still Unlocked").select();
  if ((del.data ?? []).length > 0) throw new Error("a locked DELETE removed a P1 row");
  const { data: audit } = await db.from("override_mutations").select("*");
  if (!audit?.length) throw new Error("override-era mutations were not audited");
  if (!audit.every((r) => r.reason_snapshot)) throw new Error("an audit row lacks its immutable reason snapshot");
  await enableOverride(db, "integration continue");
  return audit;
}

// ── OAuth state: atomic single-use under concurrency ───────────────────────
export async function oauthRaceWorkflow(db, redirectUri, nonceHash) {
  await callRpc(db, "ccc_issue_oauth_state", {
    p_nonce_hash: nonceHash,
    p_provider: "gmail",
    p_redirect_uri: redirectUri,
    p_code_verifier_encrypted: "enc-verifier",
    p_session_binding_encrypted: "enc-session",
    p_ttl_seconds: 600,
  });
  const claims = await Promise.all(
    Array.from({ length: 8 }, () => db.rpc("ccc_claim_oauth_state", { p_nonce_hash: nonceHash })),
  );
  const wins = claims.filter((c) => c.data?.claimed).length;
  if (wins !== 1) throw new Error(`expected exactly one winning claim, got ${wins}`);
  const forged = await db.from("oauth_states").insert({
    nonce_hash: "forged", provider: "gmail", redirect_uri: redirectUri,
    code_verifier_encrypted: "x", expires_at: new Date(Date.now() + 60000).toISOString(),
  }).select();
  if (!forged.error) throw new Error("a client wrote oauth_states directly");
  return wins;
}

// ── Direct-write bypass attempts that the database must refuse ─────────────
export async function bypassAttempts(db, { assetId, versionId, collectionId }) {
  const refusals = [];
  // Read current state so every attempt below is a REAL change, never a no-op
  // that the guard would pass simply because nothing differed.
  const { data: asset } = await db.from("career_assets").select("*").eq("id", assetId).single();
  const mustFail = async (label, run) => {
    const { data, error } = await run();
    const refused = Boolean(error) || (Array.isArray(data) && data.length === 0);
    if (!refused) throw new Error(`${label}: the database accepted a forged write`);
    refusals.push(label);
  };

  await mustFail("insert asset_version", () =>
    db.from("asset_versions").insert({ asset_fk: assetId, version_number: 999, content: "forged", generated_by_model: "gpt-fake" }).select());
  await mustFail("delete asset_version", () =>
    db.from("asset_versions").delete().eq("id", versionId).select());
  await mustFail("update asset_version", () =>
    db.from("asset_versions").update({ content: "rewritten" }).eq("id", versionId).select());
  await mustFail("repoint current_version_fk", () =>
    db.from("career_assets").update({ current_version_fk: null }).eq("id", assetId).select());
  await mustFail("set used_externally_bool", () =>
    db.from("career_assets").update({ used_externally_bool: !asset.used_externally_bool }).eq("id", assetId).select());
  await mustFail("flip eligibility_stale_bool", () =>
    db.from("career_assets")
      .update({ eligibility_stale_bool: !asset.eligibility_stale_bool, eligibility_reason: "forged" })
      .eq("id", assetId).select());
  await mustFail("rewrite truth_status_summary", () =>
    db.from("career_assets").update({ truth_status_summary: "VERIFIED,forged" }).eq("id", assetId).select());
  await mustFail("update collection membership", () =>
    db.from("collection_assets").update({ membership_stale_bool: false }).eq("collection_fk", collectionId).select());
  await mustFail("delete collection membership", () =>
    db.from("collection_assets").delete().eq("collection_fk", collectionId).select());
  await mustFail("insert collection membership", () =>
    db.from("collection_assets").insert({ collection_fk: collectionId, asset_fk: assetId, version_fk: versionId }).select());

  // The low-level lifecycle functions are revoked from every browser role, so
  // an ordinary authenticated client cannot reach them at all.
  await mustFail("call ccc_commit_asset_version as an authenticated browser client", () =>
    db.rpc("ccc_commit_asset_version", {
      p_user: null, p_asset: assetId, p_content: "forged", p_model: "gpt-fake",
      p_prompt_hash: "forged", p_blocked: false, p_block_reason: "", p_ack: false,
      p_audit: { output_type: "forged" },
    }));
  await mustFail("call ccc_author_manual_version as an authenticated browser client", () =>
    db.rpc("ccc_author_manual_version", { p_user: null, p_asset: assetId, p_content: "forged" }));
  await mustFail("call ccc_record_ai_audit as an authenticated browser client", () =>
    db.rpc("ccc_record_ai_audit", { p_user: null, p_audit: { output_type: "forged" } }));
  await mustFail("call ccc_asset_graph_eligible_for as an authenticated browser client", () =>
    db.rpc("ccc_asset_graph_eligible_for", { p_user: null, p_asset: assetId }));
  return refusals;
}

async function currentUserId(db) {
  const { data } = await db.auth.getUser();
  return data.user.id;
}

export { currentUserId };
