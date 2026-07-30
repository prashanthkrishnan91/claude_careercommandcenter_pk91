import { NextResponse } from "next/server";
import { z } from "zod";
import { createRow, getRow, listRows, updateRow } from "@/lib/genericRepo";
import { aiConfigured, callAnthropic, parseModelJson } from "@/lib/server/anthropic";
import { supabaseForRequest } from "@/lib/server/supabase";
import type { ArchetypeSource, TargetArchetype } from "@/lib/entities";

// P0D: JD-derived archetype extraction. Pasted JDs are public-source material
// (never PRIVATE vault content), so the privacy firewall is not implicated.
// The proposed archetype profile is NOT active until the user approves it
// (approved_by_user_bool) — the Comparator refuses unapproved archetypes.

const extractionSchema = z.object({
  required_skills: z.array(z.string()).max(30),
  expected_scope: z.array(z.string()).max(15),
  expected_metrics: z.array(z.string()).max(15),
  seniority_signals: z.array(z.string()).max(15),
  comp_band_low: z.number().nullable(),
  comp_band_high: z.number().nullable(),
  parsed_summaries: z.array(z.string()),
});

export async function POST(req: Request) {
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { archetypeId } = (await req.json()) as { archetypeId?: string };
  if (!archetypeId) return NextResponse.json({ error: "archetypeId required" }, { status: 400 });

  if (!aiConfigured()) {
    return NextResponse.json(
      { unavailable: true, message: "AI is not configured (ANTHROPIC_API_KEY absent). Paste-derived extraction is unavailable; you can author the archetype manually." },
      { status: 503 },
    );
  }

  const archetype = await getRow<TargetArchetype>(db, "target_archetypes", archetypeId);
  if (!archetype) return NextResponse.json({ error: "archetype not found" }, { status: 404 });
  const sources = await listRows<ArchetypeSource>(db, "archetype_sources", {
    eq: { archetype_fk: archetypeId },
  });
  const jds = sources.filter((s) => s.source_type === "pasted_jd" && s.raw_content.trim());
  if (jds.length === 0) {
    return NextResponse.json({ error: "no pasted JD sources to extract from" }, { status: 422 });
  }

  const result = await callAnthropic({
    system:
      "You extract structured role-archetype profiles from pasted job descriptions. Aggregate across all JDs. Use null for comp bands unless stated numerically in a JD — never invent numbers. Output JSON only.",
    user: [
      'Respond with JSON: {"required_skills":[],"expected_scope":[],"expected_metrics":[],"seniority_signals":[],"comp_band_low":null,"comp_band_high":null,"parsed_summaries":["one per JD, in order"]}',
      ...jds.map((j, i) => `--- JD ${i + 1} ---\n${j.raw_content.slice(0, 12_000)}`),
    ].join("\n"),
    maxTokens: 3000,
  });

  if (!result.ok) {
    await createRow(db, "ai_outputs", {
      output_type: "archetype_extraction",
      input_refs: jds.map((j) => ({ kind: "archetype_source", id: j.id })),
      blocked_bool: true,
      block_reason: `model call failed: ${result.error}`,
    });
    return NextResponse.json(
      result.unavailable ? { unavailable: true } : { error: result.error },
      { status: result.unavailable ? 503 : 502 },
    );
  }
  const parsed = parseModelJson<z.input<typeof extractionSchema>>(result.text);
  const validated = parsed ? extractionSchema.safeParse(parsed) : null;
  if (!validated || !validated.success) {
    await createRow(db, "ai_outputs", {
      output_type: "archetype_extraction",
      model_used: result.model,
      input_refs: jds.map((j) => ({ kind: "archetype_source", id: j.id })),
      blocked_bool: true,
      block_reason: "structured output validation failed",
    });
    return NextResponse.json({ error: "model returned invalid structure" }, { status: 502 });
  }

  const d = validated.data;
  const updated = await updateRow<TargetArchetype>(db, "target_archetypes", archetypeId, {
    required_skills: d.required_skills,
    expected_scope: d.expected_scope,
    expected_metrics: d.expected_metrics,
    seniority_signals: d.seniority_signals,
    comp_band_low: d.comp_band_low,
    comp_band_high: d.comp_band_high,
    source_type: archetype.source_type === "user_defined" ? "hybrid" : archetype.source_type,
    approved_by_user_bool: false, // extraction always requires re-approval
  });
  for (const [i, jd] of jds.entries()) {
    await updateRow(db, "archetype_sources", jd.id, {
      parsed_summary: d.parsed_summaries[i] ?? "",
      used_in_archetype_bool: true,
    });
  }
  await createRow(db, "ai_outputs", {
    output_type: "archetype_extraction",
    model_used: result.model,
    input_refs: jds.map((j) => ({ kind: "archetype_source", id: j.id })),
    output_text: JSON.stringify(d),
    blocked_bool: false,
  });
  return NextResponse.json({ archetype: updated });
}
