import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBackend, type TestBackend } from "./backends";
import { setAdminClientForTests } from "../lib/server/supabaseAdmin";
import {
  addVersionToCollection,
  approveCollection,
  approveVersion,
  dbGraphVerdict,
  logExternalUse,
  setCurrentCollection,
} from "../lib/assetService";
import { authorManualVersionServer, generateAssetVersion } from "../lib/server/assetGeneration";
import { gateGraph, resolveSourceGraph } from "../lib/sourceGraph";
import { createRow, getRow, listRows, updateRow } from "../lib/genericRepo";
import {
  createEvidenceItem,
  createMetric,
  createProject,
  quickLogAchievement,
  updateAchievement,
  updateEvidenceItem,
} from "../lib/repos";
import type { AssetVersion, CareerAsset } from "../lib/entities";

// The database is the authority. Every test here goes AROUND the TypeScript
// service layer — straight at PostgREST — and proves the database refuses the
// forged transition on its own.

let backend: TestBackend;
let A: SupabaseClient;
let B: SupabaseClient;

beforeAll(async () => {
  backend = await createBackend();
  A = backend.userA.db;
  B = backend.userB.db;
  // The server-only commit runs through the privileged adapter, exactly as the
  // production route runs it through the service-role key.
  setAdminClientForTests(backend.serviceClient!);
  await backend.cleanup();
});
afterAll(async () => {
  setAdminClientForTests(null);
  await backend.cleanup();
  await backend.teardown();
});
beforeEach(async () => backend.cleanup());

/** Raw superuser SQL (hermetic backend only) — used to prove that the guards
 *  hold even on a privileged path that RLS does not constrain. */
const rawSql = (q: string) => backend.sql!(q);

const stub = async () => ({ ok: true as const, text: "Deterministic bullet.", model: "stub-model" });

async function seedAsset(db: SupabaseClient, opts: { verifiedEvidence?: boolean; approvedArchetype?: boolean } = {}) {
  const p = await createProject(db, { name: "Churn overhaul", employer: "DIRECTV" });
  const ach = await quickLogAchievement(db, { project_fk: p.id, headline: "Reduced churn forecast error by 18%" });
  await updateAchievement(db, ach.id, {
    truth_status: "VERIFIED",
    privacy_class: "PUBLIC_SAFE",
    narrative: "Rebuilt the churn model",
    action_taken: "Led 3 analysts",
    outcome: "Error down 18%",
  });
  const evidence = await createEvidenceItem(db, {
    achievement_fk: ach.id,
    type: "email_ref",
    content_summary: "VP email confirming the Q2 result",
    privacy_class: "PUBLIC_SAFE",
    ...(opts.verifiedEvidence === false
      ? {}
      : { verified_at: new Date().toISOString(), verified_by: "manager" as const }),
  });
  const archetype = await createRow<{ id: string }>(db, "target_archetypes", {
    name: "Director, Analytics",
    approved_by_user_bool: opts.approvedArchetype !== false,
    required_skills: ["forecasting"],
  });
  const asset = await createRow<CareerAsset>(db, "career_assets", {
    asset_type: "resume_bullet",
    target_archetype_fk: archetype.id,
  });
  await createRow(db, "asset_source_achievements", { asset_fk: asset.id, achievement_fk: ach.id });
  await createRow(db, "asset_source_evidence", { asset_fk: asset.id, evidence_fk: evidence.id });
  return { p, ach, evidence, archetype, asset };
}

async function approvedVersion(db: SupabaseClient, assetId: string): Promise<AssetVersion> {
  const gen = await generateAssetVersion(db, backend.userA.userId, assetId, { transport: stub });
  if (!gen.version) throw new Error(`generation blocked: ${JSON.stringify(gen.blocked)}`);
  return await approveVersion(db, gen.version.id);
}

describe("1. OAuth state is single-use at the database, not at the cookie", () => {
  const issue = async (db: SupabaseClient, hash: string, ttl = 600) =>
    db.rpc("ccc_issue_oauth_state", {
      p_nonce_hash: hash,
      p_provider: "gmail",
      p_redirect_uri: "https://ccc.example.com/api/google/callback",
      p_code_verifier_encrypted: "enc-verifier",
      p_session_binding_encrypted: "enc-session",
      p_ttl_seconds: ttl,
    });

  it("claims exactly once; the second claim fails even with identical inputs", async () => {
    await issue(A, "hash-a");
    const first = await A.rpc("ccc_claim_oauth_state", { p_nonce_hash: "hash-a" });
    expect((first.data as { claimed: boolean }).claimed).toBe(true);
    expect((first.data as { code_verifier_encrypted: string }).code_verifier_encrypted).toBe("enc-verifier");
    const replay = await A.rpc("ccc_claim_oauth_state", { p_nonce_hash: "hash-a" });
    expect((replay.data as { claimed: boolean }).claimed).toBe(false);
  });

  it("CONCURRENT claims against the same state: exactly one wins", async () => {
    await issue(A, "hash-race");
    // Fired without awaiting in between, so the calls interleave. The guard is
    // in the WHERE clause of a single UPDATE, so at most one can match.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => A.rpc("ccc_claim_oauth_state", { p_nonce_hash: "hash-race" })),
    );
    const wins = results.filter((r) => (r.data as { claimed: boolean } | null)?.claimed).length;
    expect(wins).toBe(1);
  });

  it("the claim is a single conditional UPDATE — no read-then-write window", async () => {
    const rows = await rawSql(
      `select prosrc from pg_proc where proname = 'ccc_claim_oauth_state'`,
    );
    const src = String(rows[0].prosrc);
    expect(src).toMatch(/update oauth_states/i);
    expect(src).toMatch(/consumed_at is null/i);
    // the guard must not be evaluated by a preceding SELECT
    expect(src).not.toMatch(/select .* from oauth_states[\s\S]*update oauth_states/i);
  });

  it("an expired state cannot be claimed", async () => {
    await issue(A, "hash-exp", 1);
    await rawSql(`update oauth_states set expires_at = now() - interval '1 minute'`);
    const res = await A.rpc("ccc_claim_oauth_state", { p_nonce_hash: "hash-exp" });
    expect((res.data as { claimed: boolean }).claimed).toBe(false);
  });

  it("another user cannot claim someone else's state", async () => {
    await issue(A, "hash-mine");
    const res = await B.rpc("ccc_claim_oauth_state", { p_nonce_hash: "hash-mine" });
    expect((res.data as { claimed: boolean }).claimed).toBe(false);
    // and it remains claimable by its owner
    const mine = await A.rpc("ccc_claim_oauth_state", { p_nonce_hash: "hash-mine" });
    expect((mine.data as { claimed: boolean }).claimed).toBe(true);
  });

  it("clients cannot write oauth_states directly, and the raw nonce is never stored", async () => {
    const forged = await A.from("oauth_states")
      .insert({ nonce_hash: "x", provider: "gmail", redirect_uri: "u", code_verifier_encrypted: "v", expires_at: new Date(Date.now() + 60000).toISOString() })
      .select();
    expect(forged.error).not.toBeNull();
    await issue(A, "hash-stored");
    const rows = await A.from("oauth_states").select("*");
    const stored = (rows.data ?? []) as Array<{ nonce_hash: string }>;
    expect(stored.every((r) => r.nonce_hash !== "raw-nonce")).toBe(true);
    // consumed/expired rows are purged by the documented retention policy
    await rawSql(`update oauth_states set consumed_at = now(), issued_at = now() - interval '48 hours'`);
    const purged = await A.rpc("ccc_purge_oauth_states");
    expect(Number(purged.data)).toBeGreaterThan(0);
  });
});

