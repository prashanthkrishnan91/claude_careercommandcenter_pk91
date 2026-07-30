"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InlineNumber, InlineTags, InlineText } from "@/components/InlineField";
import { SpecAddForm, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { useShell } from "@/components/ShellContext";
import { postApi } from "@/lib/apiClient";
import { generateGapReport } from "@/lib/comparator";
import { createRow, getRow, listRows, updateRow } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase";
import type { ArchetypeSource, GapReport, TargetArchetype } from "@/lib/entities";

const SOURCE_SPECS: FieldSpec[] = [
  { key: "source_type", label: "Source type", kind: "select", options: ["pasted_jd", "company_page", "user_note"], required: true },
  { key: "raw_content", label: "Raw content (pasted JD text)", kind: "textarea", required: true, span: 2 },
];

export default function ArchetypeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { bump } = useShell();
  const db = getSupabase();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loader = useCallback(
    async (dbc: SupabaseClient) => {
      const [archetype, sources, reports] = await Promise.all([
        getRow<TargetArchetype>(dbc, "target_archetypes", id),
        listRows<ArchetypeSource>(dbc, "archetype_sources", { eq: { archetype_fk: id } }),
        listRows<GapReport>(dbc, "gap_reports", { eq: { archetype_fk: id } }),
      ]);
      return { archetype, sources, reports };
    },
    [id],
  );
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data?.archetype) return <p className="p-8 text-[13px] text-signal-red">{error ?? "Not found."}</p>;
  const a = data.archetype;
  const save = (patch: Record<string, unknown>) => updateRow(db, "target_archetypes", a.id, patch).then(() => {});

  async function extract() {
    setBusy("extract");
    setNotice(null);
    const res = await postApi<{ unavailable?: boolean; message?: string; error?: string }>("/api/ai/extract-archetype", { archetypeId: a.id });
    setBusy(null);
    if (res.status === 200) {
      setNotice("Extraction complete — review the fields, then approve.");
      bump();
    } else setNotice(res.json.message ?? res.json.error ?? "extraction failed");
  }

  async function approve() {
    // A7: raw JDs get a 90-day purge date at approval unless pinned.
    const purge = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    for (const s of data!.sources.filter((s) => s.source_type === "pasted_jd" && !s.pinned_bool)) {
      await updateRow(db, "archetype_sources", s.id, { purge_after: purge });
    }
    await save({ approved_by_user_bool: true });
    bump();
  }

  async function runGaps() {
    setBusy("gaps");
    setNotice(null);
    try {
      await generateGapReport(db, a);
      bump();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "comparator failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="px-4 py-5 md:px-8">
      <div className="mb-1 flex items-center justify-between">
        <Link href="/intelligence/archetypes" className="microlabel hover:text-dim-300">intelligence / archetypes</Link>
        <div className="flex gap-2">
          {!a.approved_by_user_bool ? (
            <button className="btn-primary" onClick={() => void approve()}>Approve archetype</button>
          ) : (
            <button className="btn" disabled={busy === "gaps"} onClick={() => void runGaps()}>
              {busy === "gaps" ? "Comparing…" : "Run comparator → gap report"}
            </button>
          )}
        </div>
      </div>

      <InlineText big value={a.name} onSave={(v) => save({ name: v })} />
      <p className="mt-1 font-mono text-[10px] uppercase text-dim-500">
        {a.source_type} · {a.approved_by_user_bool ? "approved — comparator enabled" : "unapproved — the comparator will not use this archetype"}
      </p>
      {notice && <p className="mt-2 border-l-2 border-signal-amber pl-2 text-[12px] text-signal-amber">{notice}</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <InlineTags label="Required skills" value={a.required_skills} onSave={(v) => save({ required_skills: v, approved_by_user_bool: false })} />
        <InlineTags label="Expected metrics" value={a.expected_metrics} onSave={(v) => save({ expected_metrics: v, approved_by_user_bool: false })} />
        <InlineTags label="Expected scope" value={a.expected_scope} onSave={(v) => save({ expected_scope: v, approved_by_user_bool: false })} />
        <InlineTags label="Seniority signals" value={a.seniority_signals} onSave={(v) => save({ seniority_signals: v, approved_by_user_bool: false })} />
        <InlineNumber label="Comp band low" value={a.comp_band_low} onSave={(v) => save({ comp_band_low: v })} />
        <InlineNumber label="Comp band high" value={a.comp_band_high} onSave={(v) => save({ comp_band_high: v })} />
        <InlineNumber label="Visa friendliness (1–5)" value={a.visa_friendliness_score} onSave={(v) => save({ visa_friendliness_score: v })} />
      </div>
      <p className="mt-2 text-[11px] text-dim-500">Editing definition fields clears approval — re-approve after review.</p>

      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="microlabel">sources · {data.sources.length}</h2>
          <div className="flex gap-2">
            <SpecAddForm
              title="Paste JD / source"
              specs={SOURCE_SPECS}
              onCreate={async (values) => {
                await createRow(db, "archetype_sources", { archetype_fk: a.id, ...normalizeSpecValues(SOURCE_SPECS, values) });
                bump();
              }}
            />
            <button className="btn" disabled={busy === "extract"} onClick={() => void extract()}>
              {busy === "extract" ? "Extracting…" : "Extract profile from JDs (AI)"}
            </button>
          </div>
        </div>
        {data.sources.length === 0 ? (
          <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
            Paste 5–10 representative JDs. Raw JD text is retained 90 days after approval, then purged unless pinned; parsed summaries are kept indefinitely.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.sources.map((s) => (
              <li key={s.id} className="panel p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] uppercase text-dim-400">{s.source_type.replace("_", " ")}</span>
                  {s.used_in_archetype_bool && <span className="font-mono text-[10px] uppercase text-signal-green">used</span>}
                  {s.purge_after && !s.pinned_bool && (
                    <span className="font-mono text-[10px] text-dim-500">raw purges {s.purge_after}</span>
                  )}
                  <span className="flex-1" />
                  <button
                    className="btn-quiet"
                    onClick={() => void updateRow(db, "archetype_sources", s.id, { pinned_bool: !s.pinned_bool, purge_after: s.pinned_bool ? s.purge_after : null }).then(bump)}
                  >
                    {s.pinned_bool ? "unpin" : "pin raw"}
                  </button>
                </div>
                {s.parsed_summary ? (
                  <p className="mt-2 text-[12px] text-dim-300">{s.parsed_summary}</p>
                ) : (
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[11px] text-dim-500">{s.raw_content}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="microlabel mb-2">gap reports · {data.reports.length}</h2>
        {data.reports.length === 0 ? (
          <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
            None yet. The comparator computes coverage deterministically from your vault — skills evidence, metrics, and grader results. No AI numbers.
          </p>
        ) : (
          data.reports.map((r) => (
            <div key={r.id} className="panel mb-3 p-4">
              <p className="microlabel mb-2">{r.generated_at.slice(0, 16).replace("T", " ")}</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <h3 className="mb-1 font-mono text-[10px] uppercase text-signal-green">covered · {r.covered_dimensions.length}</h3>
                  <ul className="space-y-1 text-[12px] text-dim-300">
                    {r.covered_dimensions.map((c, i) => <li key={i}>{c.dimension} — <span className="text-dim-500">{c.detail}</span></li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1 font-mono text-[10px] uppercase text-signal-amber">gaps · {r.gap_dimensions.length}</h3>
                  <ul className="space-y-1 text-[12px] text-dim-300">
                    {r.gap_dimensions.map((g, i) => <li key={i}>{g.dimension} — <span className="text-dim-500">{g.detail}</span></li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1 font-mono text-[10px] uppercase text-dim-400">recommended</h3>
                  <ul className="space-y-1 text-[12px] text-dim-300">
                    {r.recommended_actions.map((rec, i) => <li key={i}>{rec.title}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
