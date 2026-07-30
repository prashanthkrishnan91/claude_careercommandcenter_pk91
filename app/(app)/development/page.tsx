"use client";

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, SpecCard, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { archiveRow, createRow, listRows, updateRow } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { listAchievements } from "@/lib/repos";
import type { Application } from "@/lib/entities";
import { getSupabase } from "@/lib/supabase";
import type {
  Contact,
  ReferenceRecord,
  Skill,
  SkillDevelopmentPlan,
  SkillDevelopmentProgress,
  SkillEvidence,
} from "@/lib/entities";

// Development: skills taxonomy + evidence, skeletal development plans with
// progress, and references as a status overlay on contacts. Not an LMS, not
// a habit tracker; the app never contacts references on your behalf.

const SKILL_SPECS: FieldSpec[] = [
  { key: "name", label: "Skill", kind: "text", required: true },
  { key: "category", label: "Category", kind: "select", options: ["technical", "domain", "leadership", "tooling"] },
  { key: "director_relevance_score", label: "Director relevance (1–5)", kind: "number" },
];
const PLAN_SPECS: FieldSpec[] = [
  { key: "gap_source", label: "Gap source", kind: "select", options: ["archetype_comparator", "self_identified", "interview_feedback", "manager_feedback", "reference_feedback"] },
  { key: "current_level_1_to_5", label: "Current level", kind: "number" },
  { key: "target_level_1_to_5", label: "Target level", kind: "number" },
  { key: "method", label: "Method", kind: "select", options: ["work_project", "side_project", "course", "certification", "reading", "mentorship", "teaching", "other"] },
  { key: "method_details", label: "Method details", kind: "text" },
  { key: "estimated_hours", label: "Estimated hours", kind: "number" },
  { key: "start_date", label: "Start", kind: "date" },
  { key: "target_date", label: "Target", kind: "date" },
  { key: "rationale", label: "Why this skill matters", kind: "textarea", span: 2 },
];
const PROGRESS_SPECS: FieldSpec[] = [
  { key: "progress_date", label: "Date", kind: "date" },
  { key: "hours_invested", label: "Hours", kind: "number" },
  { key: "level_assessment_1_to_5", label: "Level assessment", kind: "number" },
  { key: "assessed_by", label: "Assessed by", kind: "select", options: ["self", "peer", "manager", "external"] },
  { key: "notes", label: "Notes", kind: "textarea", span: 2 },
];
const REFERENCE_SPECS: FieldSpec[] = [
  { key: "reference_type", label: "Type", kind: "select", options: ["manager", "skip_level", "peer", "direct_report", "executive", "client", "external_partner", "other"] },
  { key: "employer_at_time", label: "Employer at the time", kind: "text" },
  { key: "working_relationship_period_start", label: "Worked together from", kind: "date" },
  { key: "working_relationship_period_end", label: "…to", kind: "date" },
  { key: "relationship_summary", label: "Relationship summary", kind: "textarea", span: 2 },
  { key: "strongest_themes", label: "Strongest themes", kind: "tags", span: 2 },
  { key: "cadence_target_months", label: "Touch cadence (months)", kind: "number" },
  { key: "next_touch_due", label: "Next touch due", kind: "date" },
  { key: "willingness_notes", label: "Willingness notes", kind: "textarea", span: 2 },
];

const WILLINGNESS = ["unconfirmed", "confirmed", "tentative", "declined", "do_not_ask"] as const;

