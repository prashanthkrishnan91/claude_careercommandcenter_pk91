import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidateAsset } from "../assetService";
import type { AssetVersion } from "../entities";
import { buildPayloadManifest, classifications, type GraphGate } from "../sourceGraph";
import { aiConfigured, callAnthropic, promptHash, type AnthropicTransport } from "./anthropic";
import { supabaseAdmin } from "./supabaseAdmin";

// Server-only asset generation.
//
// The browser can reach this only through /api/ai/generate-asset. It supplies
// an asset id, an optional guidance string and the ATTESTED_NO_METRIC
// acknowledgment — nothing else. Model name, prompt hash, privacy class and
// truth summary are produced here or derived by the database; none of them is
// accepted from the caller.
//
// The commit runs through the service-role client because the low-level
// function is revoked from every browser role. That function takes the acting
// user id explicitly, scopes the whole operation to assets that user owns, and
// writes the ai_outputs audit row IN THE SAME TRANSACTION — so a version
// presented as model-generated cannot exist without its audit.

const TYPE_INSTRUCTIONS: Record<string, string> = {
  resume_bullet: "Write ONE resume bullet, ≤32 words, starting with a strong verb, quantified only with numbers present in the sources.",
  story: "Write a STAR interview story (Situation, Task, Action, Result) in first person, ~250 words, using only facts in the sources.",
  li_post: "Write a LinkedIn post (~120 words), professional brand-building tone, no job-seeking language, using only facts in the sources.",
  cover_letter: "Write a 3-paragraph cover letter body grounded strictly in the sources.",
  positioning: "Write a 2-3 sentence positioning statement grounded strictly in the sources.",
  interview_answer: "Write a concise interview answer (~150 words) grounded strictly in the sources.",
};

export interface GenerationResult {
  version?: AssetVersion;
  blocked?: GraphGate["reasons"];
  unavailable?: boolean;
  error?: string;
}

/**
 * @param userClient the caller's own RLS-bound client — used to read the graph
 *                   as them, so a caller can only ever generate from sources
 *                   they can actually see.
 * @param userId     resolved server-side from that session, never from a body.
 */
export async function generateAssetVersion(
  userClient: SupabaseClient,
  userId: string,
  assetId: string,
  opts: { attestedNoMetricOverride?: boolean; guidance?: string; transport?: AnthropicTransport } = {},
): Promise<GenerationResult> {
  const { graph, gate } = await revalidateAsset(userClient, assetId, opts);
  const asset = graph.asset;
  const outputType = `asset_${asset.asset_type}`;
  const admin = supabaseAdmin();

  const inputRefs = graph.sources.map((s) => ({ kind: s.kind, id: s.id, label: s.label }));
  const blockReason = gate.reasons.map((r) => `${r.label}: ${r.reason}`).join(" | ");

  if (!gate.allowed) {
    // The blocked version and its audit commit together.
    const { error } = await admin.rpc("ccc_commit_asset_version", {
      p_user: userId, p_asset: assetId, p_content: "", p_model: "", p_prompt_hash: "",
      p_blocked: true, p_block_reason: blockReason, p_ack: false,
      p_audit: {
        output_type: outputType, model_used: "", output_text: "",
        input_refs: inputRefs, truth_classifications: classifications(graph),
        blocked_bool: true, block_reason: blockReason,
      },
    });
    if (error) return { error: error.message };
    return { blocked: gate.reasons };
  }

  if (!opts.transport && !aiConfigured()) {
    // No version is produced, but the attempt is still recorded.
    await admin.rpc("ccc_record_ai_audit", {
      p_user: userId,
      p_audit: {
        output_type: outputType, model_used: "", output_text: "",
        input_refs: inputRefs, truth_classifications: classifications(graph),
        blocked_bool: true, block_reason: "unavailable: ANTHROPIC_API_KEY is not configured",
      },
    });
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
    await admin.rpc("ccc_record_ai_audit", {
      p_user: userId,
      p_audit: {
        output_type: outputType, model_used: "", output_text: "",
        input_refs: inputRefs, truth_classifications: classifications(graph),
        blocked_bool: true, block_reason: `model call failed: ${result.error}`,
      },
    });
    return result.unavailable ? { unavailable: true } : { error: result.error };
  }

  const content = result.text.trim();
  // Model name and prompt hash come from THIS server's own call, never from a
  // request body. Privacy and truth summary are derived inside the database.
  const { data, error } = await admin.rpc("ccc_commit_asset_version", {
    p_user: userId, p_asset: assetId, p_content: content,
    p_model: result.model, p_prompt_hash: promptHash(prompt),
    p_blocked: false, p_block_reason: "",
    p_ack: graph.sources.some((s) => s.requires_no_metric_override) && (opts.attestedNoMetricOverride ?? false),
    p_audit: {
      output_type: outputType, model_used: result.model, output_text: content,
      input_refs: inputRefs, truth_classifications: classifications(graph),
      blocked_bool: false, block_reason: "",
    },
  });
  if (error) return { error: error.message };
  return { version: data as AssetVersion };
}

/** Manual authoring: the caller supplies an asset and content, nothing else. */
export async function authorManualVersionServer(
  userId: string,
  assetId: string,
  content: string,
): Promise<AssetVersion> {
  const { data, error } = await supabaseAdmin().rpc("ccc_author_manual_version", {
    p_user: userId, p_asset: assetId, p_content: content,
  });
  if (error) throw new Error(error.message);
  return data as AssetVersion;
}