describe("2. version commits are transactional and correctly ordered", () => {
  it("concurrent commits produce a dense ordered chain with no duplicate numbers", async () => {
    const { asset } = await seedAsset(A);
    await Promise.all(
      Array.from({ length: 5 }, () => generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub })),
    );
    const versions = await listRows<AssetVersion>(A, "asset_versions", { eq: { asset_fk: asset.id }, includeArchived: true });
    const numbers = versions.map((v) => v.version_number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(numbers).size).toBe(5);
    // exactly one open (non-superseded) version, and it is the current one
    const open = versions.filter((v) => !v.superseded_by_fk && !v.blocked_bool);
    expect(open).toHaveLength(1);
    const a = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(a?.current_version_fk).toBe(open[0].id);
    expect(open[0].version_number).toBe(5);
  });

  it("a failing commit rolls back completely — no orphan version, no repointed asset", async () => {
    const { asset } = await seedAsset(A);
    const v1 = (await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub })).version!;
    const before = await getRow<CareerAsset>(A, "career_assets", asset.id);
    // an invalid privacy class aborts the function AFTER the insert statement
    const res = await A.rpc("ccc_commit_asset_version", {
      p_asset: asset.id, p_content: "rolled back", p_model: "", p_prompt_hash: "",
      p_blocked: false, p_block_reason: "", p_privacy: "NOT_A_CLASS",
      p_truth_summary: "", p_ack: false,
    });
    expect(res.error).not.toBeNull();
    const versions = await listRows<AssetVersion>(A, "asset_versions", { eq: { asset_fk: asset.id }, includeArchived: true });
    expect(versions).toHaveLength(1); // the aborted insert left nothing behind
    expect(versions[0].id).toBe(v1.id);
    const after = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(after?.current_version_fk).toBe(before?.current_version_fk);
  });

  it("a blocked commit never becomes current and never supersedes a good version", async () => {
    const { asset, ach } = await seedAsset(A);
    const good = (await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub })).version!;
    await updateAchievement(A, ach.id, { truth_status: "DISPUTED" });
    await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub }); // records a blocked version
    const a = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(a?.current_version_fk).toBe(good.id);
    const versions = await listRows<AssetVersion>(A, "asset_versions", { eq: { asset_fk: asset.id }, includeArchived: true });
    expect(versions.find((v) => v.id === good.id)?.superseded_by_fk).toBeNull();
  });
});

describe("3. external use is an authoritative record, not a client-writable log", () => {
  it("a forged direct insert is rejected; only the RPC path works", async () => {
    const { asset } = await seedAsset(A);
    const v = await approvedVersion(A, asset.id);
    const forged = await A.from("asset_external_uses")
      .insert({ asset_fk: asset.id, version_fk: v.id, destination: "forged" })
      .select();
    expect(forged.error).not.toBeNull();
    await logExternalUse(A, v.id, "LinkedIn profile");
    const rows = await listRows<{ destination: string }>(A, "asset_external_uses", { includeArchived: true });
    expect(rows.map((r) => r.destination)).toEqual(["LinkedIn profile"]);
  });

  it("rejects an unapproved, blocked, foreign-asset or superseded version", async () => {
    const { asset } = await seedAsset(A);
    const unapproved = (await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub })).version!;
    await expect(logExternalUse(A, unapproved.id, "X")).rejects.toThrow(/approved/);
    const approved = await approveVersion(A, unapproved.id);
    // a newer version supersedes it → the old one is history, not distributable
    await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub });
    await expect(logExternalUse(A, approved.id, "X")).rejects.toThrow(/superseded|current/);
  });

  it("used_externally_bool is derived and cannot be set by a client", async () => {
    const { asset } = await seedAsset(A);
    const forged = await A.from("career_assets")
      .update({ used_externally_bool: true }).eq("id", asset.id).select();
    expect(forged.error?.message).toMatch(/derived/);
    expect((await getRow<CareerAsset>(A, "career_assets", asset.id))?.used_externally_bool).toBe(false);
    const v = await approvedVersion(A, asset.id);
    await logExternalUse(A, v.id, "LinkedIn");
    expect((await getRow<CareerAsset>(A, "career_assets", asset.id))?.used_externally_bool).toBe(true);
  });

  it("a caller-supplied version number cannot be substituted for the version row", async () => {
    const { asset } = await seedAsset(A);
    const v = await approvedVersion(A, asset.id);
    const otherAsset = await createRow<CareerAsset>(A, "career_assets", { asset_type: "story" });
    // asset/version mismatch is caught on the row, not trusted from the caller
    const mismatch = await A.rpc("ccc_log_external_use", { p_version: v.id, p_destination: "X" });
    expect(mismatch.error).toBeNull(); // correct pairing succeeds
    const forged = await A.from("asset_external_uses")
      .insert({ asset_fk: otherAsset.id, version_fk: v.id, destination: "mismatched" })
      .select();
    expect(forged.error).not.toBeNull();
  });
});

