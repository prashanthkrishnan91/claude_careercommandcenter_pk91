import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../../lib/config";
import type { TestBackend, TestUserCtx } from "./types";

// Live backend: signs in to the real Supabase project as two dedicated CI
// test accounts. Credentials come EXCLUSIVELY from the environment (GitHub
// Secrets in CI) — there are no fallback values anywhere in this repository,
// and the suite fails closed when they are absent.

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `live backend: required environment variable ${name} is not set. ` +
        "Live tests fail closed without CCC_TEST_EMAIL_A, CCC_TEST_EMAIL_B, and CCC_TEST_PASSWORD.",
    );
  }
  return value;
}

// Cleanup deletes children before parents (test tooling only — the product
// itself has no delete path; lifecycle is archival).
const TABLES = [
  "ingested_items", "ingestion_runs", "google_connections", "owner_overrides",
  "references", "skill_development_progress", "skill_development_plans",
  "skill_evidence", "skills", "counter_proposals", "offer_scenarios", "offers",
  "comp_benchmarks", "interviews", "referrals", "outreach", "applications",
  "contacts", "companies", "ai_outputs", "action_items", "weekly_briefs",
  "visa_checklist_items", "story_bank", "asset_collections", "career_assets",
  "gap_reports", "archetype_sources", "target_archetypes", "grader_evaluations",
  "sanitized_claims", "evidence_items", "metrics", "achievements", "projects",
] as const;

async function signIn(email: string, password: string): Promise<TestUserCtx> {
  const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`live backend: sign-in failed for ${email}: ${error?.message}`);
  }
  return { db, userId: data.user.id };
}

async function wipeOwnRows(ctx: TestUserCtx): Promise<void> {
  for (const table of TABLES) {
    if (table === "career_assets") {
      // Break the current_version_fk ↔ asset_versions cycle first.
      await ctx.db.from("career_assets").update({ current_version_fk: null }).gte("created_at", "1970-01-01");
      await ctx.db.from("asset_versions").delete().gte("created_at", "1970-01-01");
    }
    const { error } = await ctx.db.from(table).delete().gte("created_at", "1970-01-01");
    if (error) throw new Error(`live backend: cleanup of ${table} failed: ${error.message}`);
  }
}

export async function createLiveBackend(): Promise<TestBackend> {
  const password = requiredEnv("CCC_TEST_PASSWORD");
  const userA = await signIn(requiredEnv("CCC_TEST_EMAIL_A"), password);
  const userB = await signIn(requiredEnv("CCC_TEST_EMAIL_B"), password);
  return {
    name: `live (${SUPABASE_URL})`,
    userA,
    userB,
    async cleanup() {
      await wipeOwnRows(userA);
      await wipeOwnRows(userB);
    },
    async teardown() {
      await userA.db.auth.signOut();
      await userB.db.auth.signOut();
    },
  };
}
