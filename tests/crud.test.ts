import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBackend, type TestBackend } from "./backends";
import * as repos from "../lib/repos";
import {
  archiveAchievement,
  archiveMetric,
  createEvidenceItem,
  createMetric,
  createProject,
  getAchievement,
  getProject,
  listAchievements,
  listArchived,
  listDraftAchievements,
  listEvidenceItems,
  listMetrics,
  listProjects,
  listRecentActivity,
  quickLogAchievement,
  RepoError,
  restoreAchievement,
  updateAchievement,
  updateProject,
} from "../lib/repos";
import { PromotionBlockedError, promoteAchievement } from "../lib/promotion";
import { createRow, listRows, updateRow } from "../lib/genericRepo";
import { generateGapReport, runComparator } from "../lib/comparator";
import { computeMaturity } from "../lib/maturity";
import { buildCandidateActions, getOrCreateBrief, weekOf } from "../lib/rhythm";
import { ensureVisaChecklist } from "../lib/visa";
import { buildGraderPayload } from "../lib/aiSafety";
import type { Offer, TargetArchetype, VisaChecklistItem } from "../lib/entities";

let backend: TestBackend;
let A: SupabaseClient;
let B: SupabaseClient;

beforeAll(async () => {
  backend = await createBackend();
  A = backend.userA.db;
  B = backend.userB.db;
  console.log(`behavior suite backend: ${backend.name}`);
  await backend.cleanup();
});
afterAll(async () => {
  await backend.cleanup();
  await backend.teardown();
});
beforeEach(async () => backend.cleanup());

async function seedProject(db: SupabaseClient, name = "Churn forecasting overhaul") {
  return createProject(db, { name, employer: "DIRECTV", role_at_time: "Sr Manager, Analytics" });
}
async function seedDraft(db: SupabaseClient, projectId: string, headline = "Reduced churn forecast error by 18%") {
  return quickLogAchievement(db, { project_fk: projectId, headline });
}

describe("canonical CRUD and persistence", () => {
  it("round-trips every canonical project field verbatim", async () => {
    const p = await createProject(A, {
      name: "Exec retention dashboard",
      employer: "DIRECTV",
      role_at_time: "Sr Manager",
      start_date: "2024-02-01",
      end_date: null,
      description: "Executive-facing retention analytics",
      business_context: "Churn was the #1 board topic",
      my_scope: "Owned modeling + delivery across 3 teams",
      team_size: 9,
      stakeholders: ["CFO office", "VP CX"],
      privacy_class: "PRIVATE",
    });
    expect(p.employer).toBe("DIRECTV");
    expect(p.stakeholders).toEqual(["CFO office", "VP CX"]);
    expect(p.team_size).toBe(9);
    expect(p.status).toBe("active");
    const fetched = await getProject(A, p.id);
    expect(fetched?.business_context).toBe("Churn was the #1 board topic");
    const updated = await updateProject(A, p.id, { my_scope: "Expanded to 5 teams" });
    expect(updated.my_scope).toBe("Expanded to 5 teams");
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(p.updated_at));
  });

  it("quick log creates a draft achievement with locked defaults", async () => {
    const p = await seedProject(A);
    const a = await seedDraft(A, p.id);
    expect(a.status).toBe("draft");
    expect(a.truth_status).toBe("NEEDS_PROOF");
    expect(a.privacy_class).toBe("INTERNAL_ONLY");
    expect(a.has_metric_bool).toBe(false);
    expect(a.candidate_for_external_bool).toBe(false);
    expect(a.project_fk).toBe(p.id);
  });

  it("metric and evidence CRUD with canonical fields; has_metric_bool syncs", async () => {
    const p = await seedProject(A);
    const a = await seedDraft(A, p.id);
    const m = await createMetric(A, {
      achievement_fk: a.id,
      metric_name: "Churn forecast error",
      value: "18% reduction",
      unit: "pp",
      time_period: "Q2 2025",
      baseline_value: "4.2pp",
      calculation_notes: "Holdout validated",
    });
    expect((await getAchievement(A, a.id))?.has_metric_bool).toBe(true);
    const e = await createEvidenceItem(A, {
      achievement_fk: a.id,
      type: "email_ref",
      content_summary: "VP email confirming the result",
      verified_by: "manager",
      verified_at: new Date().toISOString(),
    });
    expect(e.type).toBe("email_ref");
    expect((await listMetrics(A, { achievementId: a.id }))[0].baseline_value).toBe("4.2pp");
    await archiveMetric(A, m.id);
    expect((await getAchievement(A, a.id))?.has_metric_bool).toBe(false);
    expect(await listMetrics(A, { achievementId: a.id })).toHaveLength(0); // default excludes archived
    expect(await listEvidenceItems(A, { achievementId: a.id })).toHaveLength(1);
  });

  it("rejects achievements without a project (no standalone)", async () => {
    await expect(
      A.from("achievements").insert({ headline: "orphan" }).select(),
    ).resolves.toMatchObject({ error: expect.objectContaining({ message: expect.stringMatching(/null|project_fk/i) }) });
  });

  it("updating a nonexistent row throws RepoError", async () => {
    await expect(
      updateAchievement(A, "00000000-0000-0000-0000-000000000001", { headline: "x" }),
    ).rejects.toThrow(RepoError);
  });
});

