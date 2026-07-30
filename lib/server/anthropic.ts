import { createHash } from "node:crypto";

// Server-only Anthropic access. The API key never reaches a client bundle:
// this module is imported exclusively from route handlers. The model is
// environment-configured — never a hardcoded permanent product assumption.
// When no key is configured, callers receive { unavailable: true } and the
// UI shows a calm unavailable state; nothing is fabricated.

const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 45_000;

// Transport injection: tests (and CI integration runs) provide a
// deterministic transport so the REAL gating/audit path is exercised without
// a provider credential. The stub is never active unless explicitly set.
export type AnthropicTransport = (opts: {
  system: string;
  user: string;
  maxTokens?: number;
}) => Promise<AiResult>;

let injectedTransport: AnthropicTransport | null = null;
export function setAnthropicTransportForTests(t: AnthropicTransport | null): void {
  injectedTransport = t;
}

function envStubActive(): boolean {
  return process.env.CCC_AI_TRANSPORT === "stub";
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || injectedTransport !== null || envStubActive();
}

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
}

export function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 32);
}

export type AiResult =
  | { ok: true; text: string; model: string }
  | { ok: false; unavailable?: boolean; error: string };

// Deterministic env stub (CI integration runs set CCC_AI_TRANSPORT=stub):
// canned, clearly-labeled outputs — used only AFTER the real source gate.
function envStubRespond(opts: { system: string; user: string }): AiResult {
  if (opts.user.includes('"dimensions"')) {
    const dims = [
      "quantified_business_impact", "scope_scale", "ownership", "cross_functional_influence",
      "strategic_ambiguity", "technical_analytical_difficulty", "evidence_quality",
    ].map((d) => ({ dimension: d, score: 4, rationale: `[stub] deterministic rationale for ${d}` }));
    return { ok: true, model: "stub-transport", text: JSON.stringify({ dimensions: dims, written_rationale: "[stub] deterministic rationale." }) };
  }
  if (opts.user.includes("parsed_summaries")) {
    return {
      ok: true, model: "stub-transport",
      text: JSON.stringify({ required_skills: ["Python"], expected_scope: ["multi-team"], expected_metrics: ["retention"], seniority_signals: ["org-level influence"], comp_band_low: null, comp_band_high: null, parsed_summaries: ["[stub] parsed summary"] }),
    };
  }
  return { ok: true, model: "stub-transport", text: "[stub] deterministic generated content grounded in the provided sources." };
}

export async function callAnthropic(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiResult> {
  if (injectedTransport) return injectedTransport(opts);
  if (envStubActive()) return envStubRespond(opts);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, unavailable: true, error: "ANTHROPIC_API_KEY is not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: aiModel(),
        max_tokens: opts.maxTokens ?? 2000,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `anthropic ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    const text = json.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    return { ok: true, text, model: aiModel() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts and parses the first JSON object/array in a model response. */
export function parseModelJson<T>(text: string): T | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const candidate = text.slice(start).trim();
  for (let end = candidate.length; end > 0; end--) {
    try {
      return JSON.parse(candidate.slice(0, end)) as T;
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}
