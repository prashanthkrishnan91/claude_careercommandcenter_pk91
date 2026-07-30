// Visual proof generator: renders every principal product surface in real
// Chromium with a deterministic, realistic dataset and saves screenshots to
// docs/validation/. This run intercepts Supabase at the network layer purely
// to render UI deterministically in offline environments — the REAL
// non-intercepted end-to-end validation is scripts/integration-live.mjs
// (integration.yml workflow).
//
// Usage: node scripts/visual-proof.mjs <baseURL> <outDir>

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "docs/validation";
fs.mkdirSync(OUT, { recursive: true });

const U = "11111111-1111-4111-8111-111111111111";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = "2026-07-20T12:00:00Z";
const USER = { id: U, aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {}, created_at: T };
const SESSION = {
  access_token: "visual-proof-token", refresh_token: "visual-proof-refresh", token_type: "bearer",
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER,
};

const common = { user_id: U, created_at: T, updated_at: T, status: "active" };
const store = {
  projects: [
    { ...common, id: id(1), name: "Churn forecasting overhaul", employer: "DIRECTV", role_at_time: "Sr Manager, Analytics", start_date: "2024-02-01", end_date: null, description: "Rebuilt churn forecasting from SAS to Python with weekly retrains.", business_context: "Churn was the #1 board topic in FY24.", my_scope: "Owned modeling and delivery across 3 analyst teams.", team_size: 9, stakeholders: ["CFO office", "VP CX"], privacy_class: "INTERNAL_ONLY" },
    { ...common, id: id(2), name: "Executive retention dashboard", employer: "DIRECTV", role_at_time: "Sr Manager, Analytics", start_date: "2025-01-15", end_date: "2025-06-30", description: "Looker cockpit for retention economics.", business_context: "", my_scope: "", team_size: 4, stakeholders: ["EVP Ops"], privacy_class: "INTERNAL_ONLY" },
    { ...common, id: id(3), name: "Pricing analytics platform", employer: "Prior Co", role_at_time: "Manager, Data Science", start_date: "2021-03-01", end_date: "2023-12-15", description: "", business_context: "", my_scope: "", team_size: 5, stakeholders: [], privacy_class: "INTERNAL_ONLY" },
  ],
  achievements: [
    { ...common, id: id(10), project_fk: id(1), headline: "Reduced churn forecast error by 18%", narrative: "Framed the rebuild, led 3 analysts, shipped weekly retrains with holdout validation.", action_taken: "Migrated SAS → Python; introduced backtesting harness.", outcome: "Forecast error down 18%; planning cycle shortened by a week.", start_date: "2024-06-01", end_date: "2025-03-31", claimed_seniority_level: "sr_mgr", truth_status: "ATTESTED_WITH_METRIC", privacy_class: "PUBLIC_SAFE", has_metric_bool: true, candidate_for_external_bool: true },
    { ...common, id: id(11), project_fk: id(1), headline: "Led the migration from SAS to Python", narrative: "", action_taken: "", outcome: "", start_date: null, end_date: null, claimed_seniority_level: null, truth_status: "NEEDS_PROOF", privacy_class: "INTERNAL_ONLY", has_metric_bool: false, candidate_for_external_bool: false, status: "draft", user_id: U, created_at: T, updated_at: T },
    { ...common, id: id(12), project_fk: id(2), headline: "Launched the executive retention dashboard", narrative: "Shipped to the EVP staff meeting cadence.", action_taken: "", outcome: "34 of 40 targeted execs active weekly.", start_date: null, end_date: "2025-06-30", claimed_seniority_level: "mgr", truth_status: "VERIFIED", privacy_class: "INTERNAL_ONLY", has_metric_bool: true, candidate_for_external_bool: false },
    { ...common, id: id(13), project_fk: id(3), headline: "Recovered $2.1M via pricing leakage audit", narrative: "Confidential engagement details.", action_taken: "", outcome: "", start_date: null, end_date: null, claimed_seniority_level: "mgr", truth_status: "ATTESTED_NO_METRIC", privacy_class: "PRIVATE", has_metric_bool: false, candidate_for_external_bool: false },
  ],
  metrics: [
    { ...common, id: id(20), achievement_fk: id(10), metric_name: "Churn forecast error", value: "18% reduction (4.2pp → 3.4pp)", unit: "pp", time_period: "Q2 2025", baseline_value: "4.2pp", calculation_notes: "Holdout-validated weekly cohorts", truth_status: "ATTESTED_WITH_METRIC", privacy_class: "PUBLIC_SAFE" },
    { ...common, id: id(21), achievement_fk: id(12), metric_name: "Executive weekly actives", value: "34 of 40 targeted execs", unit: "", time_period: "June 2026", baseline_value: "", calculation_notes: "", truth_status: "VERIFIED", privacy_class: "INTERNAL_ONLY" },
  ],
  evidence_items: [
    { ...common, id: id(30), achievement_fk: id(10), type: "email_ref", content_summary: "VP email confirming the Q2 forecast result", external_url: "", verified_at: T, verified_by: "manager", privacy_class: "INTERNAL_ONLY" },
    { ...common, id: id(31), achievement_fk: id(12), type: "metric_source", content_summary: "Looker usage export, June 2026", external_url: "https://example.com/looker", verified_at: null, verified_by: null, privacy_class: "INTERNAL_ONLY" },
  ],
  grader_evaluations: [
    { ...common, id: id(40), achievement_fk: id(10), evaluated_at: T, model_used: "claude-sonnet-5", dimensions: [
      { dimension: "quantified_business_impact", score: 4, rationale: "Concrete pp reduction with baseline and holdout validation." },
      { dimension: "scope_scale", score: 4, rationale: "Three analyst teams, board-level metric." },
      { dimension: "ownership", score: 4, rationale: "Framed and drove the rebuild end to end." },
      { dimension: "cross_functional_influence", score: 4, rationale: "Aligned finance planning and CX operations." },
      { dimension: "strategic_ambiguity", score: 3, rationale: "Problem framing partially inherited." },
      { dimension: "technical_analytical_difficulty", score: 4, rationale: "Backtesting harness and retrain pipeline." },
      { dimension: "evidence_quality", score: 3, rationale: "Manager attestation; no exported document yet." },
    ], total_score: 3.71, written_rationale: "Director-signal achievement: quantified, cross-functional, clearly owned. Evidence quality is the weakest dimension — attach the Q2 review deck to reach VERIFIED.", rubric_version: "v2.1.1-A6", dimension_disputes: [] },
  ],
  sanitized_claims: [
    { ...common, id: id(50), source_achievement_fk: id(13), source_metric_fk: null, raw_private_text: "Recovered $2.1M annual leakage in enterprise pricing for [client]", sanitized_public_text: "Recovered seven-figure annual revenue leakage through a systematic pricing audit", sanitization_method: "template", user_approved_at: T, privacy_class: "PUBLIC_SAFE" },
  ],
  target_archetypes: [
    { ...common, id: id(60), name: "Director, Analytics @ Tier-1 Tech", source_type: "jd_derived", required_skills: ["Python", "Forecasting", "Executive communication"], expected_scope: ["multi-team org", "P&L-adjacent"], expected_metrics: ["retention", "revenue impact"], seniority_signals: ["org design", "cross-functional programs"], comp_band_low: 260000, comp_band_high: 340000, visa_friendliness_score: 4, approved_by_user_bool: true },
    { ...common, id: id(61), name: "Head of Decision Science @ Media", source_type: "user_defined", required_skills: ["Causal inference"], expected_scope: [], expected_metrics: [], seniority_signals: [], comp_band_low: null, comp_band_high: null, visa_friendliness_score: null, approved_by_user_bool: false },
  ],
  archetype_sources: [
    { ...common, id: id(65), archetype_fk: id(60), source_type: "pasted_jd", raw_content: "Director of Analytics...", parsed_summary: "Director role: forecasting org of 8-12, retention focus, exec-facing.", used_in_archetype_bool: true, pinned_bool: false, purge_after: "2026-10-18" },
  ],
  gap_reports: [
    { ...common, id: id(70), archetype_fk: id(60), generated_at: T, covered_dimensions: [{ dimension: "skill: Python", detail: "Demonstrated at strength ≥3." }, { dimension: "metric: retention", detail: 'Covered by "Churn forecast error".' }], gap_dimensions: [{ dimension: "skill: Executive communication", detail: "No skill record or evidence in the vault." }], recommended_actions: [{ title: 'Log or link an achievement demonstrating "Executive communication"', category: "evidence" }] },
  ],
  career_assets: [
    { ...common, id: id(80), asset_type: "resume_bullet", current_version_fk: id(81), source_achievement_refs: [id(10)], source_evidence_refs: [], target_archetype_fk: id(60), truth_status_summary: "ATTESTED_WITH_METRIC", privacy_class: "PUBLIC_SAFE", used_externally_bool: true, external_use_log: [{ at: T, destination: "Referral application — Tier-1 Tech", version: 1 }] },
  ],
  asset_versions: [
    { user_id: U, created_at: T, id: id(81), asset_fk: id(80), version_number: 1, content: "Cut churn forecast error 18% (4.2pp → 3.4pp) by rebuilding the forecasting stack in Python and leading 3 analyst teams through weekly retrain adoption.", generated_by_model: "claude-sonnet-5", generation_prompt_hash: "9f2ab4c1", blocked_bool: false, block_reason: "", approved_by_user_bool: true, approved_at: T, superseded_by_fk: null },
    { user_id: U, created_at: T, id: id(82), asset_fk: id(80), version_number: 2, content: "", generated_by_model: "", generation_prompt_hash: "", blocked_bool: true, block_reason: "Led the migration from SAS to Python: Truth status NEEDS_PROOF blocks generation. Attach evidence or attest the claim.", approved_by_user_bool: false, approved_at: null, superseded_by_fk: null },
  ],
  asset_collections: [
    { ...common, id: id(85), name: "Resume v1 — Director Analytics", collection_type: "resume_version", asset_refs: [id(80)], target_archetype_fk: id(60), notes: "", current_bool: true },
  ],
  story_bank: [
    { ...common, id: id(90), theme: "scale", situation: "Churn forecasting was manual, SAS-based, and monthly.", task: "Modernize forecasting across 3 teams without missing a planning cycle.", action: "Ran the migration as a program: parallel scoring, holdout gates, weekly retrains.", result: "18% error reduction; planning moved to weekly cadence.", source_achievement_refs: [id(10)], target_archetype_refs: [id(60)], freshness_score: 4, last_practiced_at: T },
  ],
  visa_checklist_items: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    ...common, id: id(100 + n), state_name: [
      "PERM filed with priority date", "PERM approved", "I-140 filed", "I-140 approved",
      "I-140 approval + 180 days elapsed (revocation window cleared)",
      "Portability strategy reviewed and confirmed by immigration attorney",
      "New employer's GC sponsorship and priority date retention commitment confirmed in writing",
      "H1B transfer approved at new employer",
    ][n - 1], ordinal: n,
    status: n <= 4 ? "complete" : "not_started",
    assumptions: n === 5 ? ["No I-140 revocation within 180 days"] : [], risks: n === 2 ? ["RFE"] : [],
    required_documents: [], attorney_confirmation_required_bool: n === 6 || n === 7,
    attorney_confirmed_at: null, attorney_confirmation_doc_ref: "", do_not_act_until_confirmed_bool: n === 6 || n === 7, notes: "",
  })),
  weekly_briefs: [
    { user_id: U, created_at: T, id: id(120), week_of: "2026-07-20", brief_type: "friday_capture", content_markdown: "# Friday Capture", market_motion_action_fk: null, generated_at: T, reviewed_at: T, status: "active" },
  ],
  action_items: [
    { ...common, id: id(130), week_of: "2026-07-20", priority_rank: 1, title: "Attach Q2 review deck as evidence", rationale: "Moves the churn achievement to VERIFIED.", category: "evidence", outward_facing_bool: false, visa_gate_required_minimum: null, completed_at: null, status: "selected" },
    { ...common, id: id(131), week_of: "2026-07-20", priority_rank: 2, title: "Publish one public brand-building LinkedIn post (not job-shopping in tone)", rationale: "Outward motion permitted at Gates 1–4.", category: "outward", outward_facing_bool: true, visa_gate_required_minimum: null, completed_at: null, status: "selected" },
    { ...common, id: id(132), week_of: "2026-07-20", priority_rank: 3, title: "Approve the Head of Decision Science archetype or archive it", rationale: "Unapproved archetypes are invisible to the comparator.", category: "archetype", outward_facing_bool: false, visa_gate_required_minimum: null, completed_at: null, status: "candidate" },
  ],
  ai_outputs: [
    { user_id: U, created_at: T, id: id(140), output_type: "grader_evaluation", model_used: "claude-sonnet-5", input_refs: [{ kind: "achievement", id: id(10) }], output_text: "(structured)", truth_classifications: [], blocked_bool: false, block_reason: "", archived_bool: false },
    { user_id: U, created_at: T, id: id(141), output_type: "asset_resume_bullet", model_used: "", input_refs: [{ kind: "achievement", id: id(11) }], output_text: "", truth_classifications: [], blocked_bool: true, block_reason: "Led the migration from SAS to Python: Truth status NEEDS_PROOF blocks generation.", archived_bool: false },
  ],
  companies: [{ ...common, id: id(150), name: "Tier-1 Tech Co", tier: "tier-1", gc_sponsorship_history: "Strong EB2 record", notes: "" }],
  contacts: [{ ...common, id: id(151), company_fk: id(150), name: "Jordan Reeves", role_title: "Director, Analytics", source: "former colleague", linkedin_paste_raw: "", email: "", last_touch: "2026-06-14", notes: "" }],
  applications: [{ ...common, id: id(152), company_fk: id(150), role_title: "Director, Analytics", target_archetype_fk: id(60), applied_at: null, channel: "referral", stage: "draft", notes: "Waiting on Gate 5 before activating." }],
  interviews: [],
  referrals: [{ ...common, id: id(153), contact_fk: id(151), application_fk: id(152), stage: "identified", notes: "" }],
  outreach: [{ user_id: U, created_at: T, id: id(154), contact_fk: id(151), channel: "linkedin", direction: "outbound", occurred_at: "2026-06-14", summary: "Congratulated on launch; no job-seeking language.", followup_due: null, status: "active" }],
  comp_benchmarks: [{ user_id: U, created_at: T, id: id(155), archetype_fk: id(60), source: "Levels.fyi", role_title: "Director, Analytics", total_comp_low: 280000, total_comp_high: 360000, as_of: "2026-06-01", notes: "", status: "active" }],
  offers: [{ ...common, id: id(160), application_fk: id(152), company_fk: id(150), role_title: "Director, Analytics", received_at: null, status: "draft", base_salary: 250000, base_currency: "USD", bonus_target_pct: 20, bonus_structure_notes: "", equity_grant_value: 400000, equity_vest_schedule_notes: "4y, 25/25/25/25", equity_refresh_notes: "", signing_bonus: 50000, signing_bonus_clawback_notes: "", relocation_package: "", other_comp_notes: "", benefits_summary: "", visa_sponsorship_committed_bool: true, priority_date_retention_committed_bool: false, visa_sponsorship_terms_text: "", attorney_reviewed_at: null, attorney_reviewed_doc_ref: "", attorney_notes: "", expiration_date: null, decision_due_by: null, notes: "Hypothetical staging record for workbench validation." }],
  offer_scenarios: [{ user_id: U, created_at: T, id: id(161), offer_fk: id(160), scenario_name: "Stock flat", assumptions: ["grant value flat", "bonus at target"], total_comp_yr1 : 420000, total_comp_yr4: 380000, delta_vs_current: {}, notes: "", status: "active" }],
  counter_proposals: [],
  skills: [{ ...common, id: id(170), name: "Python", category: "technical", director_relevance_score: 4 }, { ...common, id: id(171), name: "Executive communication", category: "leadership", director_relevance_score: 5 }],
  skill_evidence: [{ user_id: U, created_at: T, id: id(172), skill_fk: id(170), achievement_fk: id(10), demonstration_strength_1_to_5: 4, status: "active" }],
  skill_development_plans: [{ ...common, id: id(173), skill_fk: id(171), gap_source: "archetype_comparator", gap_report_fk: id(70), current_level_1_to_5: 3, target_level_1_to_5: 5, rationale: "Director archetype requires exec-facing narrative strength.", target_archetype_refs: [id(60)], method: "work_project", method_details: "Own the monthly exec readout end-to-end", estimated_hours: 40, start_date: "2026-07-01", target_date: "2026-10-01", status: "in_progress", abandon_reason: "", notes: "" }],
  skill_development_progress: [{ user_id: U, created_at: T, id: id(174), plan_fk: id(173), progress_date: "2026-07-15", notes: "Presented churn readout to EVP staff.", linked_achievement_fk: null, hours_invested: 6, level_assessment_1_to_5: 3, assessed_by: "self" }],
  references: [{ ...common, id: id(180), contact_fk: id(151), reference_type: "manager", employer_at_time: "Prior Co", working_relationship_period_start: "2021-03-01", working_relationship_period_end: "2023-12-15", relationship_summary: "Direct manager through the pricing platform build.", strongest_themes: ["scope of analytics leadership", "cross-functional influence"], willingness_status: "confirmed", willingness_confirmed_at: T, willingness_notes: "", last_briefed_at: T, current_narrative_version_fk: null, briefing_method: "video_call", cadence_target_months: 6, last_touch_date: "2026-06-14", next_touch_due: "2026-12-14", used_for_application_refs: [], notes: "" }],
  google_connections: [], ingestion_runs: [], ingested_items: [], owner_overrides: [],
};

