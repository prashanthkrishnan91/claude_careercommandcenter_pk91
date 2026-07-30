// Real end-to-end browser validation — NO Supabase interception.
//
// Drives the production bundle in Chromium against the dedicated Supabase
// project: signs in through the real auth UI, builds a deterministic
// demonstration dataset (1 project, 2 achievements via Quick Log batch
// entry, 2 metrics, 2 evidence items), verifies the Vault hierarchy,
// achievement-detail proof, promotion, archive/restore in the Pipeline, and
// mobile capture — screenshotting every principal surface. Cleans up its
// rows afterwards (test tooling; the product itself never deletes).
//
// Credentials come exclusively from the environment; the script fails closed.
//
// Usage: node scripts/integration-live.mjs <baseURL> <screenshotDir>

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
// The dataset operations below are the SAME functions the hermetic suite runs
// against the full migration chain (tests/integrationContract.test.ts), so a
// bad column or enum fails CI on push rather than only here.
import {
  archetypeWorkflow,
  assetWithSources,
  bypassAttempts,
  collectionWorkflow,
  eligibilityWorkflow,
  enableOverride,
  graderCeilingWorkflow,
  graderWorkflow,
  maturityRegressionWorkflow,
  monthlyBoardWorkflow,
  oauthRaceWorkflow,
  offerWorkbenchWorkflow,
  p1Workflow,
  skillsWorkflow,
} from "./integration-dataset.mjs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const SHOTS = process.argv[3] ?? "docs/validation/live";
fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = process.env.CCC_TEST_EMAIL_A;
const PASSWORD = process.env.CCC_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("integration-live: CCC_TEST_EMAIL_A and CCC_TEST_PASSWORD are required. Failing closed.");
  process.exit(1);
}
// Publishable-by-design values (same as lib/config.ts); env overrides.
const SUPABASE_URL = process.env.CCC_SUPABASE_URL ?? "https://loejfyzocsuzzmifxxhw.supabase.co";
const SUPABASE_KEY = process.env.CCC_SUPABASE_KEY ?? "sb_publishable_FlnSD3icCQdrtIBIcjaaqA_QXgYJgvn";

