import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBackend, type TestBackend } from "./backends";
import {
  addAssetToCollection,
  approveVersion,
  AssetGateError,
  authorManualVersion,
  logExternalUse,
  revalidateAsset,
} from "../lib/assetService";
import { generateAssetVersion } from "../lib/server/assetGeneration";
import { buildPayloadManifest, gateGraph, resolveSourceGraph } from "../lib/sourceGraph";
import { createRow, getRow, listRows, updateRow } from "../lib/genericRepo";
import {
  createEvidenceItem,
  createMetric,
  createProject,
  quickLogAchievement,
  updateAchievement,
} from "../lib/repos";
import type { AssetVersion, CareerAsset } from "../lib/entities";

// Release blockers #2 (source-graph AI gating with EXACT outbound-payload
// inspection), #3 (safety through the full asset lifecycle), and #4
// (normalized relationships + version-chain integrity), exercised against the
// real migration chain with RLS enforced.

let backend: TestBackend;
let A: SupabaseClient;
let B: SupabaseClient;

beforeAll(async () => {
  backend = await createBackend();
  A = backend.userA.db;
  B = backend.userB.db;
  await backend.cleanup();
});
afterAll(async () => {
  await backend.cleanup();
  await backend.teardown();
});
beforeEach(async () => backend.cleanup());

const PRIVATE_RAW = "Confidential: premium-segment churn drop worth $47M ARR at DIRECTV";
const SANITIZED = "Improved retention by multiple points on a major subscription segment";

/** A capturing transport: deterministic, records the EXACT outbound payload. */
function capturingTransport() {
  const calls: Array<{ system: string; user: string }> = [];
  const transport = async (opts: { system: string; user: string }) => {
    calls.push({ system: opts.system, user: opts.user });
    return { ok: true as const, text: "Deterministic generated bullet.", model: "stub-model" };
  };
  return { transport, calls };
}

async function seedEligibleAsset(db: SupabaseClient) {
  const p = await createProject(db, { name: "Churn overhaul", employer: "DIRECTV" });
  const pub = await quickLogAchievement(db, { project_fk: p.id, headline: "Reduced churn forecast error by 18%" });
  await updateAchievement(db, pub.id, {
    truth_status: "VERIFIED",
    privacy_class: "PUBLIC_SAFE",
    narrative: "Rebuilt the churn model end to end",
    action_taken: "Led 3 analysts",
    outcome: "Error down 18%",
  });
  const priv = await quickLogAchievement(db, { project_fk: p.id, headline: "Premium retention lift" });
  await updateAchievement(db, priv.id, {
    truth_status: "ATTESTED_WITH_METRIC",
    privacy_class: "PRIVATE",
    narrative: PRIVATE_RAW,
  });
  await createRow(db, "sanitized_claims", {
    source_achievement_fk: priv.id,
    raw_private_text: PRIVATE_RAW,
    sanitized_public_text: SANITIZED,
    user_approved_at: new Date().toISOString(),
    privacy_class: "PUBLIC_SAFE",
  });
  const metric = await createMetric(db, {
    achievement_fk: pub.id,
    metric_name: "Forecast error",
    value: "18% reduction",
    truth_status: "VERIFIED",
    privacy_class: "PUBLIC_SAFE",
  });
  const asset = await createRow<CareerAsset>(db, "career_assets", { asset_type: "resume_bullet" });
  await createRow(db, "asset_source_achievements", { asset_fk: asset.id, achievement_fk: pub.id });
  await createRow(db, "asset_source_achievements", { asset_fk: asset.id, achievement_fk: priv.id });
  await createRow(db, "asset_source_metrics", { asset_fk: asset.id, metric_fk: metric.id });
  return { p, pub, priv, metric, asset };
}

