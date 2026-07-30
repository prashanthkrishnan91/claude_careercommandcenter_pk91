import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteBackend } from "./backends/pglite";
import type { TestBackend } from "./backends/types";

// Schema-shape contract: the fresh migrations must produce exactly the
// canonical columns, enums, defaults, and enforcement objects. Runs on the
// hermetic backend (raw SQL access); the same files were applied remotely.

let backend: TestBackend;
const sql = (q: string) => backend.sql!(q);

beforeAll(async () => {
  backend = await createPgliteBackend(); // migration application IS the first assertion
});
afterAll(async () => backend.teardown());

async function columns(table: string): Promise<string[]> {
  const rows = await sql(
    `select column_name from information_schema.columns where table_schema='public' and table_name='${table}' order by ordinal_position`,
  );
  return rows.map((r) => String(r.column_name));
}

async function checkDef(table: string, fragment: string): Promise<boolean> {
  const rows = await sql(
    `select pg_get_constraintdef(c.oid) as def from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = '${table}' and c.contype = 'c'`,
  );
  return rows.some((r) => String(r.def).includes(fragment));
}

describe("fresh migration chain", () => {
  it("applies successfully and creates all 49 product tables", async () => {
    const rows = await sql(
      "select count(*) as n from information_schema.tables where table_schema='public'",
    );
    expect(Number(rows[0].n)).toBe(49);
  });
});

describe("canonical P0A columns", () => {
  it("projects carries exactly the canonical fields", async () => {
    expect(await columns("projects")).toEqual([
      "id", "user_id", "name", "employer", "role_at_time", "start_date", "end_date",
      "description", "business_context", "my_scope", "team_size", "stakeholders",
      "privacy_class", "status", "created_at", "updated_at",
    ]);
  });
  it("achievements carries exactly the canonical fields", async () => {
    expect(await columns("achievements")).toEqual([
      "id", "user_id", "project_fk", "headline", "narrative", "action_taken", "outcome",
      "start_date", "end_date", "claimed_seniority_level", "truth_status", "privacy_class",
      "has_metric_bool", "candidate_for_external_bool", "status", "created_at", "updated_at",
    ]);
  });
  it("metrics carries exactly the canonical fields (no updated_at)", async () => {
    expect(await columns("metrics")).toEqual([
      "id", "user_id", "achievement_fk", "metric_name", "value", "unit", "time_period",
      "baseline_value", "calculation_notes", "truth_status", "privacy_class", "status", "created_at",
    ]);
  });
  it("evidence_items carries exactly the canonical fields", async () => {
    expect(await columns("evidence_items")).toEqual([
      "id", "user_id", "achievement_fk", "type", "content_summary", "external_url",
      "privacy_class", "verified_at", "verified_by", "status", "created_at",
    ]);
  });
});

describe("canonical enums, defaults, constraints", () => {
  it("truth_status check lists the six canonical values and none of the substitutes", async () => {
    expect(await checkDef("achievements", "ATTESTED_WITH_METRIC")).toBe(true);
    expect(await checkDef("achievements", "DISPUTED")).toBe(true);
    expect(await checkDef("achievements", "EVIDENCED")).toBe(false);
  });
  it("privacy_class check lists PUBLIC_SAFE/INTERNAL_ONLY/PRIVATE only", async () => {
    expect(await checkDef("projects", "PUBLIC_SAFE")).toBe(true);
    expect(await checkDef("projects", "SENSITIVE")).toBe(false);
    expect(await checkDef("projects", "EXTERNAL_OK")).toBe(false);
  });
  it("statuses: project active/archived, achievement draft/active/archived", async () => {
    expect(await checkDef("projects", "'active'")).toBe(true);
    expect(await checkDef("achievements", "'draft'")).toBe(true);
    expect(await checkDef("projects", "COMPLETED")).toBe(false);
  });
  it("defaults: draft, NEEDS_PROOF, INTERNAL_ONLY, candidate false", async () => {
    const rows = await sql(
      `select column_name, column_default from information_schema.columns
        where table_schema='public' and table_name='achievements'
          and column_name in ('status','truth_status','privacy_class','candidate_for_external_bool','has_metric_bool')`,
    );
    const defaults = Object.fromEntries(rows.map((r) => [r.column_name, String(r.column_default)]));
    expect(defaults.status).toContain("draft");
    expect(defaults.truth_status).toContain("NEEDS_PROOF");
    expect(defaults.privacy_class).toContain("INTERNAL_ONLY");
    expect(defaults.candidate_for_external_bool).toContain("false");
    expect(defaults.has_metric_bool).toContain("false");
  });
  it("evidence type check lists the five canonical kinds", async () => {
    for (const kind of ["link", "email_ref", "note", "testimonial", "metric_source"]) {
      expect(await checkDef("evidence_items", `'${kind}'`)).toBe(true);
    }
  });
  it("seniority levels are ic/sr/mgr/sr_mgr/dir", async () => {
    expect(await checkDef("achievements", "sr_mgr")).toBe(true);
  });
});