const results = [];
let step = 0;
async function check(page, name, fn) {
  step += 1;
  const shot = `${String(step).padStart(2, "0")}-${name}`;
  try {
    await fn();
    await page.screenshot({ path: path.join(SHOTS, `${shot}.png`) });
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (err) {
    await page.screenshot({ path: path.join(SHOTS, `${shot}-FAIL.png`) });
    results.push(`FAIL  ${name}: ${err.message}`);
    console.error(`FAIL  ${name}: ${err.message}`);
    throw err;
  }
}
const visible = (page, sel, text) =>
  (text ? page.locator(sel, { hasText: text }) : page.locator(sel)).first().waitFor({ state: "visible", timeout: 15000 });

// Signed-in PostgREST client as the test user (test tooling; real RLS).
async function signedClient() {
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { error } = await db.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error(`API sign-in failed: ${error.message}`);
  return db;
}

// Cleanup through the API as the test user (isolated test tooling).
async function wipe() {
  const db = await signedClient();
  // owner_overrides is client-read-only: disable through the audited RPC.
  await db.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: false, p_reason: "integration cleanup" });
  await db.rpc("ccc_set_override", { p_key: "market_motion_override", p_enabled: false, p_reason: "integration cleanup" });
  // asset_versions, collection_assets, asset_external_uses and oauth_states are
  // client-read-only by design; they are removed by ON DELETE CASCADE when
  // their parents go, which is why career_assets/asset_collections lead here.
  for (const t of [
    "reference_application_uses", "counter_benchmarks",
    "asset_source_achievements", "asset_source_evidence", "asset_source_metrics",
    "story_achievements", "story_archetypes", "plan_archetypes",
    "ingested_items", "ingestion_runs", "google_connections",
    "references", "skill_development_progress", "skill_development_plans", "skill_evidence", "skills",
    "counter_proposals", "offer_scenarios", "offers", "comp_benchmarks", "interviews", "referrals",
    "outreach", "applications", "contacts", "companies", "ai_outputs", "action_items", "weekly_briefs",
    "visa_checklist_items", "story_bank", "asset_collections", "career_assets", "gap_reports",
    "archetype_sources", "target_archetypes", "grader_evaluations", "sanitized_claims",
    "evidence_items", "metrics", "achievements", "projects",
  ]) {
    await db.from(t).delete().gte("created_at", "1970-01-01");
  }
  await db.auth.signOut();
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: "/opt/pw-browsers/chromium" },
);
try {
  await wipe(); // start from a clean slate
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await check(page, "real-sign-in", async () => {
    await page.goto(`${BASE}/login`);
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Enter the cockpit" }).click();
    await page.waitForURL("**/home", { timeout: 20000 });
    await visible(page, "h2", "evidence health");
  });

  await check(page, "vault-empty-state-verbatim", async () => {
    await page.goto(`${BASE}/vault`);
    await visible(page, "p", "Your evidence vault is empty.");
  });

  await check(page, "create-project", async () => {
    await page.getByRole("button", { name: "+ Add project" }).click();
    await page.getByPlaceholder("A body of work — a system, a problem, a function").fill("Churn forecasting overhaul");
    await page.getByPlaceholder("e.g. DIRECTV").fill("DIRECTV");
    await page.getByRole("button", { name: "Add add project", exact: false }).or(page.getByRole("button", { name: "Add project", exact: true })).last().click();
    await visible(page, "a", "Churn forecasting overhaul");
  });

  await check(page, "quick-log-batch-entry", async () => {
    const headline = page.getByPlaceholder(/Achievement headline/);
    await headline.fill("Reduced churn forecast error by 18%");
    await headline.press("Enter");
    await visible(page, "span", "logged: Reduced churn forecast error");
    // Surface stays open and focus returns to the headline (batch entry).
    const focusedPlaceholder = await page.evaluate(() => document.activeElement?.getAttribute("placeholder") ?? "");
    if (!/Achievement headline/.test(focusedPlaceholder)) throw new Error("focus did not return to headline");
    await headline.fill("Launched the executive retention dashboard");
    await headline.press("Enter");
    await visible(page, "button", "Launched the executive retention dashboard");
  });

  await check(page, "vault-hierarchy", async () => {
    await visible(page, "h2", "DIRECTV");
    await visible(page, "a", "Churn forecasting overhaul");
    await visible(page, "button", "Reduced churn forecast error by 18%");
  });

  await check(page, "achievement-proof-metric-and-evidence", async () => {
    await page.locator("button", { hasText: "Reduced churn forecast error by 18%" }).first().click();
    await page.waitForURL("**/vault/achievements/**");
    await visible(page, "p", "No quantified impact yet for this achievement.");
    await page.getByRole("button", { name: "+ Record metric" }).click();
    await page.getByPlaceholder("e.g. Churn forecast error").fill("Churn forecast error");
    await page.locator('input.font-mono').first().fill("18% reduction (4.2pp → 3.4pp)");
    await page.getByRole("button", { name: "Add record metric" }).click();
    await visible(page, "span", "18% reduction");
    await page.getByRole("button", { name: "+ Link evidence" }).click();
    await page.locator("select").filter({ hasText: "email ref" }).first().selectOption("email_ref");
    await page.getByPlaceholder("What the proof is and where it lives").fill("VP email confirming the Q2 result, saved in personal archive");
    await page.getByRole("button", { name: "Add link evidence" }).click();
    await visible(page, "span", "VP email confirming the Q2 result");
  });

  await check(page, "promotion-gate", async () => {
    await page.locator("textarea").first().fill("Framed the churn model rebuild, led 3 analysts, shipped weekly retrain.");
    await page.locator("textarea").first().blur();
    await page.locator("span", { hasText: "saved" }).first().waitFor({ timeout: 8000 });
    const checks = page.locator('input[type="checkbox"]');
    await checks.nth(0).check(); // privacy affirmation
    await checks.nth(1).check(); // stays NEEDS_PROOF confirmation
    await page.getByRole("button", { name: /Promote to active/ }).click();
    await visible(page, "span", "active");
  });

  await check(page, "second-achievement-proof", async () => {
    await page.goto(`${BASE}/vault`);
    await page.locator("button", { hasText: "Launched the executive retention dashboard" }).first().click();
    await page.waitForURL("**/vault/achievements/**");
    await page.getByRole("button", { name: "+ Record metric" }).click();
    await page.getByPlaceholder("e.g. Churn forecast error").fill("Executive weekly active viewers");
    await page.locator('input.font-mono').first().fill("34 of 40 targeted execs");
    await page.getByRole("button", { name: "Add record metric" }).click();
    await visible(page, "span", "34 of 40 targeted execs");
    await page.getByRole("button", { name: "+ Link evidence" }).click();
    await page.getByPlaceholder("What the proof is and where it lives").fill("Dashboard usage report exported from Looker, June 2026");
    await page.getByRole("button", { name: "Add link evidence" }).click();
    await visible(page, "span", "Dashboard usage report");
  });

  await check(page, "archive-and-pipeline-restore", async () => {
    await page.getByRole("button", { name: /Archive/ }).first().click();
    await page.goto(`${BASE}/pipeline`);
    await visible(page, "span", "Launched the executive retention dashboard");
    await page.getByRole("button", { name: "restore → draft" }).click();
    await page.locator("span", { hasText: "Launched the executive retention dashboard" }).first().waitFor({ state: "visible" });
  });

  // ── Release blocker #7: keyboard on the canonical Vault hierarchy ─────────
  await check(page, "keyboard-jk-select-and-e-open", async () => {
    await page.goto(`${BASE}/vault`);
    await visible(page, "h2", "DIRECTV");
    await page.keyboard.press("j");
    await page.locator('[data-vault-row="0"].bg-ink-800').waitFor({ timeout: 5000 });
    await page.keyboard.press("j");
    await page.locator('[data-vault-row="1"].bg-ink-800').waitFor({ timeout: 5000 });
    await page.keyboard.press("k");
    await page.locator('[data-vault-row="0"].bg-ink-800').waitFor({ timeout: 5000 });
    await page.keyboard.press("e");
    await page.waitForURL("**/vault/achievements/**", { timeout: 10000 });
  });

  await check(page, "keyboard-cmd-enter-promotion-gate-and-escape", async () => {
    await page.goto(`${BASE}/vault`);
    await visible(page, "h2", "DIRECTV");
    // select the DRAFT achievement (restored dashboard) wherever it sits
    const rows = page.locator("[data-vault-row]");
    const count = await rows.count();
    let draftIndex = -1;
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).innerText();
      if (text.includes("Launched the executive retention dashboard")) draftIndex = i;
    }
    if (draftIndex < 0) throw new Error("draft achievement row not found");
    for (let i = 0; i <= draftIndex; i++) await page.keyboard.press("j");
    // ⌘/Ctrl+Enter runs the REAL promotion gate — affirmations are absent, so
    // the calm blocked notice must appear (never a silent promotion).
    await page.keyboard.press("Control+Enter");
    await visible(page, '[data-testid="vault-notice"]', "Promotion blocked");
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="vault-notice"]').waitFor({ state: "hidden", timeout: 5000 });
  });

  await check(page, "keyboard-cmd-shift-a-archives", async () => {
    const rows = page.locator("[data-vault-row]");
    const count = await rows.count();
    let draftIndex = -1;
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).innerText();
      if (text.includes("Launched the executive retention dashboard")) draftIndex = i;
    }
    for (let i = 0; i <= draftIndex; i++) await page.keyboard.press("j");
    await page.keyboard.press("Control+Shift+A");
    // archived rows leave the default (unfiltered) hierarchy
    await page
      .locator("button", { hasText: "Launched the executive retention dashboard" })
      .first()
      .waitFor({ state: "hidden", timeout: 10000 });
  });

  // ── Release blocker #7: filter combinations on the hierarchy ──────────────
  await check(page, "vault-filter-status-archived", async () => {
    await page.locator("select").first().selectOption("archived");
    await visible(page, "button", "Launched the executive retention dashboard");
    await page.locator("select").first().selectOption("");
  });

  await check(page, "vault-filter-truth-hides-unproven", async () => {
    await page.locator("select").nth(1).selectOption("VERIFIED");
    await page
      .locator("a", { hasText: "Churn forecasting overhaul" })
      .waitFor({ state: "hidden", timeout: 10000 });
    await page.getByRole("button", { name: "clear" }).click();
    await visible(page, "a", "Churn forecasting overhaul");
  });

  await check(page, "vault-filter-employer-and-status-combined", async () => {
    await page.locator("select").first().selectOption("draft");
    await page.locator("select").nth(3).selectOption("DIRECTV");
    await visible(page, "button", "Reduced churn forecast error by 18%"); // wait for filtered render
    const archivedVisible = await page
      .locator("button", { hasText: "Launched the executive retention dashboard" })
      .isVisible()
      .catch(() => false);
    if (archivedVisible) throw new Error("status filter leaked an archived row");
    await page.getByRole("button", { name: "clear" }).click();
  });

  // Principal-surface screenshots (desktop).
  for (const [name, url, probe] of [
    ["home-command", "/home", "evidence health"],
    ["intelligence", "/intelligence", "ai output audit"],
    ["rhythm", "/rhythm", "action queue"],
    ["career-locked", "/career", "maturity"],
    ["decisions-visa", "/decisions/visa", "Gate 1"],
    ["decisions-offers", "/decisions/offers", "Offer Workbench"],
    ["development", "/development", "skills"],
    ["settings", "/settings", "privacy"],
  ]) {
    await check(page, `surface-${name}`, async () => {
      await page.goto(`${BASE}${url}`);
      await visible(page, "body", probe);
    });
  }

  // ── Release blocker #6: database-authoritative maturity + logged override ──
  await check(page, "p1-writes-blocked-at-database-while-locked", async () => {
    const db = await signedClient();
    try {
      const { error } = await db.from("offers").insert({ role_title: "Too early" }).select();
      if (!error || !/row-level security/.test(error.message)) {
        throw new Error(`expected RLS rejection, got: ${error?.message ?? "success"}`);
      }
    } finally {
      await db.auth.signOut();
    }
  });

  await check(page, "settings-owner-override-requires-reason-and-logs", async () => {
    await page.goto(`${BASE}/settings`);
    await visible(page, "h2", "owner dev override");
    page.once("dialog", (d) => d.accept("integration validation run"));
    await page.getByRole("button", { name: "Enable override" }).click();
    await visible(page, "span", "active");
  });

  // ── Release blocker #5: offer acceptance ⇄ Visa Gate 7 (specific offer) ────
  let offerId = null;
  await check(page, "offer-created-after-override", async () => {
    await page.goto(`${BASE}/decisions/offers`);
    await page.getByRole("button", { name: "+ Record offer" }).click();
    await page.getByLabel(/Role title/i).or(page.getByPlaceholder(/role/i)).first().fill("Director, Analytics — OfferCo");
    await page.getByRole("button", { name: "Add record offer" }).click();
    await visible(page, "span", "Director, Analytics — OfferCo");
  });

  await check(page, "offer-accept-blocked-without-gate7", async () => {
    await page.locator("li,button,span", { hasText: "Director, Analytics — OfferCo" }).first().click();
    await page.waitForURL("**/decisions/offers/**", { timeout: 10000 });
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await visible(page, "p", "Gate 7");
  });

  await check(page, "offer-gate7-qualifying-offer-then-accept", async () => {
    const db = await signedClient();
    try {
      const { data: offers } = await db.from("offers").select("*").eq("role_title", "Director, Analytics — OfferCo");
      offerId = offers[0].id;
      // attorney doc ref + gates 1–6 staged through the real API (real triggers)
      await db.from("offers").update({ attorney_reviewed_doc_ref: "attorney-memo-integration.pdf" }).eq("id", offerId);
      const { data: gates } = await db.from("visa_checklist_items").select("*").order("ordinal");
      for (const g of gates.filter((g) => g.ordinal <= 6)) {
        const { error } = await db.from("visa_checklist_items").update({
          status: "complete",
          attorney_confirmed_at: g.attorney_confirmation_required_bool ? new Date().toISOString() : null,
        }).eq("id", g.id);
        if (error) throw new Error(`gate ${g.ordinal}: ${error.message}`);
      }
    } finally {
      await db.auth.signOut();
    }
    await page.reload();
    // both written commitments through the UI
    const boxes = page.locator('section input[type="checkbox"]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByRole("button", { name: "Record attorney review" }).click();
    await visible(page, "span", "reviewed");
    await page.getByRole("button", { name: "Mark as Gate-7 qualifying offer" }).click();
    await visible(page, "button", "✓ Gate-7 qualifying offer");
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await visible(page, "p", "status: accepted");
  });

  // ── Story bank: STAR entry + explicit approval ─────────────────────────────
  await check(page, "story-bank-star-approval", async () => {
    await page.goto(`${BASE}/intelligence/stories`);
    await page.getByRole("button", { name: "+ New STAR story" }).click();
    await page.locator("select").first().selectOption("leadership");
    const areas = page.locator("textarea");
    await areas.nth(0).fill("Churn spiked on the premium tier while leadership debated ownership.");
    await areas.nth(1).fill("Own the cross-team response and the forecast rebuild.");
    await areas.nth(2).fill("Stood up a 3-team working group and shipped weekly retrains.");
    await areas.nth(3).fill("Forecast error down 18%; the board saw a stable retention picture.");
    await page.getByRole("button", { name: "Add new star story" }).click();
    await visible(page, "span", "Churn spiked on the premium tier");
    await page.getByRole("button", { name: "approve", exact: true }).click();
    await visible(page, "span", "approved");
  });

  // ── Archetypes: user-defined target ───────────────────────────────────────
  await check(page, "archetype-created", async () => {
    await page.goto(`${BASE}/intelligence/archetypes`);
    await page.getByRole("button", { name: "+ New archetype" }).click();
    await page.getByPlaceholder(/Director, Analytics @/).fill("Director, Analytics @ Tier-1 Tech");
    await page.getByRole("button", { name: "Add new archetype" }).click();
    await visible(page, "body", "Director, Analytics @ Tier-1 Tech");
  });

  // ── Release blockers #2/#3: asset gate blocks, then generates via the ──────
  // deterministic stub transport (CCC_AI_TRANSPORT=stub on the server), then
  // approval + external use — all through the real UI, API, and database.
  await check(page, "asset-generation-blocked-by-truth-gate", async () => {
    const db = await signedClient();
    let achievementId;
    try {
      const { data } = await db.from("achievements").select("*").eq("headline", "Reduced churn forecast error by 18%");
      achievementId = data[0].id;
    } finally {
      await db.auth.signOut();
    }
    await page.goto(`${BASE}/intelligence/assets`);
    await page.getByRole("button", { name: "+ New asset" }).click();
    const selects = page.locator("form select, dialog select, select");
    await selects.first().selectOption("resume_bullet");
    await selects.nth(1).selectOption(achievementId);
    await page.getByRole("button", { name: "Add new asset" }).click();
    await visible(page, "span", "Reduced churn forecast error by 18%");
    await page.locator("li", { hasText: "resume bullet" }).first().click();
    await page.waitForURL("**/intelligence/assets/**", { timeout: 10000 });
    await page.getByRole("button", { name: "Generate version" }).click();
    // the promoted achievement is still NEEDS_PROOF → the graph gate blocks,
    // the blocked version is recorded with the failing claim named
    await visible(page, "p", "NEEDS_PROOF");
  });

  await check(page, "asset-generates-approves-and-logs-external-use", async () => {
    const db = await signedClient();
    try {
      await db.from("achievements")
        .update({ truth_status: "VERIFIED", privacy_class: "PUBLIC_SAFE" })
        .eq("headline", "Reduced churn forecast error by 18%");
    } finally {
      await db.auth.signOut();
    }
    await page.reload();
    await page.getByRole("button", { name: "Generate version" }).click();
    await visible(page, "p", "[stub] deterministic generated content");
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await visible(page, "span", "approved");
    page.once("dialog", (d) => d.accept("LinkedIn profile"));
    await page.getByRole("button", { name: "log external use" }).click();
    await visible(page, "span", "LinkedIn profile");
    // the record is authoritative: version-exact, and the derived flag flipped
    const audit = await signedClient();
    try {
      const { data: uses } = await audit.from("asset_external_uses").select("*");
      if (!uses?.length) throw new Error("no external-use record was written");
      if (!uses[0].version_fk) throw new Error("external use is not version-exact");
      const { data: assets } = await audit.from("career_assets").select("used_externally_bool");
      if (!assets.some((a) => a.used_externally_bool)) throw new Error("derived flag not set");
      // a forged direct insert must be refused by the database
      const forged = await audit.from("asset_external_uses")
        .insert({ asset_fk: uses[0].asset_fk, version_fk: uses[0].version_fk, destination: "forged" }).select();
      if (!forged.error) throw new Error("forged external use was accepted");
    } finally {
      await audit.auth.signOut();
    }
  });

  // ── Weekly OS: Sunday Review brief ────────────────────────────────────────
  await check(page, "rhythm-sunday-review-brief", async () => {
    await page.goto(`${BASE}/rhythm`);
    await visible(page, "body", "Sunday Review");
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    await visible(page, "body", "Sunday Review —");
  });

  // ── References overlay: willingness enforced by the database ──────────────
  await check(page, "reference-use-blocked-until-willingness-confirmed", async () => {
    const db = await signedClient();
    try {
      const { data: contact, error: ce } = await db.from("contacts")
        .insert({ name: "Jordan Reeves" }).select().single();
      if (ce) throw new Error(`contact: ${ce.message}`);
      const { error: re } = await db.from("references")
        .insert({ contact_fk: contact.id, reference_type: "manager" }).select().single();
      if (re) throw new Error(`reference: ${re.message}`);
      const { error: ae } = await db.from("applications")
        .insert({ role_title: "Director, Analytics — OfferCo" }).select().single();
      if (ae) throw new Error(`application: ${ae.message}`);
    } finally {
      await db.auth.signOut();
    }
    await page.goto(`${BASE}/development`);
    await page.locator("summary", { hasText: "Jordan Reeves" }).click();
    let alertText = "";
    page.once("dialog", async (d) => {
      if (d.type() === "prompt") await d.accept("Director, Analytics — OfferCo");
      else {
        alertText = d.message();
        await d.accept();
      }
    });
    page.once("dialog", async (d) => {
      alertText = d.message();
      await d.accept();
    });
    await page.getByRole("button", { name: /Use for application \(0\)/ }).click();
    await page.waitForTimeout(1500);
    if (!/willingness/.test(alertText)) throw new Error(`expected willingness rejection, got: ${alertText || "(none)"}`);
  });

  await check(page, "reference-use-allowed-once-confirmed", async () => {
    await page.locator("summary", { hasText: "Jordan Reeves" }).locator("select").selectOption("confirmed");
    await visible(page, "span", "confirmed");
    await page.locator("summary", { hasText: "Jordan Reeves" }).click();
    page.once("dialog", (d) => d.accept("Director, Analytics — OfferCo"));
    await page.getByRole("button", { name: /Use for application \(0\)/ }).click();
    await visible(page, "button", "Use for application (1)");
  });


  // ══════════════════════════════════════════════════════════════════════════
  // EXECUTED module workflows.
  //
  // Every step below runs a function from scripts/integration-dataset.mjs —
  // the SAME module tests/integrationContract.test.ts executes against the
  // full PGlite migration chain. A nonexistent column, an invalid enum, a
  // missing required field or a violated constraint therefore fails the
  // hermetic gate on push; it cannot be discovered only here. What this run
  // adds is the real network, real PostgREST, real Supabase Auth and genuine
  // request concurrency.
  // ══════════════════════════════════════════════════════════════════════════
  const withDb = async (fn) => {
    const db = await signedClient();
    try {
      return await fn(db);
    } finally {
      await db.auth.signOut();
    }
  };

  await check(page, "oauth-state-concurrent-claim-exactly-one-wins", async () => {
    await withDb((db) =>
      oauthRaceWorkflow(db, `${BASE}/api/google/callback`, `live-${Date.now().toString(36)}`));
  });

  await check(page, "grader-persistence-ceilings-and-dispute", async () => {
    await withDb(async (db) => {
      const { data } = await db.from("achievements").select("id")
        .eq("headline", "Reduced churn forecast error by 18%");
      await graderWorkflow(db, data[0].id);
      await graderCeilingWorkflow(db, data[0].id);
    });
    await page.goto(`${BASE}/vault`);
    await visible(page, "h2", "DIRECTV");
  });

  let liveIds = {};
  await check(page, "archetype-jd-derived-approval-and-gap-report", async () => {
    liveIds = await withDb(async (db) => {
      const { jdDerived, userDefined, report } = await archetypeWorkflow(db);
      return { archetypeId: userDefined.id, jdArchetypeId: jdDerived.id, gapReportId: report.id };
    });
    await page.goto(`${BASE}/intelligence/archetypes`);
    await visible(page, "body", "Director, Data Platform");
  });

  await check(page, "source-graph-metric-and-evidence-eligibility", async () => {
    liveIds = await withDb(async (db) => {
      const { data: ach } = await db.from("achievements").select("id")
        .eq("headline", "Reduced churn forecast error by 18%");
      const { data: metrics } = await db.from("metrics").select("id").eq("achievement_fk", ach[0].id);
      const { data: evidence } = await db.from("evidence_items").select("id").eq("achievement_fk", ach[0].id);
      const asset = await assetWithSources(db, {
        achievementId: ach[0].id, metricId: metrics[0].id,
        evidenceId: evidence[0].id, archetypeId: liveIds.archetypeId,
      });
      await eligibilityWorkflow(db, {
        assetId: asset.id, metricId: metrics[0].id, evidenceId: evidence[0].id,
      });
      return { ...liveIds, assetId: asset.id, achievementId: ach[0].id };
    });
  });

  await check(page, "collection-version-exact-approve-current-then-invalidated", async () => {
    // Versions are created through the PROTECTED APPLICATION API — the
    // low-level commit RPC is revoked from every browser role, so this is the
    // only path a client has.
    const createVersionViaApi = async (assetId) => {
      const db = await signedClient();
      try {
        const token = (await db.auth.getSession()).data.session.access_token;
        const res = await fetch(`${BASE}/api/assets/manual-version`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            assetId,
            content: "Cut churn forecast error 18% across a 3-team rebuild.",
            // deliberately included and expected to be IGNORED by the route
            privacy_class: "PUBLIC_SAFE",
            truth_status_summary: "VERIFIED,forged",
            generated_by_model: "gpt-fake",
          }),
        });
        const body = await res.json();
        if (!res.ok || !body.version) throw new Error(`manual-version route: ${body.error ?? res.status}`);
        if (body.version.generated_by_model !== "") {
          throw new Error("the route accepted browser-supplied model metadata");
        }
        return body.version;
      } finally {
        await db.auth.signOut();
      }
    };
    liveIds = await withDb(async (db) => {
      const { version, collection } = await collectionWorkflow(db, {
        assetId: liveIds.assetId, achievementId: liveIds.achievementId,
        createVersion: createVersionViaApi,
      });
      return { ...liveIds, versionId: version.id, collectionId: collection.id };
    });
    await page.goto(`${BASE}/intelligence/assets`);
    await visible(page, "body", "Resume — Director");
  });

  await check(page, "direct-postgrest-bypass-attempts-are-refused", async () => {
    const refusals = await withDb((db) => bypassAttempts(db, liveIds));
    if (refusals.length < 13) throw new Error(`expected the full bypass matrix, got ${refusals.length}`);
    if (!refusals.includes("call ccc_commit_asset_version as an authenticated browser client")) {
      throw new Error("the low-level commit RPC was reachable by a browser client");
    }
  });

  await check(page, "p1-company-contact-outreach-referral-application-interview-debrief", async () => {
    await withDb(async (db) => {
      await enableOverride(db, "integration run");
      await p1Workflow(db);
    });
    await page.goto(`${BASE}/career`);
    await visible(page, "body", "Meridian Data");
  });

  await check(page, "benchmark-scenario-and-counter-proposal", async () => {
    await withDb(async (db) => {
      const { data: offers } = await db.from("offers").select("id").limit(1);
      await offerWorkbenchWorkflow(db, { offerId: offers[0].id, archetypeId: liveIds.archetypeId });
    });
    await page.goto(`${BASE}/decisions/benchmarks`);
    await visible(page, "body", "Director, Analytics");
  });

  await check(page, "skill-evidence-plan-progress-and-stale-detection", async () => {
    await withDb((db) =>
      skillsWorkflow(db, { achievementId: liveIds.achievementId, gapReportId: liveIds.gapReportId }));
    await page.goto(`${BASE}/development`);
    await visible(page, "body", "Platform architecture");
  });

  await check(page, "monthly-board-review-executed", async () => {
    await withDb((db) => monthlyBoardWorkflow(db, new Date().toISOString().slice(0, 10)));
    await page.goto(`${BASE}/rhythm`);
    await visible(page, "body", "Monthly Board");
  });

  await check(page, "maturity-regression-revokes-p1-without-any-recompute", async () => {
    await withDb((db) => maturityRegressionWorkflow(db));
  });

  await check(page, "mobile-vault-and-quicklog", async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${BASE}/vault`);
    await visible(page, "h2", "DIRECTV");
    await page.getByRole("button", { name: "Quick log achievement" }).click();
    const focusedPlaceholder = await page.evaluate(() => document.activeElement?.getAttribute("placeholder") ?? "");
    if (!/Achievement headline/.test(focusedPlaceholder)) throw new Error("mobile capture did not focus quick log");
  });

  console.log("\n== REAL INTEGRATION SUMMARY ==");
  for (const r of results) console.log(r);
  const passed = results.filter((r) => r.startsWith("PASS")).length;
  console.log(`${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exit(1);
} finally {
  await wipe().catch((e) => console.error(`cleanup failed: ${e.message}`));
  await browser.close();
}
