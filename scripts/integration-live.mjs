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

// Cleanup through the API as the test user (isolated test tooling).
async function wipe() {
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { error } = await db.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error(`cleanup sign-in failed: ${error.message}`);
  await db.from("career_assets").update({ current_version_fk: null }).gte("created_at", "1970-01-01");
  for (const t of [
    "asset_versions", "ingested_items", "ingestion_runs", "google_connections", "owner_overrides",
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