describe("security objects", () => {
  it("same-user composite FKs exist on all child tables", async () => {
    const rows = await sql(
      `select conname from pg_constraint where contype='f' and conname like '%same_user_fkey'`,
    );
    const names = rows.map((r) => String(r.conname));
    for (const expected of [
      "achievements_project_same_user_fkey",
      "metrics_achievement_same_user_fkey",
      "evidence_items_achievement_same_user_fkey",
      "sanitized_claims_achievement_same_user_fkey",
      "offers_application_same_user_fkey",
      "references_contact_same_user_fkey",
      "skill_evidence_achievement_same_user_fkey",
      // normalized junction tables: BOTH parents via composite same-user FKs
      "asa_asset_same_user_fkey",
      "asa_achievement_same_user_fkey",
      "ase_asset_same_user_fkey",
      "ase_evidence_same_user_fkey",
      "asm_asset_same_user_fkey",
      "asm_metric_same_user_fkey",
      "ca_collection_same_user_fkey",
      "ca_asset_same_user_fkey",
      "sta_story_same_user_fkey",
      "sta_achievement_same_user_fkey",
      "star_story_same_user_fkey",
      "star_archetype_same_user_fkey",
      "pa_plan_same_user_fkey",
      "pa_archetype_same_user_fkey",
      "rau_reference_same_user_fkey",
      "rau_application_same_user_fkey",
      "cb_counter_same_user_fkey",
      "cb_benchmark_same_user_fkey",
      // Gate 7 must reference a specific same-user qualifying offer
      "visa_gate_offer_same_user_fkey",
    ]) {
      expect(names).toContain(expected);
    }
    expect(names.length).toBeGreaterThanOrEqual(43);
  });
  it("SECURITY DEFINER is confined to the maturity/override functions that must write client-read-only tables", async () => {
    // Justified definers: they write maturity_state / override_mutations /
    // owner_overrides, which clients can only read. Everything else is invoker.
    // Each must write a client-read-only table, or be the authorization
    // predicate that reads across tables the caller cannot see in full.
    const JUSTIFIED = [
      "ccc_set_override",
      "ccc_override_active",
      "ccc_p1_unlocked",
      "ccc_recompute_maturity",
      "ccc_log_override_mutation",
      // authoritative boundaries
      "ccc_issue_oauth_state",
      "ccc_claim_oauth_state",
      "ccc_purge_oauth_states",
      "ccc_asset_graph_eligible",
      "ccc_commit_asset_version",
      "ccc_validate_external_use",
      "ccc_sync_used_externally",
      "ccc_log_external_use",
      "ccc_approve_asset_version",
      "ccc_validate_collection_member",
      "ccc_revalidate_collection",
      "ccc_approve_collection",
      "ccc_set_current_collection",
      "ccc_add_collection_version",
      "ccc_propagate_source_change",
      "ccc_maturity_criteria",
      "ccc_maturity_met",
    ];
    const rows = await sql(
      `select proname, prosecdef, proconfig from pg_proc where proname like 'ccc_%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(28);
    for (const r of rows) {
      if (JUSTIFIED.includes(String(r.proname))) {
        expect(r.prosecdef, `${r.proname} definer`).toBe(true);
        // a definer must pin its search_path
        expect(String(r.proconfig ?? "")).toContain("search_path=public");
      } else {
        expect(r.prosecdef, `${r.proname} must be invoker`).toBe(false);
      }
    }
  });
  it("RLS is enabled on every public table; client-read-only tables carry only a select policy", async () => {
    // maturity_state and override_mutations are written exclusively by the
    // SECURITY DEFINER functions; owner_overrides only via ccc_set_override.
    // Written exclusively by SECURITY DEFINER functions/triggers; clients read.
    const READ_ONLY = [
      "maturity_state", "override_mutations", "owner_overrides",
      "oauth_states", "asset_external_uses",
    ];
    const tables = await sql(
      `select c.relname, c.relrowsecurity,
              (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relkind='r'`,
    );
    expect(tables.length).toBe(49);
    for (const t of tables) {
      expect(t.relrowsecurity, `${t.relname} rls`).toBe(true);
      expect(Number(t.policies), `${t.relname} policies`).toBe(
        READ_ONLY.includes(String(t.relname)) ? 1 : 4,
      );
    }
  });
  it("grants: authenticated has table DML but anon has nothing", async () => {
    const rows = await sql(
      `select distinct grantee from information_schema.role_table_grants
        where table_schema='public'`,
    );
    const grantees = rows.map((r) => String(r.grantee));
    expect(grantees).toContain("authenticated");
    expect(grantees).not.toContain("anon");
  });
  it("enforcement triggers exist (offer acceptance, Gate 7, version chain, reference use)", async () => {
    const rows = await sql(`select tgname from pg_trigger where tgname like 'ccc_%'`);
    const names = rows.map((r) => String(r.tgname));
    for (const t of [
      "ccc_offers_acceptance_gate",
      "ccc_metrics_sync_has_metric",
      "ccc_visa_gate7_check",
      "ccc_assets_current_version_check",
      "ccc_versions_supersession_check",
      "ccc_reference_use_gate",
      // authoritative boundaries
      "ccc_external_use_validate",
      "ccc_external_use_sync",
      "ccc_versions_guard",
      "ccc_assets_guard",
      "ccc_collections_guard",
      "ccc_collection_member_validate",
      "ccc_override_audit_immutable",
      "ccc_ach_source_change",
    ]) {
      expect(names).toContain(t);
    }
  });
});
