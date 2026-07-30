import type { SupabaseClient } from "@supabase/supabase-js";

// The CRUD suite runs the same specs against two interchangeable backends:
//  - pglite: in-process Postgres loading the real migration file, with the
//    real RLS policies enforced per simulated user (default; runs anywhere).
//  - live: the actual Supabase project with real password sign-in
//    (TEST_LIVE=1; requires network egress to supabase.co).

export interface TestUserCtx {
  db: SupabaseClient;
  userId: string;
}

export interface TestBackend {
  /** Privileged `service_role` adapter (hermetic backend only). */
  serviceClient?: SupabaseClient;
  name: string;
  userA: TestUserCtx;
  userB: TestUserCtx;
  /** Raw superuser SQL — hermetic backend only; used by schema-shape tests. */
  sql?(query: string): Promise<Record<string, unknown>[]>;
  /** Remove every row belonging to the test users. */
  cleanup(): Promise<void>;
  teardown(): Promise<void>;
}
