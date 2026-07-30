import type { SupabaseClient } from "@supabase/supabase-js";
import {
  achievementInputSchema,
  achievementPatchSchema,
  evidenceItemInputSchema,
  evidenceItemPatchSchema,
  metricInputSchema,
  metricPatchSchema,
  projectInputSchema,
  projectPatchSchema,
  quickLogInputSchema,
  type Achievement,
  type AchievementInput,
  type AchievementPatch,
  type EvidenceItem,
  type EvidenceItemInput,
  type EvidenceItemPatch,
  type Metric,
  type MetricInput,
  type MetricPatch,
  type Project,
  type ProjectInput,
  type ProjectPatch,
  type QuickLogInput,
} from "./types";

// Data access for the four canonical P0A entities.
//
// Lifecycle is archival (v2.1.1 A2): there are deliberately NO delete
// functions in this module. Records move between draft/active/archived via
// status updates and stay recoverable. user_id is never sent from the client
// — the column defaults to auth.uid() and RLS rejects anything else.

export class RepoError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RepoError";
  }
}

function throwIf(error: { message: string } | null, action: string): void {
  if (error) throw new RepoError(`${action}: ${error.message}`, error);
}

// RLS silently filters rows the caller cannot touch, so "0 rows returned"
// from an update means not-found (or not-yours).
function requireRow<T>(rows: T[] | null, action: string): T {
  if (!rows || rows.length === 0) {
    throw new RepoError(`${action}: row not found`);
  }
  return rows[0];
}

// ── projects ─────────────────────────────────────────────────────────────────

export async function createProject(db: SupabaseClient, input: ProjectInput): Promise<Project> {
  const parsed = projectInputSchema.parse(input);
  const { data, error } = await db.from("projects").insert(parsed).select();
  throwIf(error, "create project");
  return requireRow(data as Project[] | null, "create project");
}

export async function listProjects(
  db: SupabaseClient,
  opts?: { includeArchived?: boolean },
): Promise<Project[]> {
  let query = db.from("projects").select("*").order("created_at", { ascending: false });
  if (!opts?.includeArchived) query = query.eq("status", "active");
  const { data, error } = await query;
  throwIf(error, "list projects");
  return (data ?? []) as Project[];
}

export async function getProject(db: SupabaseClient, id: string): Promise<Project | null> {
  const { data, error } = await db.from("projects").select("*").eq("id", id).maybeSingle();
  throwIf(error, "get project");
  return (data as Project | null) ?? null;
}

export async function updateProject(
  db: SupabaseClient,
  id: string,
  patch: ProjectPatch,
): Promise<Project> {
  const parsed = projectPatchSchema.parse(patch);
  const { data, error } = await db.from("projects").update(parsed).eq("id", id).select();
  throwIf(error, "update project");
  return requireRow(data as Project[] | null, "update project");
}

export async function archiveProject(db: SupabaseClient, id: string): Promise<Project> {
  return updateProject(db, id, { status: "archived" });
}

export async function restoreProject(db: SupabaseClient, id: string): Promise<Project> {
  return updateProject(db, id, { status: "active" });
}

// ── achievements ─────────────────────────────────────────────────────────────

export async function createAchievement(
  db: SupabaseClient,
  input: AchievementInput,
): Promise<Achievement> {
  const parsed = achievementInputSchema.parse(input);
  const { data, error } = await db.from("achievements").insert(parsed).select();
  throwIf(error, "create achievement");
  return requireRow(data as Achievement[] | null, "create achievement");
}

// Quick Log (v2.2 §5): headline + project only. The database applies the
// locked defaults — status draft, NEEDS_PROOF, INTERNAL_ONLY.
export async function quickLogAchievement(
  db: SupabaseClient,
  input: QuickLogInput,
): Promise<Achievement> {
  const parsed = quickLogInputSchema.parse(input);
  const { data, error } = await db.from("achievements").insert(parsed).select();
  throwIf(error, "quick log achievement");
  return requireRow(data as Achievement[] | null, "quick log achievement");
}

