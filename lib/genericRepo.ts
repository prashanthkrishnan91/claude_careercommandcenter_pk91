import type { SupabaseClient } from "@supabase/supabase-js";
import { RepoError } from "./repos";

// Generic archival-lifecycle data access for the P0B–P1 tables. The database
// is the validator here: check constraints, composite same-user FKs, RLS,
// and enforcement triggers (offer acceptance, sanitized-claim approval,
// current-collection uniqueness) reject anything non-canonical.
// There is deliberately no delete function — archival only.

function throwIf(error: { message: string } | null, action: string): void {
  if (error) throw new RepoError(`${action}: ${error.message}`, error);
}

function requireRow<T>(rows: T[] | null, action: string): T {
  if (!rows || rows.length === 0) throw new RepoError(`${action}: row not found`);
  return rows[0];
}

export interface ListOpts {
  eq?: Record<string, string | number | boolean>;
  includeArchived?: boolean;
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
}

export async function createRow<T>(
  db: SupabaseClient,
  table: string,
  values: Record<string, unknown>,
): Promise<T> {
  const clean = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined),
  );
  const { data, error } = await db.from(table).insert(clean).select();
  throwIf(error, `create ${table}`);
  return requireRow(data as T[] | null, `create ${table}`);
}

export async function listRows<T>(
  db: SupabaseClient,
  table: string,
  opts: ListOpts = {},
): Promise<T[]> {
  let query = db
    .from(table)
    .select("*")
    .order(opts.orderBy ?? "created_at", { ascending: opts.ascending ?? false });
  for (const [col, val] of Object.entries(opts.eq ?? {})) {
    query = query.eq(col, val);
  }
  if (!opts.includeArchived && !("status" in (opts.eq ?? {}))) {
    query = query.neq("status", "archived");
  }
  if (opts.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  throwIf(error, `list ${table}`);
  return (data ?? []) as T[];
}

export async function getRow<T>(db: SupabaseClient, table: string, id: string): Promise<T | null> {
  const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
  throwIf(error, `get ${table}`);
  return (data as T | null) ?? null;
}

export async function updateRow<T>(
  db: SupabaseClient,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<T> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const { data, error } = await db.from(table).update(clean).eq("id", id).select();
  throwIf(error, `update ${table}`);
  return requireRow(data as T[] | null, `update ${table}`);
}

export async function archiveRow<T>(db: SupabaseClient, table: string, id: string): Promise<T> {
  return updateRow<T>(db, table, id, { status: "archived" });
}

export async function restoreRow<T>(
  db: SupabaseClient,
  table: string,
  id: string,
  restoredStatus = "active",
): Promise<T> {
  return updateRow<T>(db, table, id, { status: restoredStatus });
}