export default function DevelopmentPage() {
  const { bump } = useShell();
  const db = getSupabase();
  const loader = useCallback(async (dbc: SupabaseClient) => {
    const [skills, skillEvidence, plans, progress, references, contacts, achievements, applications, refUses] = await Promise.all([
      listRows<Skill>(dbc, "skills", {}),
      listRows<SkillEvidence>(dbc, "skill_evidence", {}),
      listRows<SkillDevelopmentPlan>(dbc, "skill_development_plans", { includeArchived: true }),
      listRows<SkillDevelopmentProgress>(dbc, "skill_development_progress", { includeArchived: true }),
      listRows<ReferenceRecord>(dbc, "references", {}),
      listRows<Contact>(dbc, "contacts", {}),
      listAchievements(dbc),
      listRows<Application>(dbc, "applications", {}),
      listRows<{ id: string; reference_fk: string; application_fk: string }>(dbc, "reference_application_uses", { includeArchived: true }),
    ]);
    return { skills, skillEvidence, plans, progress, references, contacts, achievements, applications, refUses };
  }, []);
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  const skillName = new Map(data.skills.map((s) => [s.id, s.name]));
  const contactName = new Map(data.contacts.map((c) => [c.id, c.name]));

  return (
    <main>
      <PageHeader crumb="development" title="Development" />
      <div className="space-y-8 px-4 py-5 md:px-8">
        {/* skills */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="microlabel">skills · {data.skills.length}</h2>
            <SpecAddForm title="Add skill" specs={SKILL_SPECS} onCreate={async (v) => { await createRow(db, "skills", normalizeSpecValues(SKILL_SPECS, v)); bump(); }} />
          </div>
          {data.skills.length === 0 ? (
            <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
              No skills in the taxonomy. Skills link to achievements through skill evidence; the comparator reads them.
            </p>
          ) : (
            <ul className="panel divide-y divide-ink-700/70">
              {data.skills.map((s) => {
                const ev = data.skillEvidence.filter((e) => e.skill_fk === s.id);
                return (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{s.name}</span>
                    <span className="font-mono text-[10px] uppercase text-dim-500">{s.category}</span>
                    {s.director_relevance_score !== null && <span className="font-mono text-[10px] text-dim-500">dir {s.director_relevance_score}/5</span>}
                    <span className="font-mono text-[10px] text-dim-500">{ev.length} evidence link(s)</span>
                    {data.achievements.length > 0 && (
                      <button
                        className="btn-quiet"
                        onClick={async () => {
                          const pick = window.prompt(
                            `Link achievement as evidence (strength 1-5 appended after |):\n${data.achievements.map((a, i) => `${i + 1}. ${a.headline}`).join("\n")}\n\ne.g. "1|4"`,
                          );
                          if (!pick) return;
                          const [idx, strength] = pick.split("|").map((x) => parseInt(x.trim(), 10));
                          const target = data.achievements[idx - 1];
                          if (!target) return;
                          await createRow(db, "skill_evidence", {
                            skill_fk: s.id,
                            achievement_fk: target.id,
                            demonstration_strength_1_to_5: Math.min(5, Math.max(1, strength || 3)),
                          });
                          bump();
                        }}
                      >
                        + evidence
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* development plans */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="microlabel">development plans · {data.plans.length}</h2>
            {data.skills.length > 0 && (
              <SpecAddForm
                title="New plan"
                specs={[{ key: "skill_fk", label: "Skill", kind: "select", options: data.skills.map((s) => s.id), required: true }, ...PLAN_SPECS]}
                onCreate={async (v) => {
                  await createRow(db, "skill_development_plans", normalizeSpecValues([{ key: "skill_fk", label: "", kind: "select" }, ...PLAN_SPECS], v));
                  bump();
                }}
              />
            )}
          </div>
          {data.plans.length === 0 ? (
            <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
              No plans. A plan is a skeletal record of intent + method + progress; the studying happens outside the app.
            </p>
          ) : (
            <div className="space-y-2">
              {data.plans.map((p) => {
                const entries = data.progress.filter((x) => x.plan_fk === p.id);
                const stale = p.status === "in_progress" && Date.now() - Date.parse(p.updated_at) > 60 * 86400_000;
                return (
                  <details key={p.id} className="panel px-4 py-2">
                    <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{skillName.get(p.skill_fk) ?? "skill"}</span>
                      <span className="font-mono text-[10px] text-dim-500">{p.current_level_1_to_5 ?? "?"} → {p.target_level_1_to_5 ?? "?"}</span>
                      <span className="font-mono text-[10px] uppercase text-dim-500">{p.method.replace("_", " ")}</span>
                      {stale && <span className="font-mono text-[10px] uppercase text-signal-amber">stale 60d+</span>}
                      <StatusBadge value={p.status} />
                      <select
                        className="rounded-sm border border-ink-600 bg-ink-900 px-1 py-0.5 font-mono text-[10px] uppercase text-dim-300"
                        value={p.status}
                        onClick={(e) => e.preventDefault()}
                        onChange={async (e) => {
                          const patch: Record<string, unknown> = { status: e.target.value };
                          if (e.target.value === "abandoned") {
                            patch.abandon_reason = window.prompt("Abandon reason (kept as signal):") ?? "";
                          }
                          await updateRow(db, "skill_development_plans", p.id, patch);
                          bump();
                        }}
                      >
                        {["planned", "in_progress", "completed", "paused", "abandoned"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                      </select>
                    </summary>
                    <div className="mt-3 space-y-3 border-t border-ink-700 pt-3">
                      <SpecCard row={p as never} specs={PLAN_SPECS} onPatch={async (patch) => { await updateRow(db, "skill_development_plans", p.id, patch); }} />
                      {entries.length > 0 && (
                        <ul className="border border-ink-700 text-[12px]">
                          {entries.map((e) => (
                            <li key={e.id} className="flex gap-3 border-b border-ink-800 px-3 py-1.5 last:border-0 text-dim-300">
                              <span className="font-mono text-[11px] text-dim-500">{e.progress_date}</span>
                              <span className="flex-1">{e.notes}</span>
                              {e.hours_invested !== null && <span className="font-mono text-[11px]">{e.hours_invested}h</span>}
                              {e.level_assessment_1_to_5 !== null && <span className="font-mono text-[11px]">lvl {e.level_assessment_1_to_5} ({e.assessed_by})</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      <SpecAddForm title="Log progress" specs={PROGRESS_SPECS} onCreate={async (v) => { await createRow(db, "skill_development_progress", { plan_fk: p.id, ...normalizeSpecValues(PROGRESS_SPECS, v) }); bump(); }} />
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>

        {/* references */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="microlabel">references · {data.references.length} · overlay on contacts</h2>
            {data.contacts.length > 0 && (
              <SpecAddForm
                title="New reference"
                specs={[{ key: "contact_fk", label: "Contact", kind: "select", options: data.contacts.map((c) => c.id), required: true }, ...REFERENCE_SPECS]}
                onCreate={async (v) => {
                  await createRow(db, "references", normalizeSpecValues([{ key: "contact_fk", label: "", kind: "select" }, ...REFERENCE_SPECS], v));
                  bump();
                }}
              />
            )}
          </div>
          {data.references.length === 0 ? (
            <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
              No references cultivated. References must exist before the search activates — briefed on your current narrative, willingness confirmed before any use. Add contacts first (Career section).
            </p>
          ) : (
            <div className="space-y-2">
              {data.references.map((r) => (
                <details key={r.id} className="panel px-4 py-2">
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{contactName.get(r.contact_fk) ?? "contact"}</span>
                    <span className="font-mono text-[10px] uppercase text-dim-500">{r.reference_type.replace("_", " ")}</span>
                    {r.last_briefed_at && <span className="font-mono text-[10px] text-dim-500">briefed {r.last_briefed_at.slice(0, 10)}</span>}
                    <StatusBadge value={r.willingness_status} />
                    {r.willingness_status === "do_not_ask" ? (
                      <span className="font-mono text-[10px] uppercase text-signal-red" title="Honored permanently unless you deliberately change it">locked</span>
                    ) : (
                      <select
                        className="rounded-sm border border-ink-600 bg-ink-900 px-1 py-0.5 font-mono text-[10px] uppercase text-dim-300"
                        value={r.willingness_status}
                        onClick={(e) => e.preventDefault()}
                        onChange={async (e) => {
                          const next = e.target.value;
                          if (next === "do_not_ask" && !window.confirm("do_not_ask is honored permanently — this person will never be surfaced as a reference candidate. Continue?")) return;
                          await updateRow(db, "references", r.id, {
                            willingness_status: next,
                            willingness_confirmed_at: next === "confirmed" ? new Date().toISOString() : null,
                          });
                          bump();
                        }}
                      >
                        {WILLINGNESS.map((w) => <option key={w} value={w}>{w.replace(/_/g, " ")}</option>)}
                      </select>
                    )}
                  </summary>
                  <div className="mt-3 space-y-3 border-t border-ink-700 pt-3">
                    <SpecCard row={r as never} specs={REFERENCE_SPECS} onPatch={async (patch) => { await updateRow(db, "references", r.id, patch); }} />
                    <div className="flex flex-wrap items-center gap-3 text-[12px] text-dim-400">
                      <button
                        className="btn"
                        onClick={async () => {
                          await updateRow(db, "references", r.id, { last_briefed_at: new Date().toISOString(), briefing_method: "in_person" });
                          bump();
                        }}
                      >
                        Record narrative briefing
                      </button>
                      {data.applications.length > 0 && (
                        <button
                          className="btn"
                          title="Blocked by the database until willingness is confirmed"
                          onClick={async () => {
                            const name = window.prompt(`Use for which application?\n${data.applications.map((ap) => ap.role_title).join("\n")}`);
                            const app = data.applications.find((ap) => ap.role_title.toLowerCase() === name?.toLowerCase());
                            if (!app) return;
                            try {
                              await createRow(db, "reference_application_uses", { reference_fk: r.id, application_fk: app.id });
                            } catch (e) {
                              window.alert(e instanceof Error ? e.message : "blocked");
                            }
                            bump();
                          }}
                        >
                          Use for application ({data.refUses.filter((u) => u.reference_fk === r.id).length})
                        </button>
                      )}
                      <span className="text-[11px] text-dim-500">
                        Willingness conversations and briefings happen externally; the app records outcomes only.
                        Use in applications requires willingness = confirmed (database-enforced).
                      </span>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