export async function listAchievements(
  db: SupabaseClient,
  opts?: { projectId?: string; status?: Achievement["status"]; includeArchived?: boolean },
): Promise<Achievement[]> {
  let query = db.from("achievements").select("*").order("created_at", { ascending: false });
  if (opts?.projectId) query = query.eq("project_fk", opts.projectId);
  if (opts?.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  throwIf(error, "list achievements");
  const rows = (data ?? []) as Achievement[];
  // Default views exclude archived (v2.1.1 A2) unless explicitly requested.
  if (opts?.status || opts?.includeArchived) return rows;
  return rows.filter((a) => a.status !== "archived");
}

export async function getAchievement(db: SupabaseClient, id: string): Promise<Achievement | null> {
  const { data, error } = await db.from("achievements").select("*").eq("id", id).maybeSingle();
  throwIf(error, "get achievement");
  return (data as Achievement | null) ?? null;
}

export async function updateAchievement(
  db: SupabaseClient,
  id: string,
  patch: AchievementPatch,
): Promise<Achievement> {
  const parsed = achievementPatchSchema.parse(patch);
  const { data, error } = await db.from("achievements").update(parsed).eq("id", id).select();
  throwIf(error, "update achievement");
  return requireRow(data as Achievement[] | null, "update achievement");
}

export async function archiveAchievement(db: SupabaseClient, id: string): Promise<Achievement> {
  return updateAchievement(db, id, { status: "archived" });
}

// Restoring an archived achievement returns it to draft — promotion back to
// active goes through the promotion gate, never silently.
export async function restoreAchievement(db: SupabaseClient, id: string): Promise<Achievement> {
  return updateAchievement(db, id, { status: "draft" });
}

// ── metrics ──────────────────────────────────────────────────────────────────

export async function createMetric(db: SupabaseClient, input: MetricInput): Promise<Metric> {
  const parsed = metricInputSchema.parse(input);
  const { data, error } = await db.from("metrics").insert(parsed).select();
  throwIf(error, "create metric");
  return requireRow(data as Metric[] | null, "create metric");
}

export async function listMetrics(
  db: SupabaseClient,
  opts?: { achievementId?: string; includeArchived?: boolean },
): Promise<Metric[]> {
  let query = db.from("metrics").select("*").order("created_at", { ascending: false });
  if (opts?.achievementId) query = query.eq("achievement_fk", opts.achievementId);
  if (!opts?.includeArchived) query = query.eq("status", "active");
  const { data, error } = await query;
  throwIf(error, "list metrics");
  return (data ?? []) as Metric[];
}

export async function getMetric(db: SupabaseClient, id: string): Promise<Metric | null> {
  const { data, error } = await db.from("metrics").select("*").eq("id", id).maybeSingle();
  throwIf(error, "get metric");
  return (data as Metric | null) ?? null;
}

export async function updateMetric(
  db: SupabaseClient,
  id: string,
  patch: MetricPatch,
): Promise<Metric> {
  const parsed = metricPatchSchema.parse(patch);
  const { data, error } = await db.from("metrics").update(parsed).eq("id", id).select();
  throwIf(error, "update metric");
  return requireRow(data as Metric[] | null, "update metric");
}

export async function archiveMetric(db: SupabaseClient, id: string): Promise<Metric> {
  return updateMetric(db, id, { status: "archived" });
}

export async function restoreMetric(db: SupabaseClient, id: string): Promise<Metric> {
  return updateMetric(db, id, { status: "active" });
}

// ── evidence_items ───────────────────────────────────────────────────────────

export async function createEvidenceItem(
  db: SupabaseClient,
  input: EvidenceItemInput,
): Promise<EvidenceItem> {
  const parsed = evidenceItemInputSchema.parse(input);
  const { data, error } = await db.from("evidence_items").insert(parsed).select();
  throwIf(error, "create evidence item");
  return requireRow(data as EvidenceItem[] | null, "create evidence item");
}

export async function listEvidenceItems(
  db: SupabaseClient,
  opts?: { achievementId?: string; includeArchived?: boolean },
): Promise<EvidenceItem[]> {
  let query = db.from("evidence_items").select("*").order("created_at", { ascending: false });
  if (opts?.achievementId) query = query.eq("achievement_fk", opts.achievementId);
  if (!opts?.includeArchived) query = query.eq("status", "active");
  const { data, error } = await query;
  throwIf(error, "list evidence items");
  return (data ?? []) as EvidenceItem[];
}

export async function getEvidenceItem(
  db: SupabaseClient,
  id: string,
): Promise<EvidenceItem | null> {
  const { data, error } = await db.from("evidence_items").select("*").eq("id", id).maybeSingle();
  throwIf(error, "get evidence item");
  return (data as EvidenceItem | null) ?? null;
}

export async function updateEvidenceItem(
  db: SupabaseClient,
  id: string,
  patch: EvidenceItemPatch,
): Promise<EvidenceItem> {
  const parsed = evidenceItemPatchSchema.parse(patch);
  const { data, error } = await db.from("evidence_items").update(parsed).eq("id", id).select();
  throwIf(error, "update evidence item");
  return requireRow(data as EvidenceItem[] | null, "update evidence item");
}

export async function archiveEvidenceItem(db: SupabaseClient, id: string): Promise<EvidenceItem> {
  return updateEvidenceItem(db, id, { status: "archived" });
}

export async function restoreEvidenceItem(db: SupabaseClient, id: string): Promise<EvidenceItem> {
  return updateEvidenceItem(db, id, { status: "active" });
}

// ── pipeline (working layer, v2.2 §4) ────────────────────────────────────────

export interface ActivityEntry {
  kind: "project" | "achievement" | "metric" | "evidence_item";
  id: string;
  label: string;
  status: string;
  created_at: string;
}

export async function listDraftAchievements(db: SupabaseClient): Promise<Achievement[]> {
  return listAchievements(db, { status: "draft" });
}

// Last 20 entries across all four entities, newest first.
export async function listRecentActivity(db: SupabaseClient, limit = 20): Promise<ActivityEntry[]> {
  const [projects, achievements, metrics, evidence] = await Promise.all([
    db.from("projects").select("*").order("created_at", { ascending: false }).limit(limit),
    db.from("achievements").select("*").order("created_at", { ascending: false }).limit(limit),
    db.from("metrics").select("*").order("created_at", { ascending: false }).limit(limit),
    db.from("evidence_items").select("*").order("created_at", { ascending: false }).limit(limit),
  ]);
  for (const r of [projects, achievements, metrics, evidence]) {
    throwIf(r.error, "list recent activity");
  }
  const entries: ActivityEntry[] = [
    ...((projects.data ?? []) as Project[]).map((p) => ({
      kind: "project" as const,
      id: p.id,
      label: p.name,
      status: p.status,
      created_at: p.created_at,
    })),
    ...((achievements.data ?? []) as Achievement[]).map((a) => ({
      kind: "achievement" as const,
      id: a.id,
      label: a.headline,
      status: a.status,
      created_at: a.created_at,
    })),
    ...((metrics.data ?? []) as Metric[]).map((m) => ({
      kind: "metric" as const,
      id: m.id,
      label: `${m.metric_name}: ${m.value}${m.unit ? ` ${m.unit}` : ""}`,
      status: m.status,
      created_at: m.created_at,
    })),
    ...((evidence.data ?? []) as EvidenceItem[]).map((e) => ({
      kind: "evidence_item" as const,
      id: e.id,
      label: e.content_summary.slice(0, 140),
      status: e.status,
      created_at: e.created_at,
    })),
  ];
  return entries
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit);
}

export interface ArchivedRecords {
  projects: Project[];
  achievements: Achievement[];
  metrics: Metric[];
  evidence_items: EvidenceItem[];
}

export async function listArchived(db: SupabaseClient): Promise<ArchivedRecords> {
  const [projects, achievements, metrics, evidence] = await Promise.all([
    db.from("projects").select("*").eq("status", "archived").order("created_at", { ascending: false }),
    db.from("achievements").select("*").eq("status", "archived").order("created_at", { ascending: false }),
    db.from("metrics").select("*").eq("status", "archived").order("created_at", { ascending: false }),
    db.from("evidence_items").select("*").eq("status", "archived").order("created_at", { ascending: false }),
  ]);
  for (const r of [projects, achievements, metrics, evidence]) {
    throwIf(r.error, "list archived");
  }
  return {
    projects: (projects.data ?? []) as Project[],
    achievements: (achievements.data ?? []) as Achievement[],
    metrics: (metrics.data ?? []) as Metric[],
    evidence_items: (evidence.data ?? []) as EvidenceItem[],
  };
}
