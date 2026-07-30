import { NextResponse } from "next/server";
import { collectAssetSources, gateExternalAsset } from "@/lib/aiSafety";
import { createRow, getRow, listRows, updateRow } from "@/lib/genericRepo";
import { aiConfigured, callAnthropic, promptHash } from "@/lib/server/anthropic";
import { supabaseForRequest } from "@/lib/server/supabase";
import type { AssetVersion, CareerAsset } from "@/lib/entities";

// P0E Career Asset Generator. Enforcement order is fixed:
//   collect sources → substitute approved sanitized claims for PRIVATE →
//   truth/privacy gate → ONLY THEN call the model.
// A blocked generation still creates an audit row and a blocked asset_version
// so the vault shows exactly why (v2 §4 rule 2: name the failing claim).

const TYPE_INSTRUCTIONS: Record<string, string> = {
  resume_bullet:
    "Write ONE resume bullet, ≤32 words, starting with a strong verb, quantified only with numbers present in the sources.",
  story:
    "Write a STAR interview story (Situation, Task, Action, Result) in first person, ~250 words, using only facts in the sources.",
  li_post:
    "Write a LinkedIn post (~120 words), professional brand-building tone, no job-seeking language, using only facts in the sources.",
  cover_letter:
    "Write a 3-paragraph cover letter body grounded strictly in the sources.",
  positioning:
    "Write a 2-3 sentence positioning statement grounded strictly in the sources.",
  interview_answer:
    "Write a concise interview answer (~150 words) grounded strictly in the sources.",
};

export async function POST(req: Request) {
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as {
    assetId?: string;
    attestedNoMetricOverride?: boolean;
    guidance?: string;
  };
  if (!body.assetId) return NextResponse.json({ error: "assetId required" }, { status: 400 });

  const asset = await getRow<CareerAsset>(db, "career_assets", body.assetId);
  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });
  if (asset.source_achievement_refs.length === 0) {
    return NextResponse.json({ error: "asset has no source achievements" }, { status: 422 });
  }

  const sources = await collectAssetSources(db, asset.source_achievement_refs);
  const gate = gateExternalAsset(sources.classifications, {
    attestedNoMetricOverride: body.attestedNoMetricOverride ?? false,
  });

  const versions = await listRows<AssetVersion>(db, "asset_versions", {
    eq: { asset_fk: asset.id },
    includeArchived: true,
  });
  const nextNumber = versions.reduce((m, v) => Math.max(m, v.version_number), 0) + 1;

  if (!gate.allowed) {
    const reasonText = gate.reasons.map((r) => `${r.label}: ${r.reason}`).join(" | ");
    await createRow<AssetVersion>(db, "asset_versions", {
      asset_fk: asset.id,
      version_number: nextNumber,
      blocked_bool: true,
      block_reason: reasonText,
    });
    await createRow(db, "ai_outputs", {
      output_type: `asset_${asset.asset_type}`,
      input_refs: sources.classifications.map((c) => ({ kind: c.kind, id: c.id, label: c.label })),
      truth_classifications: sources.classifications,
      blocked_bool: true,
      block_reason: reasonText,
    });
    return NextResponse.json({ blocked: true, reasons: gate.reasons }, { status: 422 });
  }

  if (!aiConfigured()) {
    return NextResponse.json(
      { unavailable: true, message: "AI is not configured (ANTHROPIC_API_KEY absent). Generation is unavailable; you can author a version manually." },
      { status: 503 },
    );
  }

  const prompt = [
    TYPE_INSTRUCTIONS[asset.asset_type],
    body.guidance ? `Additional guidance from the user: ${body.guidance}` : "",
    "Use ONLY the facts below. If a number is not below, it does not exist.",
    "--- SOURCES ---",
    ...sources.texts,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callAnthropic({
    system:
      "You generate external-facing career assets from verified evidence only. Never invent facts, numbers, employers, or outcomes. Plain text output, no preamble.",
    user: prompt,
  });

  if (!result.ok) {
    await createRow(db, "ai_outputs", {
      output_type: `asset_${asset.asset_type}`,
      input_refs: sources.classifications.map((c) => ({ kind: c.kind, id: c.id })),
      truth_classifications: sources.classifications,
      blocked_bool: true,
      block_reason: `model call failed: ${result.error}`,
    });
    return NextResponse.json(
      result.unavailable ? { unavailable: true } : { error: result.error },
      { status: result.unavailable ? 503 : 502 },
    );
  }

  const version = await createRow<AssetVersion>(db, "asset_versions", {
    asset_fk: asset.id,
    version_number: nextNumber,
    content: result.text.trim(),
    generated_by_model: result.model,
    generation_prompt_hash: promptHash(prompt),
  });
  const truthSummary = [...new Set(sources.classifications.map((c) => c.truth_status).filter(Boolean))].join(",");
  await updateRow(db, "career_assets", asset.id, {
    current_version_fk: version.id,
    truth_status_summary: truthSummary,
    privacy_class: "PUBLIC_SAFE",
  });
  await createRow(db, "ai_outputs", {
    output_type: `asset_${asset.asset_type}`,
    model_used: result.model,
    input_refs: sources.classifications.map((c) => ({ kind: c.kind, id: c.id, label: c.label })),
    output_text: result.text.trim(),
    truth_classifications: sources.classifications,
    blocked_bool: false,
  });
  return NextResponse.json({ version });
}