describe("archival lifecycle (no hard deletion in the product)", () => {
  it("archive hides from default lists; archived list shows; restore returns to draft", async () => {
    const p = await seedProject(A);
    const a = await seedDraft(A, p.id);
    await archiveAchievement(A, a.id);
    expect((await listAchievements(A)).find((x) => x.id === a.id)).toBeUndefined();
    const archived = await listArchived(A);
    expect(archived.achievements.map((x) => x.id)).toContain(a.id);
    const restored = await restoreAchievement(A, a.id);
    expect(restored.status).toBe("draft");
  });

  it("archiving a project keeps its achievements' relationship intact", async () => {
    const p = await seedProject(A);
    const a = await seedDraft(A, p.id);
    await repos.archiveProject(A, p.id);
    const after = await getAchievement(A, a.id);
    expect(after?.project_fk).toBe(p.id); // nothing silently disappears
  });

  it("the product repo layer exposes no delete functions", () => {
    const exported = Object.keys(repos);
    expect(exported.filter((k) => k.toLowerCase().startsWith("delete"))).toEqual([]);
    expect(exported).toContain("archiveAchievement");
    expect(exported).toContain("restoreAchievement");
  });

  it("no export module or deferred-feature code ships", () => {
    expect(fs.existsSync(path.resolve(__dirname, "../lib/export.ts"))).toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
    expect(deps).not.toMatch(/pdf|puppeteer-pdf|linkedin|openai/i);
  });
});

describe("database-level security", () => {
  it("cross-user project linking fails at the database (composite FK)", async () => {
    const pA = await seedProject(A);
    const { error } = await B.from("achievements")
      .insert({ project_fk: pA.id, headline: "hijack attempt" })
      .select();
    expect(error).not.toBeNull();
  });

  it("cross-user achievement linking fails for metrics and evidence", async () => {
    const pA = await seedProject(A);
    const aA = await seedDraft(A, pA.id);
    const metric = await B.from("metrics")
      .insert({ achievement_fk: aA.id, metric_name: "x", value: "1" })
      .select();
    expect(metric.error).not.toBeNull();
    const evidence = await B.from("evidence_items")
      .insert({ achievement_fk: aA.id, type: "note", content_summary: "x" })
      .select();
    expect(evidence.error).not.toBeNull();
  });

  it("RLS hides rows and blocks cross-user update/archive", async () => {
    const pA = await seedProject(A);
    expect(await getProject(B, pA.id)).toBeNull();
    expect(await listProjects(B)).toHaveLength(0);
    await expect(updateProject(B, pA.id, { name: "stolen" })).rejects.toThrow(RepoError);
    expect((await getProject(A, pA.id))?.name).not.toBe("stolen");
  });

  it("spoofed user_id fails on insert and update", async () => {
    const insert = await B.from("projects")
      .insert({ name: "spoof", user_id: backend.userA.userId })
      .select();
    expect(insert.error).not.toBeNull();
    const pB = await seedProject(B, "B's own");
    const update = await B.from("projects")
      .update({ user_id: backend.userA.userId })
      .eq("id", pB.id)
      .select();
    expect(update.error).not.toBeNull();
  });
});