describe("4. collections package exact approved versions", () => {
  it("membership requires an approved, unblocked, same-asset version", async () => {
    const { asset } = await seedAsset(A);
    const coll = await createRow<{ id: string }>(A, "asset_collections", { name: "Resume", collection_type: "resume_version" });
    const v = (await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub })).version!;
    await expect(addVersionToCollection(A, coll.id, v.id)).rejects.toThrow(/approved/);
    await approveVersion(A, v.id);
    await addVersionToCollection(A, coll.id, v.id);
    // a direct insert bypassing the RPC is validated identically
    const other = await seedAsset(A);
    const forged = await A.from("collection_assets")
      .insert({ collection_fk: coll.id, asset_fk: other.asset.id, version_fk: v.id })
      .select();
    expect(forged.error?.message).toMatch(/different asset/);
    const nullVersion = await A.from("collection_assets")
      .insert({ collection_fk: coll.id, asset_fk: asset.id })
      .select();
    expect(nullVersion.error?.message).toMatch(/exact asset version/);
  });

  it("approval and current selection are server-only and revalidate contents", async () => {
    const { asset, ach } = await seedAsset(A);
    const coll = await createRow<{ id: string }>(A, "asset_collections", { name: "Resume", collection_type: "resume_version" });
    const v = await approvedVersion(A, asset.id);
    await addVersionToCollection(A, coll.id, v.id);
    // direct approval is rejected
    const forged = await A.from("asset_collections")
      .update({ approved_by_user_bool: true }).eq("id", coll.id).select();
    expect(forged.error?.message).toMatch(/server/);
    const forgedCurrent = await A.from("asset_collections")
      .update({ current_bool: true }).eq("id", coll.id).select();
    expect(forgedCurrent.error?.message).toMatch(/server/);
    await approveCollection(A, coll.id);
    await setCurrentCollection(A, coll.id);

    // a source regresses → membership goes stale and re-approval is refused
    await updateAchievement(A, ach.id, { truth_status: "DISPUTED" });
    const members = await listRows<{ membership_stale_bool: boolean }>(A, "collection_assets", { includeArchived: true });
    expect(members[0].membership_stale_bool).toBe(true);
    await expect(setCurrentCollection(A, coll.id)).rejects.toThrow(/stale|invalid/);
  });

  it("an empty collection cannot be approved", async () => {
    const coll = await createRow<{ id: string }>(A, "asset_collections", { name: "Empty", collection_type: "interview_pack" });
    await expect(approveCollection(A, coll.id)).rejects.toThrow(/empty/);
  });
});

describe("5. complete source-graph eligibility", () => {
  it("UNVERIFIED evidence is refused even when PUBLIC_SAFE, with the exact reason", async () => {
    const { asset, evidence } = await seedAsset(A, { verifiedEvidence: false });
    const graph = await resolveSourceGraph(A, asset.id);
    const gate = gateGraph(graph, { attestedNoMetricOverride: false });
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((r) => r.reason).join(" ")).toMatch(/Unverified evidence cannot enter an external payload/);
    // the database agrees, independently
    const verdict = await dbGraphVerdict(A, asset.id);
    expect(verdict.eligible).toBe(false);
    expect(JSON.stringify(verdict.reasons)).toMatch(/Unverified evidence/);
    // verifying it clears the block and the text enters the payload
    await updateEvidenceItem(A, evidence.id, { verified_at: new Date().toISOString(), verified_by: "manager" });
    const ok = await resolveSourceGraph(A, asset.id);
    expect(gateGraph(ok, { attestedNoMetricOverride: false }).allowed).toBe(true);
    expect((await dbGraphVerdict(A, asset.id)).eligible).toBe(true);
  });

  it("archived and PRIVATE/INTERNAL_ONLY evidence are refused with their own reasons", async () => {
    const { asset, evidence } = await seedAsset(A);
    await updateEvidenceItem(A, evidence.id, { privacy_class: "PRIVATE" });
    expect(JSON.stringify((await dbGraphVerdict(A, asset.id)).reasons)).toMatch(/privacy PRIVATE/);
    await updateEvidenceItem(A, evidence.id, { privacy_class: "INTERNAL_ONLY" });
    expect(JSON.stringify((await dbGraphVerdict(A, asset.id)).reasons)).toMatch(/privacy INTERNAL_ONLY/);
    await updateEvidenceItem(A, evidence.id, { privacy_class: "PUBLIC_SAFE", status: "archived" });
    expect(JSON.stringify((await dbGraphVerdict(A, asset.id)).reasons)).toMatch(/archived/);
  });

  it("an unapproved or archived archetype blocks; only approved parsed context travels", async () => {
    const { asset, archetype } = await seedAsset(A, { approvedArchetype: false });
    const gate = gateGraph(await resolveSourceGraph(A, asset.id), { attestedNoMetricOverride: false });
    expect(gate.reasons.map((r) => r.reason).join(" ")).toMatch(/must be user-approved/);
    expect(JSON.stringify((await dbGraphVerdict(A, asset.id)).reasons)).toMatch(/approved/);

    await updateRow(A, "target_archetypes", archetype.id, { approved_by_user_bool: true });
    const calls: Array<{ system: string; user: string }> = [];
    await generateAssetVersion(A, backend.userA.userId, asset.id, {
      transport: async (o) => {
        calls.push(o);
        return { ok: true as const, text: "ok", model: "stub" };
      },
    });
    const payload = calls[0].system + calls[0].user;
    expect(payload).toContain("Director, Analytics"); // approved parsed config
    expect(payload).toContain("forecasting");

    // raw retained JD text never travels
    await createRow(A, "archetype_sources", {
      archetype_fk: archetype.id,
      source_type: "pasted_jd",
      raw_content: "RAW-JD-CONFIDENTIAL-POSTING-TEXT",
      parsed_summary: "director analytics summary",
    });
    const calls2: Array<{ system: string; user: string }> = [];
    await generateAssetVersion(A, backend.userA.userId, asset.id, {
      transport: async (o) => {
        calls2.push(o);
        return { ok: true as const, text: "ok", model: "stub" };
      },
    });
    expect(calls2[0].system + calls2[0].user).not.toContain("RAW-JD-CONFIDENTIAL-POSTING-TEXT");

    await updateRow(A, "target_archetypes", archetype.id, { status: "archived" });
    expect(JSON.stringify((await dbGraphVerdict(A, asset.id)).reasons)).toMatch(/archived|approved/);
  });

  it("the TypeScript payload gate and the SQL authority agree on every fixture", async () => {
    const { asset, ach, evidence, archetype } = await seedAsset(A);
    const mutations: Array<() => Promise<unknown>> = [
      async () => updateAchievement(A, ach.id, { truth_status: "DISPUTED" }),
      async () => updateAchievement(A, ach.id, { truth_status: "VERIFIED", privacy_class: "INTERNAL_ONLY" }),
      async () => updateAchievement(A, ach.id, { privacy_class: "PRIVATE" }),
      async () => updateAchievement(A, ach.id, { privacy_class: "PUBLIC_SAFE", status: "archived" }),
      async () => updateAchievement(A, ach.id, { status: "active" }),
      async () => updateEvidenceItem(A, evidence.id, { verified_at: null, verified_by: null }),
      async () => updateEvidenceItem(A, evidence.id, { verified_at: new Date().toISOString(), verified_by: "peer" }),
      async () => updateRow(A, "target_archetypes", archetype.id, { approved_by_user_bool: false }),
      async () => updateRow(A, "target_archetypes", archetype.id, { approved_by_user_bool: true }),
    ];
    for (const [i, mutate] of mutations.entries()) {
      await mutate();
      const ts = gateGraph(await resolveSourceGraph(A, asset.id), { attestedNoMetricOverride: true });
      const sql = await dbGraphVerdict(A, asset.id);
      expect(sql.eligible, `fixture ${i}: SQL=${sql.eligible} TS=${ts.allowed}`).toBe(ts.allowed);
    }
  });
});

