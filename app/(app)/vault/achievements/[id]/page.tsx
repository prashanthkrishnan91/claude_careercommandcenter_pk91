"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CandidateBadge, PrivacyBadge, StatusBadge, TruthBadge } from "@/components/Badges";
import { AchievementNoEvidence, AchievementNoMetrics } from "@/components/EmptyState";
import { InlineDate, InlineSelect, InlineText, InlineToggle } from "@/components/InlineField";
import { SpecAddForm, SpecCard, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { useShell } from "@/components/ShellContext";
import { postApi } from "@/lib/apiClient";
import { createRow, listRows, updateRow } from "@/lib/genericRepo";
import { RUBRIC_DIMENSIONS, directorSignal } from "@/lib/grader";
import { useVaultData } from "@/lib/hooks";
import { missingPromotionRequirements, promoteAchievement, PromotionBlockedError } from "@/lib/promotion";
import {
  archiveAchievement,
  archiveEvidenceItem,
  archiveMetric,
  createEvidenceItem,
  createMetric,
  getAchievement,
  getProject,
  listEvidenceItems,
  listMetrics,
  restoreAchievement,
  updateAchievement,
  updateEvidenceItem,
  updateMetric,
} from "@/lib/repos";
import { getSupabase } from "@/lib/supabase";
import {
  EVIDENCE_TYPES,
  PRIVACY_CLASSES,
  SENIORITY_LEVELS,
  TRUTH_STATUSES,
  VERIFIED_BY,
  type AchievementPatch,
} from "@/lib/types";
import type { GraderEvaluation, SanitizedClaim } from "@/lib/entities";

const METRIC_SPECS: FieldSpec[] = [
  { key: "metric_name", label: "Metric name", kind: "text", required: true, placeholder: "e.g. Churn forecast error" },
  { key: "value", label: "Value — exactly as measured", kind: "text", required: true, mono: true },
  { key: "unit", label: "Unit", kind: "text" },
  { key: "time_period", label: "Time period", kind: "text", placeholder: "e.g. Q2 2025" },
  { key: "baseline_value", label: "Baseline value", kind: "text", mono: true },
  { key: "calculation_notes", label: "Calculation notes", kind: "textarea", span: 2 },
  { key: "truth_status", label: "Truth status", kind: "select", options: TRUTH_STATUSES },
  { key: "privacy_class", label: "Privacy", kind: "select", options: PRIVACY_CLASSES },
];

const EVIDENCE_SPECS: FieldSpec[] = [
  { key: "type", label: "Type", kind: "select", options: EVIDENCE_TYPES, required: true },
  { key: "content_summary", label: "Content summary", kind: "textarea", required: true, span: 2, placeholder: "What the proof is and where it lives" },
  { key: "external_url", label: "External URL", kind: "text", mono: true, placeholder: "https:// (optional)" },
  { key: "verified_by", label: "Verified by", kind: "select", options: VERIFIED_BY },
  { key: "privacy_class", label: "Privacy", kind: "select", options: PRIVACY_CLASSES },
];

const CLAIM_SPECS: FieldSpec[] = [
  { key: "raw_private_text", label: "Raw private text (never leaves the vault)", kind: "textarea", required: true, span: 2 },
  { key: "sanitized_public_text", label: "Sanitized draft", kind: "textarea", required: true, span: 2, placeholder: "De-identified claim — bands instead of numbers, functions instead of product names" },
  { key: "sanitization_method", label: "Method", kind: "select", options: ["manual", "template", "guided"] },
];

export default function AchievementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { bump, helpOpen } = useShell();
  const db = getSupabase();

  const [privacyAffirmed, setPrivacyAffirmed] = useState(false);
  const [keepNeedsProof, setKeepNeedsProof] = useState(false);
  const [promoteErrors, setPromoteErrors] = useState<string[]>([]);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);

  const loader = useCallback(
    async (dbc: SupabaseClient) => {
      const [achievement, metrics, evidence, evaluations, claims] = await Promise.all([
        getAchievement(dbc, id),
        listMetrics(dbc, { achievementId: id, includeArchived: true }),
        listEvidenceItems(dbc, { achievementId: id, includeArchived: true }),
        listRows<GraderEvaluation>(dbc, "grader_evaluations", { eq: { achievement_fk: id } }),
        listRows<SanitizedClaim>(dbc, "sanitized_claims", { eq: { source_achievement_fk: id } }),
      ]);
      const project = achievement ? await getProject(dbc, achievement.project_fk) : null;
      return { achievement, metrics, evidence, evaluations, claims, project };
    },
    [id],
  );
  const { data, loading, error } = useVaultData(loader);

  const save = useCallback(async (patch: AchievementPatch) => {
    await updateAchievement(getSupabase(), id, patch);
  }, [id]);

  const promote = useCallback(async () => {
    try {
      await promoteAchievement(getSupabase(), id, {
        privacyAffirmed,
        keepNeedsProofConfirmed: keepNeedsProof,
      });
      setPromoteErrors([]);
      bump();
    } catch (e) {
      if (e instanceof PromotionBlockedError) setPromoteErrors(e.reasons);
      else setPromoteErrors([e instanceof Error ? e.message : "promotion failed"]);
    }
  }, [id, privacyAffirmed, keepNeedsProof, bump]);

  // ⌘Enter promotes; ⌘⇧A archives (v2.2 §5).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (helpOpen) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "Enter" && data?.achievement?.status === "draft") {
        e.preventDefault();
        void promote();
      } else if (meta && e.shiftKey && e.key.toLowerCase() === "a" && data?.achievement) {
        e.preventDefault();
        void archiveAchievement(getSupabase(), id).then(bump);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, data, id, promote, bump]);

  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;
  if (!data?.achievement) return <p className="p-8 text-[13px] text-dim-400">Not in the vault.</p>;
  const a = data.achievement;
  const activeMetrics = data.metrics.filter((m) => m.status === "active");
  const activeEvidence = data.evidence.filter((e) => e.status === "active");
  const latestEval = data.evaluations[0];
  const missing = missingPromotionRequirements(
    { achievement: a, activeMetricCount: activeMetrics.length, activeEvidenceCount: activeEvidence.length },
    { privacyAffirmed, keepNeedsProofConfirmed: keepNeedsProof },
  );

  async function runGrader() {
    setGrading(true);
    setAiNotice(null);
    const res = await postApi<{ blocked?: boolean; reasons?: Array<{ reason: string }>; unavailable?: boolean; message?: string; error?: string }>(
      "/api/ai/grade",
      { achievementId: id },
    );
    setGrading(false);
    if (res.status === 200) bump();
    else if (res.json.blocked) setAiNotice(`Blocked: ${res.json.reasons?.map((r) => r.reason).join(" ")}`);
    else setAiNotice(res.json.message ?? res.json.error ?? "grading failed");
  }

  return (
    <main className="px-4 py-5 md:px-8">
      {/* header */}
      <div className="mb-1 flex items-center justify-between">
        <span className="microlabel">
          <Link href="/vault" className="hover:text-dim-300">vault</Link>
          {data.project && (
            <>
              {" / "}
              <span>{data.project.employer || "(no employer)"}</span>
              {" / "}
              <Link href={`/vault/projects/${data.project.id}`} className="hover:text-dim-300">{data.project.name}</Link>
            </>
          )}
        </span>
        <button
          className="btn"
          onClick={async () => {
            if (a.status === "archived") await restoreAchievement(db, a.id);
            else await archiveAchievement(db, a.id);
            bump();
          }}
        >
          {a.status === "archived" ? "Restore (to draft)" : "Archive"} <kbd>⌘⇧A</kbd>
        </button>
      </div>

      <InlineText big value={a.headline} placeholder="The claim, stated plainly" onSave={(v) => save({ headline: v })} />
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <StatusBadge value={a.status} />
        <TruthBadge value={a.truth_status} />
        <PrivacyBadge value={a.privacy_class} />
        <CandidateBadge value={a.candidate_for_external_bool} />
        {a.has_metric_bool && <span className="font-mono text-[10px] uppercase text-dim-500">has-metric</span>}
        {latestEval && (
          <span className="font-mono text-[10px] uppercase text-dim-500">
            graded {Number(latestEval.total_score).toFixed(1)}/5
            {directorSignal(latestEval.dimensions).qualifies && <span className="ml-1 text-signal-blue">· director-signal</span>}
          </span>
        )}
      </div>

      {/* promotion panel — drafts only */}
      {a.status === "draft" && (
        <section className="panel mt-4 border-signal-amber/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="microlabel text-signal-amber">draft — promotion requirements</h2>
            <button className="btn-primary" onClick={() => void promote()}>
              Promote to active <kbd>⌘↵</kbd>
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-[12px]">
            <li className={a.narrative.trim() ? "text-dim-500 line-through" : "text-dim-300"}>Narrative written</li>
            <li className={activeMetrics.length + activeEvidence.length > 0 ? "text-dim-500 line-through" : "text-dim-300"}>At least one metric or evidence item attached</li>
            <li className="text-dim-300">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" className="accent-[#5b9dff]" checked={privacyAffirmed} onChange={(e) => setPrivacyAffirmed(e.target.checked)} />
                I affirm the privacy class ({a.privacy_class}) is correct — not just the default
              </label>
            </li>
            {a.truth_status === "NEEDS_PROOF" && (
              <li className="text-dim-300">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="accent-[#5b9dff]" checked={keepNeedsProof} onChange={(e) => setKeepNeedsProof(e.target.checked)} />
                  Truth status stays NEEDS_PROOF for now (or move it above)
                </label>
              </li>
            )}
          </ul>
          {(promoteErrors.length > 0 || missing.length > 0) && (
            <ul className="mt-3 space-y-0.5 border-l-2 border-ink-600 pl-3 text-[12px] text-dim-400">
              {(promoteErrors.length > 0 ? promoteErrors : missing).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* canonical fields */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <InlineSelect label="Truth status" value={a.truth_status} options={TRUTH_STATUSES} onSave={(v) => save({ truth_status: v })} />
        <InlineSelect label="Privacy" value={a.privacy_class} options={PRIVACY_CLASSES} onSave={(v) => save({ privacy_class: v })} />
        <InlineSelect
          label="Claimed seniority"
          value={a.claimed_seniority_level ?? ""}
          options={["", ...SENIORITY_LEVELS]}
          display={(v) => (v === "" ? "—" : v)}
          onSave={(v) => save({ claimed_seniority_level: (v || null) as never })}
        />
        <InlineToggle label="External" value={a.candidate_for_external_bool} caption="candidate for external use" onSave={(v) => save({ candidate_for_external_bool: v })} />
        <InlineDate label="Started" value={a.start_date} onSave={(v) => save({ start_date: v })} />
        <InlineDate label="Ended" value={a.end_date} onSave={(v) => save({ end_date: v })} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <InlineText label="Narrative" multiline value={a.narrative} placeholder="What happened, in your words" onSave={(v) => save({ narrative: v })} />
        <InlineText label="Action taken" multiline value={a.action_taken} placeholder="What you specifically did" onSave={(v) => save({ action_taken: v })} />
        <InlineText label="Outcome" multiline value={a.outcome} placeholder="What changed because of it" onSave={(v) => save({ outcome: v })} />
      </div>

      {/* metrics */}
      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="microlabel">metrics · {activeMetrics.length}</h2>
          <SpecAddForm
            title="Record metric"
            specs={METRIC_SPECS}
            onCreate={async (values) => {
              await createMetric(db, { achievement_fk: a.id, ...normalizeSpecValues(METRIC_SPECS, values) } as never);
              bump();
            }}
          />
        </div>
        {activeMetrics.length === 0 ? (
          <AchievementNoMetrics />
        ) : (
          <div className="space-y-2">
            {data.metrics.map((m) => (
              <details key={m.id} className={`panel px-4 py-2 ${m.status === "archived" ? "row-archived" : ""}`}>
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[13px] font-semibold text-signal-blue">{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-200">{m.metric_name}</span>
                  {m.time_period && <span className="font-mono text-[11px] text-dim-500">{m.time_period}</span>}
                  <TruthBadge value={m.truth_status} />
                  <PrivacyBadge value={m.privacy_class} />
                  <button
                    className="btn-quiet"
                    onClick={async (e) => {
                      e.preventDefault();
                      if (m.status === "archived") await updateMetric(db, m.id, { status: "active" });
                      else await archiveMetric(db, m.id);
                      bump();
                    }}
                  >
                    {m.status === "archived" ? "restore" : "archive"}
                  </button>
                </summary>
                <div className="mt-3 border-t border-ink-700 pt-3">
                  <SpecCard row={m as never} specs={METRIC_SPECS} onPatch={async (patch) => { await updateMetric(db, m.id, patch as never); }} />
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* evidence */}
      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="microlabel">evidence · {activeEvidence.length}</h2>
          <SpecAddForm
            title="Link evidence"
            specs={EVIDENCE_SPECS}
            onCreate={async (values) => {
              const v = normalizeSpecValues(EVIDENCE_SPECS, values) as Record<string, unknown>;
              if (v.verified_by) v.verified_at = new Date().toISOString();
              await createEvidenceItem(db, { achievement_fk: a.id, ...v } as never);
              bump();
            }}
          />
        </div>
        {activeEvidence.length === 0 ? (
          <AchievementNoEvidence />
        ) : (
          <div className="space-y-2">
            {data.evidence.map((ev) => (
              <details key={ev.id} className={`panel px-4 py-2 ${ev.status === "archived" ? "row-archived" : ""}`}>
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim-400">{ev.type.replace("_", " ")}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-dim-200">{ev.content_summary}</span>
                  {ev.verified_by && <span className="font-mono text-[10px] uppercase text-signal-green">✓ {ev.verified_by}</span>}
                  <PrivacyBadge value={ev.privacy_class} />
                  <button
                    className="btn-quiet"
                    onClick={async (e) => {
                      e.preventDefault();
                      if (ev.status === "archived") await updateEvidenceItem(db, ev.id, { status: "active" });
                      else await archiveEvidenceItem(db, ev.id);
                      bump();
                    }}
                  >
                    {ev.status === "archived" ? "restore" : "archive"}
                  </button>
                </summary>
                <div className="mt-3 border-t border-ink-700 pt-3">
                  <SpecCard row={ev as never} specs={EVIDENCE_SPECS} onPatch={async (patch) => { await updateEvidenceItem(db, ev.id, patch as never); }} />
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* grader */}
      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="microlabel">grader · rubric v2.1.1-A6 (visible)</h2>
          <button className="btn" onClick={() => void runGrader()} disabled={grading}>
            {grading ? "Grading…" : latestEval ? "Re-grade" : "Run grader"}
          </button>
        </div>
        {aiNotice && <p className="mb-2 border-l-2 border-signal-amber pl-2 text-[12px] text-signal-amber">{aiNotice}</p>}
        {!latestEval ? (
          <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
            Not graded yet. The grader scores seven visible dimensions with written rationale; PRIVATE achievements are graded only through an approved sanitized claim.
          </p>
        ) : (
          <div className="panel p-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-lg text-dim-100">{Number(latestEval.total_score).toFixed(2)}<span className="text-[11px] text-dim-500">/5</span></span>
              {(() => {
                const ds = directorSignal(latestEval.dimensions);
                return ds.qualifies ? (
                  <span className="font-mono text-[10px] uppercase text-signal-blue">director-signal ✓</span>
                ) : (
                  <span className="font-mono text-[10px] uppercase text-dim-500" title={ds.reasons.join(" ")}>not director-signal — {ds.reasons[0]}</span>
                );
              })()}
              <span className="font-mono text-[10px] text-dim-500">{latestEval.model_used} · {latestEval.evaluated_at.slice(0, 10)}</span>
            </div>
            <table className="w-full">
              <tbody>
                {latestEval.dimensions.map((d) => (
                  <tr key={d.dimension} className="border-b border-ink-800 align-top last:border-0">
                    <td className="w-52 py-1.5 pr-3 font-mono text-[11px] uppercase text-dim-400">
                      {RUBRIC_DIMENSIONS.find((r) => r.key === d.dimension)?.label ?? d.dimension}
                    </td>
                    <td className="w-10 py-1.5 font-mono text-[13px] text-dim-100">{d.score}</td>
                    <td className="py-1.5 text-[12px] text-dim-400">{d.rationale}</td>
                    <td className="w-16 py-1.5 text-right">
                      <button
                        className="btn-quiet"
                        title="Challenge this dimensional score"
                        onClick={async () => {
                          const note = window.prompt(`Challenge "${d.dimension}" — why is this score wrong?`);
                          if (!note) return;
                          await updateRow(db, "grader_evaluations", latestEval.id, {
                            dimension_disputes: [...latestEval.dimension_disputes, { dimension: d.dimension, note, at: new Date().toISOString() }],
                          });
                          bump();
                        }}
                      >
                        dispute
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] leading-relaxed text-dim-300">{latestEval.written_rationale}</p>
            {latestEval.dimension_disputes.length > 0 && (
              <p className="mt-2 font-mono text-[10px] uppercase text-signal-amber">
                {latestEval.dimension_disputes.length} dimension(s) disputed by you — logged for grader review
              </p>
            )}
          </div>
        )}
      </section>

      {/* sanitization */}
      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="microlabel">sanitized claims · {data.claims.length}</h2>
          <SpecAddForm
            title="Sanitization workspace"
            specs={CLAIM_SPECS}
            submitLabel="Save sanitized claim"
            onCreate={async (values) => {
              await createRow(db, "sanitized_claims", { source_achievement_fk: a.id, ...normalizeSpecValues(CLAIM_SPECS, values) });
              bump();
            }}
          />
        </div>
        {a.privacy_class === "PRIVATE" && data.claims.filter((c) => c.user_approved_at).length === 0 && (
          <p className="mb-2 border-l-2 border-signal-red pl-2 text-[12px] text-dim-400">
            This achievement is PRIVATE. Its raw text never reaches an AI model or an external asset —
            grading and generation unlock only through an approved sanitized claim below.
          </p>
        )}
        {data.claims.length > 0 && (
          <div className="space-y-2">
            {data.claims.map((c) => (
              <div key={c.id} className="panel grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
                <div>
                  <span className="field-label text-signal-red">raw · private · firewalled</span>
                  <p className="whitespace-pre-wrap text-[12px] text-dim-400">{c.raw_private_text}</p>
                </div>
                <div>
                  <span className="field-label text-signal-green">sanitized · {c.sanitization_method}</span>
                  <p className="whitespace-pre-wrap text-[12px] text-dim-200">{c.sanitized_public_text}</p>
                  <div className="mt-2 flex items-center gap-3">
                    {c.user_approved_at ? (
                      <span className="font-mono text-[10px] uppercase text-signal-green">approved · public-safe · {c.user_approved_at.slice(0, 10)}</span>
                    ) : (
                      <button
                        className="btn"
                        onClick={async () => {
                          await updateRow(db, "sanitized_claims", c.id, {
                            user_approved_at: new Date().toISOString(),
                            privacy_class: "PUBLIC_SAFE",
                          });
                          bump();
                        }}
                      >
                        Approve as PUBLIC_SAFE
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* metadata footer */}
      <footer className="mt-8 border-t border-ink-700 pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-dim-500">
        created {a.created_at.slice(0, 10)} · updated {a.updated_at.slice(0, 10)} · id {a.id.slice(0, 8)}
      </footer>
    </main>
  );
}