describe("promotion gate (server-side)", () => {
  it("rejects with specific reasons, then promotes when satisfied", async () => {
    const p = await seedProject(A);
    const a = await seedDraft(A, p.id);
    const attempt = promoteAchievement(A, a.id, { privacyAffirmed: false, keepNeedsProofConfirmed: false });
    await expect(attempt).rejects.toThrow(PromotionBlockedError);
    await attempt.catch((e: PromotionBlockedError) => {
      expect(e.reasons.length).toBeGreaterThanOrEqual(3);
    });
    await updateAchievement(A, a.id, { narrative: "Framed the problem, built the model, shipped it." });
    await createMetric(A, { achievement_fk: a.id, metric_name: "Error", value: "18% down" });
    const promoted = await promoteAchievement(A, a.id, {
      privacyAffirmed: true,
      keepNeedsProofConfirmed: true,
    });
    expect(promoted.status).toBe("active");
  });
});

describe("pipeline working layer", () => {
  it("drafts, recent activity (max 20, newest first), archived + restore", async () => {
    const p = await seedProject(A);
    for (let i = 0; i < 22; i++) await seedDraft(A, p.id, `Draft ${i}`);
    const drafts = await listDraftAchievements(A);
    expect(drafts).toHaveLength(22);
    const recent = await listRecentActivity(A);
    expect(recent).toHaveLength(20);
    for (let i = 1; i < recent.length; i++) {
      expect(recent[i - 1].created_at >= recent[i].created_at).toBe(true);
    }
    await archiveAchievement(A, drafts[0].id);
    const archived = await listArchived(A);
    expect(archived.achievements).toHaveLength(1);
  });
});

describe("P0B sanitization", () => {
  it("approval requires PUBLIC_SAFE output class (DB constraint)", async () => {
    const p = await seedProject(A);
    const a = await seedDraft(A, p.id);
    const claim = await createRow<{ id: string }>(A, "sanitized_claims", {
      source_achievement_fk: a.id,
      raw_private_text: "Retention improved 4.2pp on the premium segment worth $XXM",
      sanitized_public_text: "Improved retention by multiple points on a major segment",
      sanitization_method: "template",
    });
    const bad = await A.from("sanitized_claims")
      .update({ user_approved_at: new Date().toISOString() })
      .eq("id", claim.id)
      .select();
    expect(bad.error).not.toBeNull();
    const good = await A.from("sanitized_claims")
      .update({ user_approved_at: new Date().toISOString(), privacy_class: "PUBLIC_SAFE" })
      .eq("id", claim.id)
      .select();
    expect(good.error).toBeNull();
  });

  it("PRIVATE achievements are gradable only via an approved sanitized claim (firewall)", async () => {
    const p = await seedProject(A);
    const a = await seedDraft(A, p.id);
    await updateAchievement(A, a.id, { privacy_class: "PRIVATE", narrative: "raw confidential detail" });
    const blocked = await buildGraderPayload(A, a.id);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons[0].reason).toMatch(/sanitized claim/i);
    await createRow(A, "sanitized_claims", {
      source_achievement_fk: a.id,
      raw_private_text: "raw confidential detail",
      sanitized_public_text: "De-identified claim",
      user_approved_at: new Date().toISOString(),
      privacy_class: "PUBLIC_SAFE",
    });
    const allowed = await buildGraderPayload(A, a.id);
    expect(allowed.allowed).toBe(true);
    expect(allowed.payload?.usedSanitizedClaim).toBe(true);
    expect(allowed.payload?.narrativeForModel).not.toContain("raw confidential detail");
  });
});