describe("blocker #2 — exact outbound payload through the canonical source graph", () => {
  it("the serialized payload contains eligible text and the sanitized claim REPLACES private text", async () => {
    const { asset } = await seedEligibleAsset(A);
    const { transport, calls } = capturingTransport();
    const res = await generateAssetVersion(A, asset.id, { transport });
    expect(res.version).toBeDefined();
    expect(calls).toHaveLength(1);
    const payload = calls[0].system + "\n" + calls[0].user;
    // eligible PUBLIC_SAFE content is present
    expect(payload).toContain("Reduced churn forecast error by 18%");
    expect(payload).toContain("Forecast error");
    // the approved sanitized claim is present…
    expect(payload).toContain(SANITIZED);
    // …and the PRIVATE raw text is NOT — replaced, never appended
    expect(payload).not.toContain(PRIVATE_RAW);
    expect(payload).not.toContain("$47M");
    expect(payload).not.toContain("Confidential");
  });

  it("the manifest is exactly the eligible source texts and nothing else", async () => {
    const { asset } = await seedEligibleAsset(A);
    const graph = await resolveSourceGraph(A, asset.id);
    const gate = gateGraph(graph, { attestedNoMetricOverride: false });
    expect(gate.allowed).toBe(true);
    const manifest = buildPayloadManifest(graph, gate);
    expect(manifest).toHaveLength(3); // pub achievement, sanitized substitution, metric
    expect(manifest.join("\n")).not.toContain(PRIVATE_RAW);
    const substituted = graph.sources.find((s) => s.substituted_claim_id);
    expect(substituted?.text).toContain(SANITIZED);
  });

  it("an ineligible source blocks generation BEFORE any transport call, names the claim, and is audited", async () => {
    const { asset, pub } = await seedEligibleAsset(A);
    await updateAchievement(A, pub.id, { truth_status: "NEEDS_PROOF" });
    const { transport, calls } = capturingTransport();
    const res = await generateAssetVersion(A, asset.id, { transport });
    expect(res.blocked).toBeDefined();
    expect(calls).toHaveLength(0); // nothing left the building
    expect(res.blocked!.map((r) => r.label).join(" ")).toContain("Reduced churn forecast error");
    const versions = await listRows<AssetVersion>(A, "asset_versions", { eq: { asset_fk: asset.id }, includeArchived: true });
    expect(versions.some((v) => v.blocked_bool && /NEEDS_PROOF/.test(v.block_reason))).toBe(true);
    const audits = await listRows<{ blocked_bool: boolean; block_reason: string }>(A, "ai_outputs", { includeArchived: true });
    expect(audits.some((a) => a.blocked_bool && /NEEDS_PROOF/.test(a.block_reason))).toBe(true);
  });

  it("a PRIVATE source without an approved claim blocks; INTERNAL_ONLY blocks; archived blocks; dangling blocks", async () => {
    const { asset, priv, metric } = await seedEligibleAsset(A);
    // remove the claim approval → private source blocks
    const claims = await listRows<{ id: string }>(A, "sanitized_claims", { includeArchived: true });
    await updateRow(A, "sanitized_claims", claims[0].id, { user_approved_at: null });
    let graph = await resolveSourceGraph(A, asset.id);
    let gate = gateGraph(graph, { attestedNoMetricOverride: false });
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.map((r) => r.reason).join(" ")).toMatch(/PRIVATE content cannot reach external assets/);
    expect(buildPayloadManifest(graph, gate)).toEqual([]);
    // restore approval; INTERNAL_ONLY still blocks
    await updateRow(A, "sanitized_claims", claims[0].id, { user_approved_at: new Date().toISOString() });
    await updateAchievement(A, priv.id, { privacy_class: "INTERNAL_ONLY" });
    graph = await resolveSourceGraph(A, asset.id);
    gate = gateGraph(graph, { attestedNoMetricOverride: false });
    expect(gate.reasons.map((r) => r.reason).join(" ")).toMatch(/INTERNAL_ONLY/);
    // archived metric blocks
    await updateAchievement(A, priv.id, { privacy_class: "PRIVATE" });
    await updateRow(A, "metrics", metric.id, { status: "archived" });
    graph = await resolveSourceGraph(A, asset.id);
    gate = gateGraph(graph, { attestedNoMetricOverride: false });
    expect(gate.reasons.map((r) => r.reason).join(" ")).toMatch(/archived/);
  });

  it("ATTESTED_NO_METRIC requires the explicit per-generation override", async () => {
    const { asset, pub } = await seedEligibleAsset(A);
    await updateAchievement(A, pub.id, { truth_status: "ATTESTED_NO_METRIC" });
    const { transport, calls } = capturingTransport();
    const blocked = await generateAssetVersion(A, asset.id, { transport });
    expect(blocked.blocked?.some((r) => /override/.test(r.reason))).toBe(true);
    expect(calls).toHaveLength(0);
    const ok = await generateAssetVersion(A, asset.id, { transport, attestedNoMetricOverride: true });
    expect(ok.version).toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("an eligible graph with NO transport and NO key reports unavailable and audits the attempt", async () => {
    const priorKey = process.env.ANTHROPIC_API_KEY;
    const priorStub = process.env.CCC_AI_TRANSPORT;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CCC_AI_TRANSPORT;
    try {
      const { asset } = await seedEligibleAsset(A);
      const res = await generateAssetVersion(A, asset.id, {});
      expect(res.unavailable).toBe(true);
      const audits = await listRows<{ blocked_bool: boolean; block_reason: string }>(A, "ai_outputs", { includeArchived: true });
      expect(audits.some((a) => a.blocked_bool && /unavailable/.test(a.block_reason))).toBe(true);
    } finally {
      if (priorKey !== undefined) process.env.ANTHROPIC_API_KEY = priorKey;
      if (priorStub !== undefined) process.env.CCC_AI_TRANSPORT = priorStub;
    }
  });
});

describe("blocker #3 — safety enforced through the full asset lifecycle", () => {
  it("a source turning ineligible AFTER generation marks the asset stale and blocks approve/use/collection", async () => {
    const { asset, pub } = await seedEligibleAsset(A);
    const { transport } = capturingTransport();
    const gen = await generateAssetVersion(A, asset.id, { transport });
    const versionId = gen.version!.id;
    // the world changes: the verified claim becomes DISPUTED
    await updateAchievement(A, pub.id, { truth_status: "DISPUTED" });
    await expect(approveVersion(A, versionId)).rejects.toThrow(AssetGateError);
    const stale = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(stale?.eligibility_stale_bool).toBe(true);
    expect(stale?.eligibility_reason).toMatch(/DISPUTED/);
    await expect(logExternalUse(A, asset.id, "LinkedIn", 1)).rejects.toThrow(AssetGateError);
    const coll = await createRow<{ id: string }>(A, "asset_collections", { name: "Resume v1", collection_type: "resume_version" });
    await expect(addAssetToCollection(A, coll.id, asset.id)).rejects.toThrow(AssetGateError);
    // blocked lifecycle attempts are audited too
    const audits = await listRows<{ output_type: string; blocked_bool: boolean }>(A, "ai_outputs", { includeArchived: true });
    expect(audits.some((a) => a.output_type === "asset_approval" && a.blocked_bool)).toBe(true);
    expect(audits.some((a) => a.output_type === "asset_external_use" && a.blocked_bool)).toBe(true);
    // recovery: source verified again → revalidation clears staleness
    await updateAchievement(A, pub.id, { truth_status: "VERIFIED" });
    const { gate } = await revalidateAsset(A, asset.id);
    expect(gate.allowed).toBe(true);
    expect((await getRow<CareerAsset>(A, "career_assets", asset.id))?.eligibility_stale_bool).toBe(false);
    const approved = await approveVersion(A, versionId);
    expect(approved.approved_by_user_bool).toBe(true);
    await logExternalUse(A, asset.id, "LinkedIn profile", 1);
    const used = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(used?.used_externally_bool).toBe(true);
    expect(used?.external_use_log).toHaveLength(1);
  });

  it("collection membership requires an approved version and goes through the junction", async () => {
    const { asset } = await seedEligibleAsset(A);
    const coll = await createRow<{ id: string }>(A, "asset_collections", { name: "Pack", collection_type: "interview_pack" });
    await expect(addAssetToCollection(A, coll.id, asset.id)).rejects.toThrow(/approved version/);
    const { transport } = capturingTransport();
    const gen = await generateAssetVersion(A, asset.id, { transport });
    await approveVersion(A, gen.version!.id);
    await addAssetToCollection(A, coll.id, asset.id);
    const members = await listRows<{ collection_fk: string; asset_fk: string }>(A, "collection_assets", { includeArchived: true });
    expect(members).toEqual([expect.objectContaining({ collection_fk: coll.id, asset_fk: asset.id })]);
  });

  it("manual authoring revalidates the graph and derives privacy from it — not from authorship", async () => {
    const { asset, pub } = await seedEligibleAsset(A);
    await updateAchievement(A, pub.id, { truth_status: "INFERRED" });
    const v = await authorManualVersion(A, asset.id, "Hand-written bullet");
    expect(v.content).toBe("Hand-written bullet");
    const a = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(a?.eligibility_stale_bool).toBe(true); // graph is not clean → flagged
    expect(a?.privacy_class).not.toBe("PUBLIC_SAFE"); // never derived from a dirty graph
  });
});

describe("blocker #4 — version-chain and junction integrity at the database", () => {
  it("generation builds an atomic chain: prior open version superseded, current repointed", async () => {
    const { asset } = await seedEligibleAsset(A);
    const { transport } = capturingTransport();
    const v1 = (await generateAssetVersion(A, asset.id, { transport })).version!;
    const v2 = (await generateAssetVersion(A, asset.id, { transport })).version!;
    expect(v2.version_number).toBe(v1.version_number + 1);
    const rows = await listRows<AssetVersion>(A, "asset_versions", { eq: { asset_fk: asset.id }, includeArchived: true });
    const r1 = rows.find((r) => r.id === v1.id)!;
    expect(r1.superseded_by_fk).toBe(v2.id);
    const a = await getRow<CareerAsset>(A, "career_assets", asset.id);
    expect(a?.current_version_fk).toBe(v2.id);
  });

  it("the DB rejects a current_version_fk pointing at another asset's version", async () => {
    const { asset } = await seedEligibleAsset(A);
    const { transport } = capturingTransport();
    await generateAssetVersion(A, asset.id, { transport });
    const other = await createRow<CareerAsset>(A, "career_assets", { asset_type: "story" });
    const v = (await listRows<AssetVersion>(A, "asset_versions", { eq: { asset_fk: asset.id }, includeArchived: true }))[0];
    const res = await A.from("career_assets").update({ current_version_fk: v.id }).eq("id", other.id).select();
    expect(res.error?.message).toMatch(/same asset/);
  });

  it("the DB rejects cross-asset supersession and supersession by an earlier version (cycles)", async () => {
    const { asset } = await seedEligibleAsset(A);
    const { transport } = capturingTransport();
    const v1 = (await generateAssetVersion(A, asset.id, { transport })).version!;
    const v2 = (await generateAssetVersion(A, asset.id, { transport })).version!;
    const otherAsset = await createRow<CareerAsset>(A, "career_assets", { asset_type: "story" });
    const foreign = await createRow<AssetVersion>(A, "asset_versions", { asset_fk: otherAsset.id, version_number: 1, content: "x" });
    const cross = await A.from("asset_versions").update({ superseded_by_fk: foreign.id }).eq("id", v1.id).select();
    expect(cross.error?.message).toMatch(/same asset/);
    const cycle = await A.from("asset_versions").update({ superseded_by_fk: v1.id }).eq("id", v2.id).select();
    expect(cycle.error?.message).toMatch(/LATER version/);
  });

  it("junction rows cannot link another user's rows (composite same-user FK)", async () => {
    const { asset } = await seedEligibleAsset(A);
    const pB = await createProject(B, { name: "B project" });
    const aB = await quickLogAchievement(B, { project_fk: pB.id, headline: "B achievement" });
    const res = await A.from("asset_source_achievements")
      .insert({ asset_fk: asset.id, achievement_fk: aB.id })
      .select();
    expect(res.error).not.toBeNull();
  });

  it("duplicate junction rows are rejected (uniqueness)", async () => {
    const { asset, pub } = await seedEligibleAsset(A);
    const dup = await A.from("asset_source_achievements")
      .insert({ asset_fk: asset.id, achievement_fk: pub.id })
      .select();
    expect(dup.error).not.toBeNull();
  });
});
