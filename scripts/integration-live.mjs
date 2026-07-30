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
  await db.from("career_assets").update({ current_version_fk: null }).gte("created_at", "1970-01-01");
  for (const t of [
    // junction tables cascade from their parents, but delete them explicitly
    // so a partial parent wipe can never leave orphaned links behind
    "asset_external_uses", "oauth_states",
    "reference_application_uses", "counter_benchmarks", "collection_assets",
    "asset_source_achievements", "asset_source_evidence", "asset_source_metrics",
    "story_achievements", "story_archetypes", "plan_archetypes",
    "asset_versions", "ingested_items", "ingestion_runs", "google_connections",
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
  // EXECUTED module workflows. These drive the real production bundle and the
  // real Supabase project (no interception): the UI where the UI is the
  // subject, PostgREST where the workflow is data + enforcement. Every
  // assertion checks persisted state or a database refusal — never a title.
  // ══════════════════════════════════════════════════════════════════════════

  // ── OAuth state: concurrent replay at the real storage boundary ───────────
  await check(page, "oauth-state-concurrent-claim-exactly-one-wins", async () => {
    const db = await signedClient();
    try {
      const hash = `live-${Date.now().toString(36)}`;
      const issued = await db.rpc("ccc_issue_oauth_state", {
        p_nonce_hash: hash, p_provider: "gmail",
        p_redirect_uri: `${BASE}/api/google/callback`,
        p_code_verifier_encrypted: "enc-v", p_session_binding_encrypted: "enc-s",
        p_ttl_seconds: 600,
      });
      if (issued.error) throw new Error(`issue failed: ${issued.error.message}`);
      // eight genuinely parallel HTTP round-trips against Postgres
      const claims = await Promise.all(
        Array.from({ length: 8 }, () => db.rpc("ccc_claim_oauth_state", { p_nonce_hash: hash })),
      );
      const wins = claims.filter((c) => c.data?.claimed).length;
      if (wins !== 1) throw new Error(`expected exactly one winning claim, got ${wins}`);
      const forged = await db.from("oauth_states")
        .insert({ nonce_hash: "forged", provider: "gmail", redirect_uri: "x", code_verifier_encrypted: "y", expires_at: new Date(Date.now() + 60000).toISOString() })
        .select();
      if (!forged.error) throw new Error("client wrote oauth_states directly");
    } finally {
      await db.auth.signOut();
    }
  });

  // ── Grader: persistence, ceilings, dispute, director signal ───────────────
  await check(page, "grader-evaluation-persists-with-ceilings-and-dispute", async () => {
    const db = await signedClient();
    let achievementId;
    try {
      const { data } = await db.from("achievements").select("id").eq("headline", "Reduced churn forecast error by 18%");
      achievementId = data[0].id;
    } finally {
      await db.auth.signOut();
    }
    await page.goto(`${BASE}/vault/achievements/${achievementId}`);
    await page.getByRole("button", { name: /Grade|Re-grade/ }).first().click();
    await visible(page, "body", "quantified business impact");
    const verify = await signedClient();
    try {
      const { data: evals } = await verify.from("grader_evaluations").select("*").eq("achievement_fk", achievementId);
      if (!evals?.length) throw new Error("no grader evaluation persisted");
      const dims = evals[0].dimensions;
      if (!Array.isArray(dims) || dims.length !== 7) throw new Error(`expected 7 dimensions, got ${dims?.length}`);
      if (!dims.every((d) => d.rationale)) throw new Error("a dimension is missing its rationale");
      // director signal is computed from the stored evaluation, not asserted by the model
      const crit = await verify.rpc("ccc_maturity_criteria", { uid: (await verify.auth.getUser()).data.user.id });
      if (typeof crit.data?.director_5?.met !== "boolean") throw new Error("director signal not computed");
      // ceilings: an ATTESTED_NO_METRIC source caps impact/evidence at 3
      await verify.from("achievements").update({ truth_status: "ATTESTED_NO_METRIC" }).eq("id", achievementId);
    } finally {
      await verify.auth.signOut();
    }
    await page.reload();
    await page.getByRole("button", { name: /Grade|Re-grade/ }).first().click();
    await page.waitForTimeout(2000);
    const ceil = await signedClient();
    try {
      const { data: evals } = await ceil.from("grader_evaluations")
        .select("*").eq("achievement_fk", achievementId).order("evaluated_at", { ascending: false });
      const dims = evals[0].dimensions;
      const capped = dims.filter((d) => ["quantified_business_impact", "evidence_quality"].includes(d.dimension));
      if (capped.some((d) => d.score > 3)) throw new Error("ATTESTED_NO_METRIC ceiling was not applied");
      await ceil.from("achievements").update({ truth_status: "VERIFIED" }).eq("id", achievementId);
      // dispute is recorded on the evaluation, not silently discarded
      const disputed = await ceil.from("grader_evaluations")
        .update({ user_disputed_bool: true, user_dispute_note: "scope understated" }).eq("id", evals[0].id).select();
      if (disputed.error) throw new Error(`dispute failed: ${disputed.error.message}`);
    } finally {
      await ceil.auth.signOut();
    }
  });

  // ── Archetypes (user-defined + JD-derived), comparator, gap report ────────
  await check(page, "archetype-jd-derived-approval-comparator-and-gap-report", async () => {
    const db = await signedClient();
    let archId;
    try {
      // a JD-derived archetype with retained raw JD text
      const { data: arch, error } = await db.from("target_archetypes")
        .insert({ name: "Director, Data Platform", source_type: "jd_derived", required_skills: ["platform", "forecasting", "org leadership"] })
        .select().single();
      if (error) throw new Error(`archetype: ${error.message}`);
      archId = arch.id;
      const src = await db.from("archetype_sources").insert({
        archetype_fk: archId, source_type: "pasted_jd",
        raw_content: "RAW-JD-TEXT retained for 90 days unless pinned",
        parsed_summary: "Director, Data Platform — multi-team scope",
      }).select();
      if (src.error) throw new Error(`archetype source: ${src.error.message}`);
    } finally {
      await db.auth.signOut();
    }
    // approval happens in the UI, and the comparator refuses unapproved archetypes
    await page.goto(`${BASE}/intelligence/archetypes/${archId}`);
    await visible(page, "body", "Director, Data Platform");
    await page.getByRole("button", { name: /Approve/ }).first().click();
    await visible(page, "body", /approved/i);
    await page.getByRole("button", { name: /Run comparator|Compare/ }).first().click();
    await page.waitForTimeout(2500);
    const verify = await signedClient();
    try {
      const { data: reports } = await verify.from("gap_reports").select("*").eq("archetype_fk", archId);
      if (!reports?.length) throw new Error("comparator did not persist a gap report");
      const r = reports[0];
      if (!Array.isArray(r.gap_dimensions) || !Array.isArray(r.covered_dimensions)) {
        throw new Error("gap report is not structured");
      }
      const { data: arch } = await verify.from("target_archetypes").select("*").eq("id", archId).single();
      if (!arch.approved_by_user_bool) throw new Error("approval did not persist");
      if (arch.source_type !== "jd_derived") throw new Error("JD provenance lost");
    } finally {
      await verify.auth.signOut();
    }
  });

  // ── Source-graph metric and evidence eligibility, at the database ─────────
  await check(page, "source-graph-metric-and-evidence-eligibility", async () => {
    const db = await signedClient();
    try {
      const { data: assets } = await db.from("career_assets").select("id").limit(1);
      const assetId = assets[0].id;
      const { data: ach } = await db.from("achievements").select("id").eq("headline", "Reduced churn forecast error by 18%");
      const { data: metrics } = await db.from("metrics").select("id").eq("achievement_fk", ach[0].id);
      const { data: evidence } = await db.from("evidence_items").select("id").eq("achievement_fk", ach[0].id);

      // attach the metric and the evidence item as explicit sources
      await db.from("asset_source_metrics").insert({ asset_fk: assetId, metric_fk: metrics[0].id });
      await db.from("asset_source_evidence").insert({ asset_fk: assetId, evidence_fk: evidence[0].id });

      // UNVERIFIED evidence must block, with the exact reason
      await db.from("evidence_items").update({ verified_at: null, verified_by: null }).eq("id", evidence[0].id);
      let verdict = await db.rpc("ccc_asset_graph_eligible", { p_asset: assetId });
      if (verdict.data.eligible) throw new Error("unverified evidence was accepted");
      if (!JSON.stringify(verdict.data.reasons).includes("Unverified evidence")) {
        throw new Error(`unexpected reason: ${JSON.stringify(verdict.data.reasons)}`);
      }
      // verifying it clears the block
      await db.from("evidence_items")
        .update({ verified_at: new Date().toISOString(), verified_by: "manager" }).eq("id", evidence[0].id);
      verdict = await db.rpc("ccc_asset_graph_eligible", { p_asset: assetId });
      if (!verdict.data.eligible) throw new Error(`still blocked: ${JSON.stringify(verdict.data.reasons)}`);

      // an INTERNAL_ONLY metric blocks; restoring it clears the block
      await db.from("metrics").update({ privacy_class: "INTERNAL_ONLY" }).eq("id", metrics[0].id);
      verdict = await db.rpc("ccc_asset_graph_eligible", { p_asset: assetId });
      if (verdict.data.eligible) throw new Error("INTERNAL_ONLY metric was accepted");
      await db.from("metrics").update({ privacy_class: "PUBLIC_SAFE", truth_status: "VERIFIED" }).eq("id", metrics[0].id);
    } finally {
      await db.auth.signOut();
    }
  });

  // ── Version-specific collections: create, approve, current, invalidate ────
  await check(page, "collection-version-exact-approve-current-then-invalidated", async () => {
    const db = await signedClient();
    try {
      const uid = (await db.auth.getUser()).data.user.id;
      const { data: versions } = await db.from("asset_versions")
        .select("*").eq("approved_by_user_bool", true).limit(1);
      if (!versions?.length) throw new Error("no approved version to package");
      const version = versions[0];
      const { data: coll, error: ce } = await db.from("asset_collections")
        .insert({ name: "Resume — Director", collection_type: "resume_version" }).select().single();
      if (ce) throw new Error(`collection: ${ce.message}`);

      // membership must be version-exact and validated
      const noVersion = await db.from("collection_assets")
        .insert({ collection_fk: coll.id, asset_fk: version.asset_fk }).select();
      if (!noVersion.error) throw new Error("membership without a version was accepted");
      const added = await db.rpc("ccc_add_collection_version", { p_collection: coll.id, p_version: version.id });
      if (added.error) throw new Error(`add version: ${added.error.message}`);

      // approval + current selection are server-only and revalidate
      const forged = await db.from("asset_collections")
        .update({ approved_by_user_bool: true }).eq("id", coll.id).select();
      if (!forged.error) throw new Error("direct collection approval was accepted");
      const ok = await db.rpc("ccc_approve_collection", { p_collection: coll.id });
      if (ok.error) throw new Error(`approve: ${ok.error.message}`);
      const cur = await db.rpc("ccc_set_current_collection", { p_collection: coll.id });
      if (cur.error) throw new Error(`set current: ${cur.error.message}`);

      let crit = await db.rpc("ccc_maturity_criteria", { uid });
      if (!crit.data.collection_current.met) throw new Error("collection criterion did not become met");

      // a source regresses → membership goes stale and the criterion fails
      const { data: links } = await db.from("asset_source_achievements").select("achievement_fk").eq("asset_fk", version.asset_fk);
      await db.from("achievements").update({ truth_status: "DISPUTED" }).eq("id", links[0].achievement_fk);
      const { data: members } = await db.from("collection_assets").select("*").eq("collection_fk", coll.id);
      if (!members[0].membership_stale_bool) throw new Error("membership was not marked stale");
      crit = await db.rpc("ccc_maturity_criteria", { uid });
      if (crit.data.collection_current.met) throw new Error("criterion still met with a stale member");
      const reCurrent = await db.rpc("ccc_set_current_collection", { p_collection: coll.id });
      if (!reCurrent.error) throw new Error("a stale collection was allowed to become current");
      await db.from("achievements").update({ truth_status: "VERIFIED" }).eq("id", links[0].achievement_fk);
    } finally {
      await db.auth.signOut();
    }
  });

  // ── P1 distribution: the full relationship chain ──────────────────────────
  await check(page, "p1-company-contact-outreach-referral-application-interview-debrief", async () => {
    const db = await signedClient();
    try {
      const mk = async (table, values) => {
        const { data, error } = await db.from(table).insert(values).select().single();
        if (error) throw new Error(`${table}: ${error.message}`);
        return data;
      };
      const company = await mk("companies", { name: "Meridian Data", visa_sponsorship_history: "sponsors" });
      const contact = await mk("contacts", { name: "Alex Rivera", company_fk: company.id, role_title: "VP Analytics" });
      await mk("outreach", { contact_fk: contact.id, channel: "linkedin_message", message_summary: "intro re: platform role" });
      const application = await mk("applications", { role_title: "Director, Analytics — Meridian", company_fk: company.id });
      await mk("referrals", { contact_fk: contact.id, application_fk: application.id, status: "requested" });
      const interview = await mk("interviews", {
        application_fk: application.id, round_name: "Hiring manager", scheduled_at: new Date().toISOString(),
      });
      const debrief = await db.from("interviews")
        .update({ debrief_notes: "Scope questions went well; asked for platform depth.", went_well: "narrative", to_improve: "metric recall" })
        .eq("id", interview.id).select().single();
      if (debrief.error) throw new Error(`debrief: ${debrief.error.message}`);
      if (!debrief.data.debrief_notes) throw new Error("debrief did not persist");
      // relationships resolve
      const { data: apps } = await db.from("applications").select("*").eq("id", application.id).single();
      if (apps.company_fk !== company.id) throw new Error("application → company link lost");
      // cross-user integrity is enforced at the database
      const orphan = await db.from("applications").insert({ role_title: "x", company_fk: "00000000-0000-0000-0000-000000000000" }).select();
      if (!orphan.error) throw new Error("a dangling company link was accepted");
    } finally {
      await db.auth.signOut();
    }
    await page.goto(`${BASE}/career`);
    await visible(page, "body", "Meridian Data");
  });

  // ── Comp benchmark + offer scenario + counter proposal ────────────────────
  await check(page, "benchmark-scenario-and-counter-proposal", async () => {
    const db = await signedClient();
    try {
      const { data: bench, error: be } = await db.from("comp_benchmarks")
        .insert({ role_title: "Director, Analytics", source: "levels_fyi", base_low: 210000, base_high: 265000, geography: "US remote" })
        .select().single();
      if (be) throw new Error(`benchmark: ${be.message}`);
      const { data: offers } = await db.from("offers").select("id").limit(1);
      const offerId = offers[0].id;
      const { data: scenario, error: se } = await db.from("offer_scenarios")
        .insert({ offer_fk: offerId, scenario_name: "conservative / stock flat", total_comp_yr1: 289000, total_comp_yr4: 312000, assumptions: ["no refresh", "flat stock"] })
        .select().single();
      if (se) throw new Error(`scenario: ${se.message}`);
      if (Number(scenario.total_comp_yr1) !== 289000) throw new Error("scenario snapshot not stored verbatim");
      const { data: counter, error: ce } = await db.from("counter_proposals")
        .insert({ offer_fk: offerId, rationale: "Base below the benchmark midpoint for this scope." })
        .select().single();
      if (ce) throw new Error(`counter: ${ce.message}`);
      const link = await db.from("counter_benchmarks")
        .insert({ counter_fk: counter.id, benchmark_fk: bench.id }).select();
      if (link.error) throw new Error(`counter↔benchmark: ${link.error.message}`);
      const staged = await db.from("counter_proposals")
        .update({ sent_at: new Date().toISOString().slice(0, 10), outcome: "partially_accepted" })
        .eq("id", counter.id).select().single();
      if (staged.error) throw new Error(`counter outcome: ${staged.error.message}`);
    } finally {
      await db.auth.signOut();
    }
    await page.goto(`${BASE}/decisions/benchmarks`);
    await visible(page, "body", "Director, Analytics");
  });

  // ── Skills: evidence link, plan, progress, stale detection ────────────────
  await check(page, "skill-evidence-plan-progress-and-stale-detection", async () => {
    const db = await signedClient();
    try {
      const { data: skill, error: se } = await db.from("skills")
        .insert({ name: "Platform architecture", current_level: "developing", target_level: "strong", gap_source: "archetype_comparator" })
        .select().single();
      if (se) throw new Error(`skill: ${se.message}`);
      const { data: ach } = await db.from("achievements").select("id").limit(1);
      const link = await db.from("skill_evidence")
        .insert({ skill_fk: skill.id, achievement_fk: ach[0].id }).select();
      if (link.error) throw new Error(`skill evidence: ${link.error.message}`);
      const { data: plan, error: pe } = await db.from("skill_development_plans")
        .insert({ skill_fk: skill.id, approach: "Lead the platform consolidation workstream", target_date: "2026-12-31" })
        .select().single();
      if (pe) throw new Error(`plan: ${pe.message}`);
      const prog = await db.from("skill_development_progress")
        .insert({ plan_fk: plan.id, note: "Kicked off the workstream", recorded_at: new Date().toISOString() }).select();
      if (prog.error) throw new Error(`progress: ${prog.error.message}`);
      // stale detection: a plan with no progress for 60+ days must surface
      const old = new Date(Date.now() - 75 * 86400000).toISOString();
      await db.from("skill_development_progress").update({ recorded_at: old }).eq("plan_fk", plan.id);
      await db.from("skill_development_plans").update({ updated_at: old }).eq("id", plan.id);
    } finally {
      await db.auth.signOut();
    }
    await page.goto(`${BASE}/development`);
    await visible(page, "body", "Platform architecture");
    await visible(page, "body", /stale|no progress/i);
  });

  // ── Monthly Board Review ──────────────────────────────────────────────────
  await check(page, "monthly-board-review-executed", async () => {
    await page.goto(`${BASE}/rhythm`);
    await visible(page, "body", "Monthly Board");
    const row = page.locator("div", { hasText: "Monthly Board" }).last();
    await row.getByRole("button", { name: /Run|mark reviewed|reviewed/i }).first().click();
    await page.waitForTimeout(2000);
    const db = await signedClient();
    try {
      const { data: briefs } = await db.from("weekly_briefs").select("*").eq("brief_type", "monthly_board");
      if (!briefs?.length) throw new Error("no monthly board brief persisted");
      if (!briefs.some((b) => b.content_markdown?.length > 0)) throw new Error("monthly board brief has no content");
      const uid = (await db.auth.getUser()).data.user.id;
      const crit = await db.rpc("ccc_maturity_criteria", { uid });
      if (typeof crit.data.monthly_board.met !== "boolean") throw new Error("monthly board criterion not computed");
    } finally {
      await db.auth.signOut();
    }
  });

  // ── Maturity regression after unlock, with no recompute call ──────────────
  await check(page, "maturity-regression-revokes-p1-without-any-recompute", async () => {
    const db = await signedClient();
    try {
      // unlocked (the override is active from the earlier step)
      const before = await db.from("companies").insert({ name: "Still Unlocked" }).select();
      if (before.error) throw new Error(`expected unlocked write to succeed: ${before.error.message}`);
      // regress the authorization source directly, then write again WITHOUT
      // calling ccc_recompute_maturity and without loading any page
      await db.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: false, p_reason: "integration regression check" });
      const after = await db.from("companies").insert({ name: "Should Be Blocked" }).select();
      if (!after.error || !/row-level security/.test(after.error.message)) {
        throw new Error(`expected an RLS refusal, got: ${after.error?.message ?? "success"}`);
      }
      // the audit trail recorded the override-era mutations with their reason
      const { data: audit } = await db.from("override_mutations").select("*");
      if (!audit?.length) throw new Error("override mutations were not audited");
      if (!audit.every((r) => r.reason_snapshot)) throw new Error("audit rows lack an immutable reason snapshot");
      await db.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: true, p_reason: "integration continue" });
    } finally {
      await db.auth.signOut();
    }
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