describe("P0D comparator", () => {
  it("refuses unapproved archetypes; reports gaps then coverage; persists gap report", async () => {
    const arch = await createRow<TargetArchetype>(A, "target_archetypes", {
      name: "Director, Analytics @ Tier-1 Tech",
      required_skills: ["Python"],
      expected_metrics: ["retention"],
      seniority_signals: ["org-level influence"],
      expected_scope: ["multi-team"],
    });
    await expect(runComparator(A, arch)).rejects.toThrow(/approved/);
    const approved = await updateRow<TargetArchetype>(A, "target_archetypes", arch.id, {
      approved_by_user_bool: true,
    });
    const before = await runComparator(A, approved);
    expect(before.gaps.length).toBeGreaterThanOrEqual(3);
    const p = await seedProject(A);
    const a = await seedDraft(A, p.id);
    await createMetric(A, { achievement_fk: a.id, metric_name: "Retention lift", value: "2.1pp" });
    const skill = await createRow<{ id: string }>(A, "skills", { name: "Python", category: "technical" });
    await createRow(A, "skill_evidence", {
      skill_fk: skill.id,
      achievement_fk: a.id,
      demonstration_strength_1_to_5: 4,
    });
    const after = await runComparator(A, approved);
    expect(after.covered.map((c) => c.dimension)).toContain("skill: Python");
    expect(after.covered.map((c) => c.dimension)).toContain("metric: retention");
    const report = await generateGapReport(A, approved);
    expect(report.archetype_fk).toBe(arch.id);
  });
});

describe("P0E asset governance", () => {
  it("only one current resume_version collection per user (DB index)", async () => {
    await createRow(A, "asset_collections", {
      name: "Resume v1",
      collection_type: "resume_version",
      current_bool: true,
    });
    const second = await A.from("asset_collections")
      .insert({ name: "Resume v2", collection_type: "resume_version", current_bool: true })
      .select();
    expect(second.error).not.toBeNull();
    const pack = await A.from("asset_collections")
      .insert({ name: "Loop pack", collection_type: "interview_pack", current_bool: true })
      .select();
    expect(pack.error).toBeNull();
  });
});

describe("P0F visa checklist + Offer Gate 7", () => {
  it("seeds the eight canonical gates idempotently", async () => {
    const first = await ensureVisaChecklist(A);
    expect(first).toHaveLength(8);
    expect(first[5].attorney_confirmation_required_bool).toBe(true);
    expect((await ensureVisaChecklist(A))).toHaveLength(8);
  });

  it("attorney-gated states cannot complete without confirmation (DB constraint)", async () => {
    const gates = await ensureVisaChecklist(A);
    const g6 = gates.find((g) => g.ordinal === 6)!;
    const bad = await A.from("visa_checklist_items").update({ status: "complete" }).eq("id", g6.id).select();
    expect(bad.error).not.toBeNull();
    const good = await A.from("visa_checklist_items")
      .update({ status: "complete", attorney_confirmed_at: new Date().toISOString() })
      .eq("id", g6.id)
      .select();
    expect(good.error).toBeNull();
  });

  it("an offer cannot be accepted while Gate 7 is incomplete (DB trigger)", async () => {
    await ensureVisaChecklist(A);
    const offer = await createRow<Offer>(A, "offers", {
      role_title: "Director, Analytics",
      status: "negotiating",
      visa_sponsorship_committed_bool: true,
      priority_date_retention_committed_bool: true,
      attorney_reviewed_at: new Date().toISOString(),
    });
    const blocked = await A.from("offers").update({ status: "accepted" }).eq("id", offer.id).select();
    expect(blocked.error?.message).toMatch(/Gate 7/);
    const gates = await listRows<VisaChecklistItem>(A, "visa_checklist_items", { includeArchived: true });
    for (const g of gates.filter((g) => g.ordinal <= 7)) {
      await updateRow(A, "visa_checklist_items", g.id, {
        status: "complete",
        attorney_confirmed_at: g.attorney_confirmation_required_bool ? new Date().toISOString() : null,
      });
    }
    const accepted = await A.from("offers").update({ status: "accepted" }).eq("id", offer.id).select();
    expect(accepted.error).toBeNull();
  });

  it("an offer missing sponsorship commitments cannot be accepted even at Gate 7", async () => {
    const gates = await ensureVisaChecklist(A);
    for (const g of gates.filter((g) => g.ordinal <= 7)) {
      await updateRow(A, "visa_checklist_items", g.id, {
        status: "complete",
        attorney_confirmed_at: g.attorney_confirmation_required_bool ? new Date().toISOString() : null,
      });
    }
    const offer = await createRow<Offer>(A, "offers", { role_title: "Dir", status: "received" });
    const blocked = await A.from("offers").update({ status: "accepted" }).eq("id", offer.id).select();
    expect(blocked.error?.message).toMatch(/sponsorship|attorney/i);
  });
});