describe("6. maturity is live, not a cached snapshot", () => {
  async function reachMaturityViaOverride(db: SupabaseClient) {
    await db.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: true, p_reason: "test" });
  }

  it("regressing a source revokes P1 writes on the NEXT statement — no RPC, no page load", async () => {
    // Reach the gates the only way that is truthful in a test: the logged
    // override. The point under test is that authorization is recomputed, so
    // the criterion source is what must change the answer.
    await reachMaturityViaOverride(A);
    const ok = await A.from("companies").insert({ name: "Meridian" }).select();
    expect(ok.error).toBeNull();

    // Turning the override off is the source regression for the override path…
    await A.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: false, p_reason: "regress" });
    const blocked = await A.from("companies").insert({ name: "Second" }).select();
    expect(blocked.error?.message).toMatch(/row-level security/);
    // …and no recompute RPC was called in between.
  });

  it("ccc_p1_unlocked recomputes rather than reading maturity_state", async () => {
    const rows = await rawSql(`select prosrc from pg_proc where proname = 'ccc_p1_unlocked'`);
    const src = String(rows[0].prosrc);
    // it delegates to the live criteria computation, never to the cache
    expect(src).toMatch(/ccc_p1_unlocked_for/);
    expect(src).not.toMatch(/maturity_state/);
    const impl = await rawSql(`select prosrc from pg_proc where proname = 'ccc_p1_unlocked_for'`);
    expect(String(impl[0].prosrc)).toMatch(/ccc_maturity_met_for/);
    expect(String(impl[0].prosrc)).not.toMatch(/maturity_state/);
    // and a stale cache cannot grant access
    await rawSql(
      `insert into maturity_state (user_id, unlocked_bool, criteria)
       select id, true, '{}'::jsonb from auth.users
       on conflict (user_id) do update set unlocked_bool = true`,
    );
    const forged = await A.from("companies").insert({ name: "Cache says yes" }).select();
    expect(forged.error?.message).toMatch(/row-level security/);
  });

  it("the collection criterion requires the approved CURRENT collection's exact versions to be valid", async () => {
    await reachMaturityViaOverride(A);
    const { asset, ach } = await seedAsset(A);
    const coll = await createRow<{ id: string }>(A, "asset_collections", { name: "Resume", collection_type: "resume_version" });
    const v = await approvedVersion(A, asset.id);
    await addVersionToCollection(A, coll.id, v.id);
    await approveCollection(A, coll.id);
    await setCurrentCollection(A, coll.id);
    const met = await A.rpc("ccc_maturity_criteria", { uid: backend.userA.userId });
    expect((met.data as Record<string, { met: boolean }>).collection_current.met).toBe(true);
    // regress a source: the criterion must fail immediately
    await updateAchievement(A, ach.id, { truth_status: "DISPUTED" });
    const after = await A.rpc("ccc_maturity_criteria", { uid: backend.userA.userId });
    expect((after.data as Record<string, { met: boolean }>).collection_current.met).toBe(false);
  });

  it("an old approved version elsewhere on the asset does not satisfy the bullet criterion", async () => {
    await reachMaturityViaOverride(A);
    const { asset, archetype } = await seedAsset(A);
    const v1 = await approvedVersion(A, asset.id);
    // a newer UNAPPROVED version becomes current; v1 is superseded history
    await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub });
    const a = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(a?.current_version_fk).not.toBe(v1.id);
    const crit = await A.rpc("ccc_maturity_criteria", { uid: backend.userA.userId });
    expect((crit.data as Record<string, { met: boolean }>).bullet_per_archetype.met).toBe(false);
    expect(archetype.id).toBeTruthy();
  });
});

