import { createHash } from "node:crypto";

// Server-only Anthropic access. The API key never reaches a client bundle:
// this module is imported exclusively from route handlers. The model is
// environment-configured — never a hardcoded permanent product assumption.
// When no key is configured, callers receive { unavailable: true } and the
// UI shows a calm unavailable state; nothing is fabricated.

const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 45_000;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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

export async function callAnthropic(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiResult> {
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
