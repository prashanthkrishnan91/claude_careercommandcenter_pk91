import { NextResponse } from "next/server";
import { z } from "zod";
import { buildGraderPayload } from "@/lib/aiSafety";
import { createRow } from "@/lib/genericRepo";
import { applyCeilings, RUBRIC_DIMENSIONS, RUBRIC_VERSION, totalScore } from "@/lib/grader";
import { aiConfigured, callAnthropic, parseModelJson } from "@/lib/server/anthropic";
import { supabaseForRequest } from "@/lib/server/supabase";
import type { GraderDimensionScore, GraderEvaluation } from "@/lib/entities";

// P0C Achievement Grader. Truth/privacy checks run BEFORE any model call;
// PRIVATE achievements are graded only through approved sanitized claims.
// Every attempt — blocked, failed, or successful — writes an ai_outputs audit
// row with model, input refs, classifications, and block status/reason.

const responseSchema = z.object({
  dimensions: z
    .array(
      z.object({
        dimension: z.enum(RUBRIC_DIMENSIONS.map((d) => d.key) as [string, ...string[]]),
        score: z.number().int().min(1).max(5),
        rationale: z.string().min(1),
      }),
    )
    .length(7),
  written_rationale: z.string().min(1),
});

export async function POST(req: Request) {
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { achievementId } = (await req.json()) as { achievementId?: string };
  if (!achievementId) return NextResponse.json({ error: "achievementId required" }, { status: 400 });

  if (!aiConfigured()) {
    // Unavailable attempts are persisted too — "every attempt is audited".
    await createRow(db, "ai_outputs", {
      output_type: "grader_evaluation",
      input_refs: [{ kind: "achievement", id: achievementId }],
      blocked_bool: true,
      block_reason: "unavailable: ANTHROPIC_API_KEY is not configured",
    });
    return NextResponse.json(
      { unavailable: true, message: "AI is not configured (ANTHROPIC_API_KEY absent). Grading is unavailable; nothing was generated." },
      { status: 503 },
    );
  }

  const gate = await buildGraderPayload(db, achievementId);
  if (!gate.allowed || !gate.payload) {
    await createRow(db, "ai_outputs", {
      output_type: "grader_evaluation",
      model_used: "",
      input_refs: [{ kind: "achievement", id: achievementId }],
      truth_classifications: gate.classifications,
      blocked_bool: true,
      block_reason: gate.reasons.map((r) => `${r.label}: ${r.reason}`).join(" | "),
    });
    return NextResponse.json({ blocked: true, reasons: gate.reasons }, { status: 422 });
  }

  const p = gate.payload;
  const user = [
    "Grade this achievement on the 7-dimension rubric. Score each 1-5 with a specific rationale.",
    "Dimensions: " + RUBRIC_DIMENSIONS.map((d) => d.key).join(", "),
    "Respond with JSON only: {\"dimensions\":[{\"dimension\",\"score\",\"rationale\"}x7],\"written_rationale\"}.",
    "Do not invent metrics or facts not present in the input.",
    "---",
    p.narrativeForModel,
    p.metrics.length
      ? "Metrics:\n" + p.metrics.map((m) => `- ${m.metric_name}: ${m.value} ${m.unit} (${m.time_period}) [truth: ${m.truth_status}]`).join("\n")
      : "Metrics: none recorded.",
    p.evidence.length
      ? "Evidence:\n" + p.evidence.map((e) => `- [${e.type}] ${e.content_summary}`).join("\n")
      : "Evidence: none recorded.",
  ].join("\n");

  const result = await callAnthropic({
    system:
      "You are the Achievement Grader for a private career evidence vault. You are rigorous, skeptical, and transparent. Ratings reflect director-level expectations at tier-1 multinationals. Output JSON only.",
    user,
  });

  if (!result.ok) {
    await createRow(db, "ai_outputs", {
      output_type: "grader_evaluation",
      model_used: "",
      input_refs: [{ kind: "achievement", id: achievementId }],
      truth_classifications: gate.classifications,
      blocked_bool: true,
      block_reason: `model call failed: ${result.error}`,
    });
    return NextResponse.json(
      result.unavailable ? { unavailable: true } : { error: result.error },
      { status: result.unavailable ? 503 : 502 },
    );
  }

  const parsed = parseModelJson<z.input<typeof responseSchema>>(result.text);
  const validated = parsed ? responseSchema.safeParse(parsed) : null;
  if (!validated || !validated.success) {
    await createRow(db, "ai_outputs", {
      output_type: "grader_evaluation",
      model_used: result.model,
      input_refs: [{ kind: "achievement", id: achievementId }],
      truth_classifications: gate.classifications,
      blocked_bool: true,
      block_reason: "structured output validation failed",
    });
    return NextResponse.json({ error: "model returned invalid structure" }, { status: 502 });
  }

  const dims = applyCeilings(
    p.achievement.truth_status,
    validated.data.dimensions as GraderDimensionScore[],
  );
  const evaluation = await createRow<GraderEvaluation>(db, "grader_evaluations", {
    achievement_fk: achievementId,
    model_used: result.model,
    dimensions: dims,
    total_score: totalScore(dims),
    written_rationale: validated.data.written_rationale,
    rubric_version: RUBRIC_VERSION,
  });
  await createRow(db, "ai_outputs", {
    output_type: "grader_evaluation",
    model_used: result.model,
    input_refs: [{ kind: "achievement", id: achievementId }],
    output_text: JSON.stringify({ dimensions: dims, written_rationale: validated.data.written_rationale }),
    truth_classifications: gate.classifications,
    blocked_bool: false,
  });
  return NextResponse.json({ evaluation });
}
