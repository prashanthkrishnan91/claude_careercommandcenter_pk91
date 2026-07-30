import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../config";

// SERVER-ONLY service-role client.
//
// `SUPABASE_SERVICE_ROLE_KEY` exists exclusively in server runtime
// configuration. It has no NEXT_PUBLIC_ prefix, so Next.js will not inline it
// into any browser bundle, and there is deliberately NO committed fallback
// value — an unset key makes the privileged path unavailable rather than
// silently weak. The `server-only` import makes an accidental client import a
// build error rather than a runtime leak.
//
// This client bypasses RLS. It is therefore used for exactly one purpose:
// invoking the low-level lifecycle functions that no browser role may execute.
// Those functions take the acting user id EXPLICITLY and scope every read and
// write to it, so bypassing RLS does not mean bypassing ownership — a
// service-role call still cannot touch another user's asset.

let cached: SupabaseClient | null = null;
let injected: SupabaseClient | null = null;

/**
 * Test seam. The hermetic suite injects a PRIVILEGED adapter that runs as the
 * `service_role` database role — the same role the production key maps to —
 * so the server-only path is exercised without granting any browser role
 * execute permission on the low-level functions. Server-only module; there is
 * no way to reach this from a browser bundle.
 */
export function setAdminClientForTests(client: SupabaseClient | null): void {
  injected = client;
}

export function serviceRoleConfigured(): boolean {
  return injected !== null || Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function supabaseAdmin(): SupabaseClient {
  if (injected) return injected;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    // Never fall back to the publishable key: that would quietly downgrade the
    // privileged path to one the database will refuse anyway.
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  if (!cached) {
    cached = createClient(SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Resolves the caller's user id from their own session — never from the body. */
export async function authenticatedUserId(userClient: SupabaseClient): Promise<string | null> {
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}