describe("references overlay", () => {
  it("cannot record application use until willingness is confirmed (DB constraint)", async () => {
    const contact = await createRow<{ id: string }>(A, "contacts", { name: "Jordan Reeves" });
    const ref = await createRow<{ id: string }>(A, "references", {
      contact_fk: contact.id,
      reference_type: "manager",
    });
    const app = await createRow<{ id: string }>(A, "applications", { role_title: "Director, Analytics" });
    const bad = await A.from("references")
      .update({ used_for_application_refs: [app.id] })
      .eq("id", ref.id)
      .select();
    expect(bad.error).not.toBeNull();
    await updateRow(A, "references", ref.id, {
      willingness_status: "confirmed",
      willingness_confirmed_at: new Date().toISOString(),
    });
    const good = await A.from("references")
      .update({ used_for_application_refs: [app.id] })
      .eq("id", ref.id)
      .select();
    expect(good.error).toBeNull();
  });
});

describe("P0G rhythm + maturity gates", () => {
  it("briefs are idempotent per week/type; candidate actions include gated outward motion", async () => {
    const week = weekOf(new Date());
    const b1 = await getOrCreateBrief(A, "friday_capture", week, "capture");
    const b2 = await getOrCreateBrief(A, "friday_capture", week, "capture again");
    expect(b2.id).toBe(b1.id);
    await ensureVisaChecklist(A);
    const candidates = await buildCandidateActions(A);
    expect(candidates).toHaveLength(5);
    const outward = candidates.filter((c) => c.outward_facing_bool);
    expect(outward.length).toBeGreaterThanOrEqual(1);
    // Gates all incomplete → outward action must be from the Gates 1–4 menu.
    expect(outward[0].title).toMatch(/brand-building/i);
  });

  it("maturity gates compute from real data and honor the logged owner override", async () => {
    const locked = await computeMaturity(A);
    expect(locked.unlocked).toBe(false);
    expect(locked.criteria.find((c) => c.key === "achievements_15")?.met).toBe(false);
    const p = await seedProject(A);
    for (let i = 0; i < 15; i++) await seedDraft(A, p.id, `Achievement ${i}`);
    const withData = await computeMaturity(A);
    expect(withData.criteria.find((c) => c.key === "achievements_15")?.met).toBe(true);
    expect(withData.unlocked).toBe(false); // other gates still unmet
    await createRow(A, "owner_overrides", {
      override_key: "maturity_dev_override",
      enabled_bool: true,
      reason: "validation run",
    });
    const overridden = await computeMaturity(A);
    expect(overridden.overrideActive).toBe(true);
    expect(overridden.unlocked).toBe(true);
    expect(overridden.allMet).toBe(false); // override never fabricates criteria
  });
});
