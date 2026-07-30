import type { SupabaseClient } from "@supabase/supabase-js";
import { audit, commitVersion, revalidateAsset } from "../assetService";
import type { AssetVersion } from "../entities";
import { buildPayloadManifest, type GraphGate } from "../sourceGraph";
import { aiConfigured, callAnthropic, promptHash, type AnthropicTransport } from "./anthropic";

// Server-only asset generation: the one lifecycle step that talks to the
// model. It runs the SAME source-graph gate as the client-side lifecycle
// (approve / collection / external use) and builds the outbound payload
// exclusively from the gated manifest.

const TYPE_INSTRUCTIONS: Record<string, string> = {
  resume_bullet: "Write ONE resume bullet, ≤32 words, starting with a strong verb, quantified only with numbers present in the sources.",
  story: "Write a STAR interview story (Situation, Task, Action, Result) in first person, ~250 words, using only facts in the sources.",
  li_post: "Write a LinkedIn post (~120 words), professional brand-building tone, no job-seeking language, using only facts in the sources.",
  cover_letter: "Write a 3-paragraph cover letter body grounded strictly in the sources.",
  positioning: "Write a 2-3 sentence positioning statement grounded strictly in the sources.",
  interview_answer: "Write a concise interview answer (~150 words) grounded strictly in the sources.",
};

export async function generateAssetVersion(
  db: SupabaseClient,
  assetId: string,
  opts: { attestedNoMetricOverride?: boolean; guidance?: string; transport?: AnthropicTransport } = {},
): Promise<{ version?: AssetVersion; blocked?: GraphGate["reasons"]; unavailable?: boolean; error?: string }> {
  const { graph, gate } = await revalidateAsset(db, assetId, opts);
  const asset = graph.asset;
  const outputType = `asset_${asset.asset_type}`;

  if (!gate.allowed) {
    await commitVersion(db, asset, { blocked_bool: true, block_reason: gate.reasons.map((r) => `${r.label}: ${r.reason}`).join(" | ") }, null, "");
    await audit(db, graph, outputType, { blocked: true, reason: gate.reasons.map((r) => `${r.label}: ${r.reason}`).join(" | ") });
    return { blocked: gate.reasons };
  }
  if (!opts.transport && !aiConfigured()) {
    await audit(db, graph, outputType, { blocked: true, reason: "unavailable: ANTHROPIC_API_KEY is not configured" });
    return { unavailable: true };
  }

  const manifest = buildPayloadManifest(graph, gate);
  const prompt = [
    TYPE_INSTRUCTIONS[asset.asset_type],
    opts.guidance ? `Additional guidance from the user: ${opts.guidance}` : "",
    "Use ONLY the facts below. If a number is not below, it does not exist.",
    "--- SOURCES ---",
    ...manifest,
  ].filter(Boolean).join("\n");

  const transport = opts.transport ?? callAnthropic;
  const result = await transport({
    system: "You generate external-facing career assets from verified evidence only. Never invent facts, numbers, employers, or outcomes. Plain text output, no preamble.",
    user: prompt,
  });
  if (!result.ok) {
    await audit(db, graph, outputType, { blocked: true, reason: `model call failed: ${result.error}` });
    return result.unavailable ? { unavailable: true } : { error: result.error };
  }

  const truthSummary = [...new Set(graph.sources.map((s) => s.truth_status).filter(Boolean))].join(",");
  // PUBLIC_SAFE is DERIVED from the fully eligible source graph, never from
  // the mere success of a generation call.
  const version = await commitVersion(
    db, asset,
    { content: result.text.trim(), generated_by_model: result.model, generation_prompt_hash: promptHash(prompt) },
    "PUBLIC_SAFE",
    truthSummary,
  );
  await audit(db, graph, outputType, { blocked: false, model: result.model, output: result.text.trim() });
  return { version };
}