function applyFilters(rows, searchParams) {
  let out = [...rows];
  for (const [key, raw] of searchParams.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const val = rest.join(".");
    if (op === "eq") out = out.filter((r) => String(r[key]) === val);
    else if (op === "neq") out = out.filter((r) => String(r[key]) !== val);
    else if (op === "gte") out = out.filter((r) => String(r[key]) >= val);
  }
  const order = searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
  }
  const limit = searchParams.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

function handleRest(route, request) {
  const url = new URL(request.url());
  const table = decodeURIComponent(url.pathname.split("/").pop());
  const rows = store[table] ?? (store[table] = []);
  const method = request.method();
  const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (method === "POST") {
    const input = JSON.parse(request.postData() ?? "{}");
    const row = {
      id: id(900 + rows.length), user_id: U, status: "draft", truth_status: "NEEDS_PROOF",
      privacy_class: "INTERNAL_ONLY", has_metric_bool: false, candidate_for_external_bool: false,
      narrative: "", action_taken: "", outcome: "", start_date: null, end_date: null,
      claimed_seniority_level: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    };
    rows.push(row);
    return json([row], 201);
  }
  if (method === "GET") {
    const matched = applyFilters(rows, url.searchParams);
    return wantsObject ? json(matched[0] ?? null) : json(matched);
  }
  if (method === "PATCH") {
    const patch = JSON.parse(request.postData() ?? "{}");
    const matched = applyFilters(rows, url.searchParams);
    for (const row of matched) Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return json(matched);
  }
  if (method === "DELETE") {
    const matched = applyFilters(rows, url.searchParams);
    for (const m of matched) rows.splice(rows.indexOf(m), 1);
    return json(matched);
  }
  return route.fulfill({ status: 405, body: "{}" });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route("**/auth/v1/**", (route, request) => {
    const url = request.url();
    if (url.includes("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) });
    if (url.includes("/auth/v1/logout")) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) });
  });
  await ctx.route("**/rest/v1/**", handleRest);
  const page = await ctx.newPage();
  await page.addInitScript(([key, session]) => window.localStorage.setItem(key, JSON.stringify(session)), ["ccc-auth", SESSION]);

  async function shot(name, url, probe, prep) {
    await page.goto(`${BASE}${url}`);
    await page.locator("body", { hasText: probe }).waitFor({ timeout: 15000 });
    if (prep) await prep();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    results.push(name);
    console.log(`SHOT  ${name}`);
  }

  await shot("desktop-home-command", "/home", "evidence health");
  await shot("desktop-vault-hierarchy", "/vault", "DIRECTV");
  await shot("desktop-quick-log-focused", "/vault?ql=1", "quick log", async () => {
    await page.getByPlaceholder(/Achievement headline/).fill("Presented churn readout to EVP staff");
  });
  await shot("desktop-project-detail", `/vault/projects/${id(1)}`, "Business context");
  await shot("desktop-achievement-detail", `/vault/achievements/${id(10)}`, "grader");
  await shot("desktop-achievement-draft-promotion", `/vault/achievements/${id(11)}`, "promotion requirements");
  await shot("desktop-achievement-private-sanitized", `/vault/achievements/${id(13)}`, "sanitized claims");
  await shot("desktop-pipeline", "/pipeline", "drafts awaiting promotion");
  await shot("desktop-intelligence", "/intelligence", "ai output audit");
  await shot("desktop-archetype-detail", `/intelligence/archetypes/${id(60)}`, "gap reports");
  await shot("desktop-assets", "/intelligence/assets", "collections");
  await shot("desktop-asset-detail", `/intelligence/assets/${id(80)}`, "versions");
  await shot("desktop-story-bank", "/intelligence/stories", "story bank");
  await shot("desktop-rhythm", "/rhythm", "action queue");
  await shot("desktop-career-locked", "/career", "maturity");
  await shot("desktop-decisions-visa", "/decisions/visa", "Gate 7");
  await shot("desktop-offer-workbench", `/decisions/offers/${id(160)}`, "gate 7");
  await shot("desktop-development", "/development", "references");
  await shot("desktop-settings", "/settings", "privacy");

  await page.setViewportSize({ width: 390, height: 800 });
  await shot("mobile-vault", "/vault", "DIRECTV");
  await shot("mobile-quick-log", "/vault?ql=1", "quick log", async () => {
    await page.getByPlaceholder(/Achievement headline/).fill("Logged from phone between meetings");
  });
  await shot("mobile-achievement-detail", `/vault/achievements/${id(10)}`, "grader");

  console.log(`\n${results.length} screenshots → ${OUT}`);
} finally {
  await browser.close();
}
