import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TestBackend, TestUserCtx } from "./types";

const MIGRATIONS = [
  path.resolve(__dirname, "../../supabase/migrations/20260730000100_p0a_canonical_schema.sql"),
  path.resolve(__dirname, "../../supabase/migrations/20260730002000_full_product_schema.sql"),
  path.resolve(__dirname, "../../supabase/migrations/20260730010000_integrity_and_enforcement.sql"),
  path.resolve(__dirname, "../../supabase/migrations/20260730020000_enforcement_corrections.sql"),
  path.resolve(__dirname, "../../supabase/migrations/20260730030000_authoritative_boundaries.sql"),
];

// Minimal PostgREST-style query builder over PGlite, covering exactly the
// supabase-js surface the repos use: from().insert().select(),
// select().eq().order().maybeSingle(), update().eq().select(), delete().eq().
// Every statement runs as the `authenticated` role with request.jwt.claim.sub
// set to the simulated user, so the migration's actual RLS policies decide
// row visibility — the same enforcement path as production.

type SbResult = { data: unknown; error: { message: string } | null };

class PgliteQuery implements PromiseLike<SbResult> {
  private op: "select" | "insert" | "update" | "delete" | null = null;
  private values: Record<string, unknown> | null = null;
  private filters: Array<{ col: string; val: unknown; op: "eq" | "neq" }> = [];
  private orderBy: { col: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private returnRows = false;
  private single = false;

  constructor(
    private readonly pg: PGlite,
    private readonly table: string,
    private readonly userId: string,
  ) {}

  insert(values: Record<string, unknown>): this {
    this.op = "insert";
    this.values = values;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.op = "update";
    this.values = values;
    return this;
  }

  delete(): this {
    this.op = "delete";
    return this;
  }

  select(_columns = "*"): this {
    if (this.op) this.returnRows = true;
    else this.op = "select";
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ col, val, op: "eq" });
    return this;
  }

  neq(col: string, val: unknown): this {
    this.filters.push({ col, val, op: "neq" });
    return this;
  }

  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  gte(col: string, val: unknown): this {
    // Only used by cleanup paths; treated as a no-op filter that matches all
    // rows RLS lets the user see (sufficient for created_at >= epoch).
    void col;
    void val;
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col, ascending: opts?.ascending !== false };
    return this;
  }

  maybeSingle(): this {
    this.single = true;
    return this;
  }

  then<R1 = SbResult, R2 = never>(
    onfulfilled?: ((value: SbResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private ident(name: string): string {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
    return `"${name}"`;
  }

  private buildSql(): { sql: string; params: unknown[] } {
    const t = `public.${this.ident(this.table)}`;
    const params: unknown[] = [];
    const bind = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = this.filters.length
      ? " where " +
        this.filters
          .map((f) => `t.${this.ident(f.col)} ${f.op === "eq" ? "=" : "<>"} ${bind(f.val)}`)
          .join(" and ")
      : "";

    switch (this.op) {
      case "insert": {
        const entries = Object.entries(this.values ?? {}).filter(([, v]) => v !== undefined);
        const cols = entries.map(([k]) => this.ident(k)).join(", ");
        const vals = entries.map(([, v]) => bind(v)).join(", ");
        return {
          sql: `insert into ${t} as t (${cols}) values (${vals}) returning to_jsonb(t.*) as row`,
          params,
        };
      }
      case "update": {
        const entries = Object.entries(this.values ?? {}).filter(([, v]) => v !== undefined);
        const sets = entries.map(([k, v]) => `${this.ident(k)} = ${bind(v)}`).join(", ");
        return { sql: `update ${t} as t set ${sets}${where} returning to_jsonb(t.*) as row`, params };
      }
      case "delete":
        return { sql: `delete from ${t} as t${where} returning to_jsonb(t.*) as row`, params };
      case "select": {
        const order = this.orderBy
          ? ` order by t.${this.ident(this.orderBy.col)} ${this.orderBy.ascending ? "asc" : "desc"}`
          : "";
        const limit = this.limitCount !== null ? ` limit ${Math.floor(this.limitCount)}` : "";
        return { sql: `select to_jsonb(t.*) as row from ${t} t${where}${order}${limit}`, params };
      }
      default:
        throw new Error("no operation specified");
    }
  }

  private async run(): Promise<SbResult> {
    try {
      const { sql, params } = this.buildSql();
      const rows = await this.pg.transaction(async (tx: Transaction) => {
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [this.userId]);
        await tx.query("set local role authenticated");
        const res = await tx.query<{ row: unknown }>(sql, params);
        return res.rows;
      });
      const data = rows.map((r) => r.row);
      if (this.single) {
        if (data.length > 1) {
          return { data: null, error: { message: "more than one row returned" } };
        }
        return { data: data[0] ?? null, error: null };
      }
      if (this.op === "select" || this.returnRows) return { data, error: null };
      return { data: null, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }
}

function makeClient(pg: PGlite, userId: string): SupabaseClient {
  const client = {
    from: (table: string) => new PgliteQuery(pg, table, userId),
    // PostgREST-style RPC under the caller's RLS identity.
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return { data: null, error: { message: "bad fn" } };
      const keys = Object.keys(args);
      // No to_jsonb wrapper: our RPCs return void/boolean/jsonb, all of which
      // PGlite serializes directly (to_jsonb cannot accept void).
      const call = `select public.${fn}(${keys.map((k, i) => `${k} := $${i + 1}`).join(", ")}) as row`;
      try {
        const rows = await pg.transaction(async (tx: Transaction) => {
          await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
          await tx.query("set local role authenticated");
          const res = await tx.query<{ row: unknown }>(call, keys.map((k) => args[k]));
          return res.rows;
        });
        return { data: rows[0]?.row ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  };
  return client as unknown as SupabaseClient;
}

export async function createPgliteBackend(): Promise<TestBackend> {
  const pg = new PGlite();

  // Stub the slice of the Supabase platform the migration depends on:
  // the auth schema, auth.users, auth.uid(), and the `authenticated` role
  // with the default data-API grants hosted Supabase provides.
  await pg.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid
    language sql stable
    as $auth_uid$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $auth_uid$;
    create role authenticated nologin;
  `);

  for (const migration of MIGRATIONS) {
    await pg.exec(fs.readFileSync(migration, "utf8"));
  }

  await pg.exec(`
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);

  const userAId = randomUUID();
  const userBId = randomUUID();
  await pg.query("insert into auth.users (id) values ($1), ($2)", [userAId, userBId]);

  const mk = (userId: string): TestUserCtx => ({ db: makeClient(pg, userId), userId });

  return {
    name: "pglite (hermetic, real migrations + RLS)",
    userA: mk(userAId),
    userB: mk(userBId),
    // Raw superuser SQL for schema-shape assertions (hermetic backend only).
    async sql(query: string) {
      const res = await pg.query(query);
      return res.rows as Record<string, unknown>[];
    },
    async cleanup() {
      await pg.exec(`
        alter table public.override_mutations disable trigger ccc_override_audit_immutable;
        alter table public.owner_overrides disable trigger ccc_owner_overrides_immutable;
        delete from public.override_mutations; delete from public.maturity_state;
        delete from public.oauth_states; delete from public.asset_external_uses;
        delete from public.asset_source_achievements; delete from public.asset_source_evidence;
        delete from public.asset_source_metrics; delete from public.collection_assets;
        delete from public.story_achievements; delete from public.story_archetypes;
        delete from public.plan_archetypes; delete from public.reference_application_uses;
        delete from public.counter_benchmarks;
        update public.career_assets set current_version_fk = null;
        delete from public.asset_versions;
        delete from public.ingested_items; delete from public.ingestion_runs;
        delete from public.google_connections; delete from public.owner_overrides;
        delete from public."references"; delete from public.skill_development_progress;
        delete from public.skill_development_plans; delete from public.skill_evidence;
        delete from public.skills; delete from public.counter_proposals;
        delete from public.offer_scenarios; delete from public.offers;
        delete from public.comp_benchmarks; delete from public.interviews;
        delete from public.referrals; delete from public.outreach;
        delete from public.applications; delete from public.companies;
        delete from public.ai_outputs; delete from public.action_items;
        delete from public.weekly_briefs; delete from public.visa_checklist_items;
        delete from public.story_bank; delete from public.asset_collections;
        delete from public.career_assets; delete from public.gap_reports;
        delete from public.archetype_sources; delete from public.target_archetypes;
        delete from public.grader_evaluations; delete from public.sanitized_claims;
        delete from public.evidence_items; delete from public.metrics;
        delete from public.achievements; delete from public.projects;
        alter table public.override_mutations enable trigger ccc_override_audit_immutable;
        alter table public.owner_overrides enable trigger ccc_owner_overrides_immutable;
      `);
    },
    async teardown() {
      await pg.close();
    },
  };
}