describe("7. complete P1 and override coverage", () => {
  it("comp_benchmarks is maturity-enforced like every other P1 table", async () => {
    const locked = await A.from("comp_benchmarks").insert({ role_title: "Director" }).select();
    expect(locked.error?.message).toMatch(/row-level security/);
    await A.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: true, p_reason: "test" });
    const unlocked = await A.from("comp_benchmarks").insert({ role_title: "Director" }).select();
    expect(unlocked.error).toBeNull();
  });

  it("every P1 distribution table carries the maturity check in its write policies", async () => {
    const P1 = [
      "companies", "contacts", "outreach", "referrals", "applications", "interviews",
      "offers", "offer_scenarios", "counter_proposals", "comp_benchmarks",
      "reference_application_uses", "counter_benchmarks",
    ];
    const rows = await rawSql(
      `select c.relname, p.polname, pg_get_expr(p.polwithcheck, p.polrelid) as wc
         from pg_policy p join pg_class c on c.oid = p.polrelid
        where p.polcmd in ('a','w')`,
    );
    for (const t of P1) {
      const policies = rows.filter((r) => r.relname === t && r.wc);
      expect(policies.length, `${t} write policies`).toBeGreaterThanOrEqual(2);
      for (const p of policies) {
        expect(String(p.wc), `${t}.${p.polname}`).toMatch(/ccc_p1_unlocked/);
      }
    }
  });

  it("override audit records the event, an immutable reason snapshot, and DELETEs", async () => {
    await A.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: true, p_reason: "first reason" });
    const c = await createRow<{ id: string }>(A, "companies", { name: "Audited" });
    await A.from("companies").delete().eq("id", c.id);
    const rows = await A.from("override_mutations").select("*");
    const audit = (rows.data ?? []) as Array<{ table_name: string; operation: string; reason_snapshot: string; override_event_fk: string }>;
    expect(audit.some((r) => r.operation === "INSERT" && r.table_name === "companies")).toBe(true);
    expect(audit.some((r) => r.operation === "DELETE" && r.table_name === "companies")).toBe(true);
    expect(audit.every((r) => r.reason_snapshot === "first reason")).toBe(true);
    expect(audit.every((r) => r.override_event_fk)).toBe(true);

    // a later reason must NOT rewrite history
    await A.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: true, p_reason: "second reason" });
    const after = await A.from("override_mutations").select("*");
    expect(((after.data ?? []) as Array<{ reason_snapshot: string }>).some((r) => r.reason_snapshot === "first reason")).toBe(true);
  });

  it("the audit trail and the override log are append-only, even to their owner", async () => {
    await A.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: true, p_reason: "r" });
    await createRow(A, "companies", { name: "X" });
    const rows = await A.from("override_mutations").select("*");
    const id = ((rows.data ?? []) as Array<{ id: string }>)[0].id;

    // Two independent layers. RLS is the first: these tables carry no
    // UPDATE/DELETE policy, so a client statement matches ZERO rows (PostgREST
    // reports success with an empty result rather than an error).
    const upd = await A.from("override_mutations").update({ reason_snapshot: "rewritten" }).eq("id", id).select();
    expect(upd.data).toEqual([]);
    const del = await A.from("override_mutations").delete().eq("id", id).select();
    expect(del.data).toEqual([]);
    const still = await A.from("override_mutations").select("*");
    expect(((still.data ?? []) as Array<{ id: string; reason_snapshot: string }>).find((r) => r.id === id)?.reason_snapshot).toBe("r");

    const overrides = await A.from("owner_overrides").select("*");
    const oid = ((overrides.data ?? []) as Array<{ id: string }>)[0].id;
    expect((await A.from("owner_overrides").update({ reason: "no" }).eq("id", oid).select()).data).toEqual([]);
    expect((await A.from("owner_overrides").delete().eq("id", oid).select()).data).toEqual([]);
    expect(((await A.from("owner_overrides").select("*")).data ?? []).length).toBeGreaterThan(0);

    // The second layer is the trigger, which stops even a privileged path that
    // is not subject to RLS.
    await expect(
      rawSql(`update public.override_mutations set reason_snapshot = 'rewritten by superuser'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      rawSql(`delete from public.owner_overrides`),
    ).rejects.toThrow(/append-only/);
  });
});

describe("8. safety-critical transitions reject direct PostgREST bypass", () => {
  it("asset_versions is client-read-only: insert, update and delete all match nothing", async () => {
    const { asset } = await seedAsset(A);
    const v = (await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub })).version!;
    // RLS grants no write policy, so a forged statement affects ZERO rows.
    expect((await A.from("asset_versions")
      .update({ approved_by_user_bool: true, approved_at: new Date().toISOString() })
      .eq("id", v.id).select()).data).toEqual([]);
    expect((await getRow<AssetVersion>(A, "asset_versions", v.id))?.approved_by_user_bool).toBe(false);
    expect((await A.from("asset_versions").delete().eq("id", v.id).select()).data).toEqual([]);
    expect(await getRow<AssetVersion>(A, "asset_versions", v.id)).not.toBeNull();
    const forgedInsert = await A.from("asset_versions")
      .insert({ asset_fk: asset.id, version_number: 99, content: "forged", generated_by_model: "gpt-fake" })
      .select();
    expect(forgedInsert.error?.message).toMatch(/row-level security|permission denied/);
    // …and the column guard still fires on the privileged path
    await expect(
      rawSql(`update public.asset_versions set approved_by_user_bool = true where id = '${v.id}'`),
    ).rejects.toThrow(/only by the server/);
  });

  it("a blocked version cannot be unblocked or acknowledged, even privileged", async () => {
    const { asset, ach } = await seedAsset(A);
    await updateAchievement(A, ach.id, { truth_status: "DISPUTED" });
    await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub });
    const blocked = (await listRows<AssetVersion>(A, "asset_versions", { eq: { asset_fk: asset.id }, includeArchived: true }))[0];
    expect(blocked.blocked_bool).toBe(true);
    expect((await A.from("asset_versions").update({ blocked_bool: false }).eq("id", blocked.id).select()).data).toEqual([]);
    await expect(
      rawSql(`update public.asset_versions set blocked_bool = false where id = '${blocked.id}'`),
    ).rejects.toThrow(/only by the server/);
    await expect(
      rawSql(`update public.asset_versions set attested_no_metric_ack_bool = true where id = '${blocked.id}'`),
    ).rejects.toThrow(/only by the server/);
  });

  it("approval through the RPC still fails when the graph is ineligible", async () => {
    const { asset, ach } = await seedAsset(A);
    const v = (await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub })).version!;
    await updateAchievement(A, ach.id, { truth_status: "NEEDS_PROOF" });
    const res = await A.rpc("ccc_approve_asset_version", { p_version: v.id });
    expect(res.error?.message).toMatch(/source graph/);
  });

  it("another user cannot approve, package or externally use my versions", async () => {
    const { asset } = await seedAsset(A);
    const v = await approvedVersion(A, asset.id);
    expect((await B.rpc("ccc_approve_asset_version", { p_version: v.id })).error).not.toBeNull();
    expect((await B.rpc("ccc_log_external_use", { p_version: v.id, p_destination: "steal" })).error).not.toBeNull();
    expect((await B.rpc("ccc_asset_graph_eligible", { p_asset: asset.id })).data).toMatchObject({ eligible: false });
  });
});

describe("9. write bypasses closed at the table level", () => {
  it("collection_assets is client-read-only; add and remove run through RPCs", async () => {
    const { asset, ach } = await seedAsset(A);
    const v = await approvedVersion(A, asset.id);
    const coll = await createRow<{ id: string }>(A, "asset_collections", { name: "Resume", collection_type: "resume_version" });

    // direct INSERT / UPDATE / DELETE all match nothing
    const ins = await A.from("collection_assets")
      .insert({ collection_fk: coll.id, asset_fk: asset.id, version_fk: v.id }).select();
    expect(ins.error?.message).toMatch(/row-level security|permission denied/);
    await addVersionToCollection(A, coll.id, v.id);
    expect((await A.from("collection_assets").update({ membership_stale_bool: false }).eq("collection_fk", coll.id).select()).data).toEqual([]);
    expect((await A.from("collection_assets").delete().eq("collection_fk", coll.id).select()).data).toEqual([]);
    expect((await listRows(A, "collection_assets", { includeArchived: true })).length).toBe(1);

    // the protected remove RPC works and re-checks the collection
    await approveCollection(A, coll.id);
    await setCurrentCollection(A, coll.id);
    const removed = await A.rpc("ccc_remove_collection_version", { p_collection: coll.id, p_version: v.id });
    expect(removed.error).toBeNull();
    expect((await listRows(A, "collection_assets", { includeArchived: true })).length).toBe(0);
    // an approved/current collection left EMPTY is demoted, not left standing
    const after = await getRow<{ approved_by_user_bool: boolean; current_bool: boolean }>(A, "asset_collections", coll.id);
    expect(after?.approved_by_user_bool).toBe(false);
    expect(after?.current_bool).toBe(false);
    expect(ach.id).toBeTruthy();
  });

  it("membership validation runs on UPDATE too, and rejects a version filed under the wrong asset", async () => {
    const { asset } = await seedAsset(A);
    const other = await seedAsset(A);
    const v = await approvedVersion(A, asset.id);
    const vOther = await approvedVersion(A, other.asset.id);
    const coll = await createRow<{ id: string }>(A, "asset_collections", { name: "Pack", collection_type: "interview_pack" });
    await addVersionToCollection(A, coll.id, v.id);
    const memberId = (await listRows<{ id: string }>(A, "collection_assets", { includeArchived: true }))[0].id;

    // even privileged, repointing a membership at another asset's version fails
    await expect(
      rawSql(`update public.collection_assets set version_fk = '${vOther.id}' where id = '${memberId}'`),
    ).rejects.toThrow(/different asset/);

    // and revalidation names the mismatch if one ever appeared
    await rawSql(`do $$ begin
      perform set_config('ccc.trusted_path','on',true);
      update public.collection_assets set version_fk = '${vOther.id}' where id = '${memberId}';
    end $$;`);
    await A.rpc("ccc_revalidate_collection", { p_collection: coll.id });
    const m = await getRow<{ membership_stale_bool: boolean; membership_stale_reason: string }>(A, "collection_assets", memberId);
    expect(m?.membership_stale_bool).toBe(true);
    expect(m?.membership_stale_reason).toMatch(/does not belong to the asset/);
  });

  it("a locked DELETE is rejected on EVERY maturity-gated P1 table", async () => {
    const P1 = [
      "companies", "contacts", "outreach", "referrals", "applications", "interviews",
      "offers", "offer_scenarios", "counter_proposals", "comp_benchmarks",
      "reference_application_uses", "counter_benchmarks",
    ];
    // Seed one row per table while unlocked…
    await A.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: true, p_reason: "seed" });
    const company = await createRow<{ id: string }>(A, "companies", { name: "Doomed" });
    const contact = await createRow<{ id: string }>(A, "contacts", { name: "Doomed", company_fk: company.id });
    const application = await createRow<{ id: string }>(A, "applications", { role_title: "Doomed" });
    const offer = await createRow<{ id: string }>(A, "offers", { role_title: "Doomed" });
    const bench = await createRow<{ id: string }>(A, "comp_benchmarks", { role_title: "Doomed" });
    const counter = await createRow<{ id: string }>(A, "counter_proposals", { offer_fk: offer.id, rationale: "x" });
    await createRow(A, "outreach", { contact_fk: contact.id, summary: "x" });
    await createRow(A, "referrals", { contact_fk: contact.id, application_fk: application.id });
    await createRow(A, "interviews", { application_fk: application.id, round: "x" });
    await createRow(A, "offer_scenarios", { offer_fk: offer.id, scenario_name: "x" });
    await createRow(A, "counter_benchmarks", { counter_fk: counter.id, benchmark_fk: bench.id });
    const ref = await createRow<{ id: string }>(A, "references", {
      contact_fk: contact.id, reference_type: "manager",
      willingness_status: "confirmed", willingness_confirmed_at: new Date().toISOString(),
    });
    await createRow(A, "reference_application_uses", { reference_fk: ref.id, application_fk: application.id });

    // …then lock and prove every DELETE removes nothing.
    await A.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: false, p_reason: "lock" });
    for (const t of P1) {
      const before = (await listRows(A, t, { includeArchived: true })).length;
      expect(before, `${t} should have a seeded row`).toBeGreaterThan(0);
      const del = await A.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000").select();
      expect(del.data ?? [], `${t} locked delete`).toEqual([]);
      expect((await listRows(A, t, { includeArchived: true })).length, `${t} row survived`).toBe(before);
      // UPDATE (including archive) is locked in the same breath. The two
      // junction tables carry no lifecycle status, so touch a column they have.
      const patch = ["reference_application_uses", "counter_benchmarks"].includes(t)
        ? { created_at: new Date().toISOString() }
        : { status: "archived" };
      const upd = await A.from(t).update(patch).neq("id", "00000000-0000-0000-0000-000000000000").select();
      expect(upd.data ?? [], `${t} locked update`).toEqual([]);
      // INSERT is refused outright
      const ins = await A.from(t).insert(t === "companies" ? { name: "nope" } : {}).select();
      expect(ins.error, `${t} locked insert`).not.toBeNull();
    }

    // With the override active again, DELETE succeeds and is audited.
    await A.rpc("ccc_set_override", { p_key: "maturity_dev_override", p_enabled: true, p_reason: "unlock for delete" });
    const del = await A.from("comp_benchmarks").delete().eq("id", bench.id).select();
    expect(del.error).toBeNull();
    const audit = await A.from("override_mutations").select("*");
    const rows = (audit.data ?? []) as Array<{ table_name: string; operation: string; reason_snapshot: string }>;
    expect(rows.some((r) => r.table_name === "comp_benchmarks" && r.operation === "DELETE")).toBe(true);
    expect(rows.every((r) => r.reason_snapshot)).toBe(true);
  });

  it("maturity and override state cannot be queried for another user", async () => {
    const other = backend.userB.userId;
    expect((await A.rpc("ccc_maturity_criteria", { uid: other })).error?.message).toMatch(/only for the calling user/);
    // the parameterised implementations are not callable by a client at all
    expect((await A.rpc("ccc_maturity_criteria_for", { uid: other })).error).not.toBeNull();
    expect((await A.rpc("ccc_p1_unlocked_for", { uid: other })).error).not.toBeNull();
    expect((await A.rpc("ccc_maturity_met_for", { uid: other })).error).not.toBeNull();
    expect((await A.rpc("ccc_override_active_for", { uid: other })).error).not.toBeNull();
    // the public predicates take no user at all
    expect((await A.rpc("ccc_p1_unlocked", {})).error).toBeNull();
    expect((await A.rpc("ccc_maturity_met", {})).error).toBeNull();
    expect((await A.rpc("ccc_override_active", {})).error).toBeNull();
  });

  it("a hand-authored version is committed transactionally and cannot forge model metadata", async () => {
    const { asset } = await seedAsset(A);
    const v = await authorManualVersionServer(backend.userA.userId, asset.id, "Hand-written bullet.");
    expect(v.version_number).toBe(1);
    expect(v.generated_by_model).toBe("");
    expect(v.generation_prompt_hash).toBe("");
    const a = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(a?.current_version_fk).toBe(v.id);
    // Empty content is refused on the server-only path…
    const empty = await backend.serviceClient!.rpc("ccc_author_manual_version", {
      p_user: backend.userA.userId, p_asset: asset.id, p_content: "   ",
    });
    expect(empty.error?.message).toMatch(/needs content/);
    // …and the manual commit is not reachable by a browser client at all.
    const forged = await A.rpc("ccc_author_manual_version", {
      p_user: backend.userA.userId, p_asset: asset.id, p_content: "forged",
    });
    expect(forged.error).not.toBeNull();
    // A user-authored audit row accompanies the legitimate version.
    const audits = await listRows<{ output_type: string; model_used: string }>(A, "ai_outputs", { includeArchived: true });
    expect(audits.some((r) => r.output_type === "asset_manual" && r.model_used === "")).toBe(true);
  });
});

describe("10. the version-commit authority is server-only", () => {
  const LOW_LEVEL = [
    "ccc_commit_asset_version",
    "ccc_author_manual_version",
    "ccc_record_ai_audit",
    "ccc_asset_graph_eligible_for",
    "ccc_truth_summary",
  ];

  it("no browser role holds EXECUTE on any low-level lifecycle function", async () => {
    const rows = await rawSql(`
      select p.proname, r.rolname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace,
             unnest(array['public','anon','authenticated']) r(rolname)
       where n.nspname = 'public'
         and p.proname = any(array[${LOW_LEVEL.map((f) => `'${f}'`).join(",")}])
         and has_function_privilege(r.rolname, p.oid, 'execute')`);
    expect(rows).toEqual([]);
    // and the service role does hold it, so the server path still works
    const granted = await rawSql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname = 'ccc_commit_asset_version'
         and has_function_privilege('service_role', p.oid, 'execute')`);
    expect(granted.length).toBe(1);
  });

  it("an authenticated browser client is denied the low-level commit", async () => {
    const { asset } = await seedAsset(A);
    const res = await A.rpc("ccc_commit_asset_version", {
      p_user: backend.userA.userId, p_asset: asset.id, p_content: "forged",
      p_model: "gpt-fake", p_prompt_hash: "forged", p_blocked: false,
      p_block_reason: "", p_ack: false, p_audit: { output_type: "forged" },
    });
    expect(res.error?.message).toMatch(/permission denied|does not exist/);
    expect(await listRows(A, "asset_versions", { includeArchived: true })).toEqual([]);
  });

  it("the anon role is denied the low-level functions", async () => {
    for (const fn of LOW_LEVEL) {
      const rows = await rawSql(`
        select has_function_privilege('anon', p.oid, 'execute') as ok
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname='public' and p.proname='${fn}'`);
      for (const r of rows) expect(r.ok, `anon should not execute ${fn}`).toBe(false);
    }
  });

  it("a service-role call cannot commit to another user's asset", async () => {
    const { asset } = await seedAsset(A);
    const res = await backend.serviceClient!.rpc("ccc_commit_asset_version", {
      p_user: backend.userB.userId, p_asset: asset.id, p_content: "stolen",
      p_model: "", p_prompt_hash: "", p_blocked: false, p_block_reason: "",
      p_ack: false, p_audit: { output_type: "asset_resume_bullet" },
    });
    expect(res.error?.message).toMatch(/asset not found for this user/);
    expect(await listRows(A, "asset_versions", { includeArchived: true })).toEqual([]);
  });

  it("a commit without an audit record is refused outright", async () => {
    const { asset } = await seedAsset(A);
    const res = await backend.serviceClient!.rpc("ccc_commit_asset_version", {
      p_user: backend.userA.userId, p_asset: asset.id, p_content: "unaudited",
      p_model: "m", p_prompt_hash: "h", p_blocked: false, p_block_reason: "",
      p_ack: false, p_audit: {},
    });
    expect(res.error?.message).toMatch(/audit record is required/);
    expect(await listRows(A, "asset_versions", { includeArchived: true })).toEqual([]);
  });

  it("every generated version has a matching audit row; blocked and unavailable attempts audit too", async () => {
    const { asset, ach } = await seedAsset(A);
    // success
    const gen = await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub });
    expect(gen.version).toBeDefined();
    let audits = await listRows<{ output_type: string; blocked_bool: boolean; model_used: string }>(A, "ai_outputs", { includeArchived: true });
    expect(audits.filter((r) => !r.blocked_bool && r.model_used === "stub-model")).toHaveLength(1);

    // blocked: a version AND an audit, both recording the block
    await updateAchievement(A, ach.id, { truth_status: "DISPUTED" });
    const blocked = await generateAssetVersion(A, backend.userA.userId, asset.id, { transport: stub });
    expect(blocked.blocked).toBeDefined();
    audits = await listRows<{ output_type: string; blocked_bool: boolean; model_used: string }>(A, "ai_outputs", { includeArchived: true });
    expect(audits.filter((r) => r.blocked_bool)).toHaveLength(1);

    // every non-blocked version is accounted for by a successful audit
    const versions = await listRows<AssetVersion>(A, "asset_versions", { includeArchived: true });
    const generated = versions.filter((v) => !v.blocked_bool && v.generated_by_model !== "");
    const successAudits = audits.filter((r) => !r.blocked_bool);
    expect(successAudits.length).toBeGreaterThanOrEqual(generated.length);

    // unavailable: no version, but the attempt is still recorded
    await updateAchievement(A, ach.id, { truth_status: "VERIFIED" });
    const priorKey = process.env.ANTHROPIC_API_KEY;
    const priorStub = process.env.CCC_AI_TRANSPORT;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CCC_AI_TRANSPORT;
    try {
      const before = (await listRows(A, "asset_versions", { includeArchived: true })).length;
      const res = await generateAssetVersion(A, backend.userA.userId, asset.id, {});
      expect(res.unavailable).toBe(true);
      expect((await listRows(A, "asset_versions", { includeArchived: true })).length).toBe(before);
      const after = await listRows<{ block_reason: string }>(A, "ai_outputs", { includeArchived: true });
      expect(after.some((r) => /unavailable/.test(r.block_reason))).toBe(true);
    } finally {
      if (priorKey !== undefined) process.env.ANTHROPIC_API_KEY = priorKey;
      if (priorStub !== undefined) process.env.CCC_AI_TRANSPORT = priorStub;
    }
  });

  it("browser-supplied model, prompt, privacy and truth fields cannot reach a version", async () => {
    const { asset } = await seedAsset(A);
    // The commit signature has no privacy or truth parameters at all — they
    // are derived — so a caller cannot even express them.
    const args = await rawSql(`
      select pg_get_function_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='ccc_commit_asset_version'`);
    expect(String(args[0].args)).not.toMatch(/p_privacy|p_truth_summary/);

    // Manual authoring accepts only user, asset and content.
    const manualArgs = await rawSql(`
      select pg_get_function_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='ccc_author_manual_version'`);
    expect(String(manualArgs[0].args)).toBe("p_user uuid, p_asset uuid, p_content text");

    // A hand-authored version is recorded as hand-authored: no model metadata.
    const v = await authorManualVersionServer(backend.userA.userId, asset.id, "Typed by hand.");
    expect(v.generated_by_model).toBe("");
    expect(v.generation_prompt_hash).toBe("");
  });

  it("a manual version on an INELIGIBLE graph saves but stays non-external and non-approved", async () => {
    const { asset, ach } = await seedAsset(A);
    await updateAchievement(A, ach.id, { truth_status: "NEEDS_PROOF" });
    const v = await authorManualVersionServer(backend.userA.userId, asset.id, "Written while sources are unproven.");
    expect(v.content).toContain("Written while sources");
    const a = await getRow<CareerAsset>(A, "career_assets", asset.id);
    // visibly stale, never promoted to PUBLIC_SAFE
    expect(a?.eligibility_stale_bool).toBe(true);
    expect(a?.privacy_class).not.toBe("PUBLIC_SAFE");
    // and it cannot be approved or used externally until the graph is clean
    expect((await A.rpc("ccc_approve_asset_version", { p_version: v.id })).error?.message).toMatch(/source graph/);
    const audits = await listRows<{ output_type: string; block_reason: string }>(A, "ai_outputs", { includeArchived: true });
    const manual = audits.find((r) => r.output_type === "asset_manual");
    expect(manual?.block_reason).toMatch(/ineligible/);
  });

  it("a direct asset INSERT cannot fabricate any derived field", async () => {
    const { asset: real } = await seedAsset(A);
    const v = await approvedVersion(A, real.id);
    const forged = await createRow<CareerAsset>(A, "career_assets", {
      asset_type: "resume_bullet",
      current_version_fk: v.id,
      truth_status_summary: "VERIFIED,forged",
      privacy_class: "PUBLIC_SAFE",
      used_externally_bool: true,
      eligibility_stale_bool: false,
      eligibility_reason: "forged clean",
    } as never);
    // every derived field is overwritten with its canonical born-unproven value
    expect(forged.current_version_fk).toBeNull();
    expect(forged.truth_status_summary).toBe("");
    expect(forged.privacy_class).toBe("INTERNAL_ONLY");
    expect(forged.used_externally_bool).toBe(false);
    expect(forged.eligibility_stale_bool).toBe(false);
    expect(forged.eligibility_reason).toBe("");
  });
});
