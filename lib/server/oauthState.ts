import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// OAuth state.
//
// AUTHORITY: a server-side `oauth_states` row, claimed ATOMICALLY by
// `ccc_claim_oauth_state` — a single conditional UPDATE whose guard
// (`consumed_at is null and expires_at > now()`) lives in the WHERE clause.
// Two concurrent callbacks contend on the row lock; the loser re-evaluates the
// guard after the winner commits and matches zero rows. Replay therefore fails
// even when the attacker replays the original cookie, and even when both
// requests arrive at the same instant. Cookie expiry is NOT the mechanism.
//
// The `state` query parameter is an opaque random nonce; only its SHA-256 hash
// is stored. The PKCE verifier and the session binding are encrypted
// (AES-256-GCM) before they reach the database, so a database reader alone
// cannot complete or hijack a flow.
//
// The cookie remains only as the transport for the caller's own session so the
// callback can act as that user; it confers no single-use property.

const COOKIE_NAME = "ccc_oauth_state";
const TTL_SECONDS = 600;

export const OAUTH_PROVIDERS = ["gmail", "calendar"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface OAuthStateBinding {
  nonce: string;
  userId: string;
  provider: OAuthProvider;
  redirectUri: string;
  codeVerifier: string;
  supabaseAccessToken: string;
  iat: number;
  exp: number;
}

function key(): Buffer {
  const hex = process.env.CCC_TOKEN_ENCRYPTION_KEY ?? "";
  const k = Buffer.from(hex, "hex");
  if (k.length !== 32) throw new Error("CCC_TOKEN_ENCRYPTION_KEY must be 32 bytes of hex");
  return k;
}

export function encryptValue(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), enc.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decryptValue(sealed: string): string | null {
  try {
    const [iv, data, tag] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null; // tampered / malformed / wrong key
  }
}

export const seal = (binding: OAuthStateBinding): string => encryptValue(JSON.stringify(binding));

export function open(sealed: string): OAuthStateBinding | null {
  const plain = decryptValue(sealed);
  if (plain === null) return null;
  try {
    return JSON.parse(plain) as OAuthStateBinding;
  } catch {
    return null;
  }
}

/** The nonce is stored only as a hash; the raw value lives in the URL once. */
export function nonceHash(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function newBinding(
  userId: string,
  provider: OAuthProvider,
  redirectUri: string,
  supabaseAccessToken: string,
  now = Date.now(),
): OAuthStateBinding {
  return {
    nonce: randomBytes(24).toString("base64url"),
    userId,
    provider,
    redirectUri,
    codeVerifier: randomBytes(48).toString("base64url"),
    supabaseAccessToken,
    iat: now,
    exp: now + TTL_SECONDS * 1000,
  };
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Persists the state server-side. Returns the row id; throws on failure. */
export async function issueState(db: SupabaseClient, binding: OAuthStateBinding): Promise<string> {
  const { data, error } = await db.rpc("ccc_issue_oauth_state", {
    p_nonce_hash: nonceHash(binding.nonce),
    p_provider: binding.provider,
    p_redirect_uri: binding.redirectUri,
    p_code_verifier_encrypted: encryptValue(binding.codeVerifier),
    p_session_binding_encrypted: encryptValue(binding.supabaseAccessToken),
    p_ttl_seconds: TTL_SECONDS,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface ClaimedState {
  id: string;
  provider: OAuthProvider;
  redirectUri: string;
  codeVerifier: string;
}

/**
 * Atomically consumes the state. Returns null when it does not exist, has
 * already been consumed (replay), has expired, or belongs to another user.
 */
export async function claimState(db: SupabaseClient, nonce: string): Promise<ClaimedState | null> {
  const { data, error } = await db.rpc("ccc_claim_oauth_state", { p_nonce_hash: nonceHash(nonce) });
  if (error) return null;
  const row = data as {
    claimed: boolean;
    id?: string;
    provider?: string;
    redirect_uri?: string;
    code_verifier_encrypted?: string;
  };
  if (!row?.claimed) return null;
  if (!OAUTH_PROVIDERS.includes(row.provider as OAuthProvider)) return null;
  const verifier = decryptValue(row.code_verifier_encrypted ?? "");
  if (verifier === null) return null;
  return {
    id: row.id!,
    provider: row.provider as OAuthProvider,
    redirectUri: row.redirect_uri ?? "",
    codeVerifier: verifier,
  };
}

export type StateValidation =
  | { ok: true; binding: OAuthStateBinding }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "nonce_mismatch" | "bad_provider" };

/**
 * Cookie-side checks (cheap, local). These reject obviously bad requests
 * before the database round-trip; they are NOT the single-use mechanism.
 */
export function validateState(
  sealedCookie: string | undefined,
  stateParam: string | null,
  now = Date.now(),
): StateValidation {
  if (!sealedCookie || !stateParam) return { ok: false, reason: "missing" };
  const binding = open(sealedCookie);
  if (!binding) return { ok: false, reason: "malformed" };
  if (!OAUTH_PROVIDERS.includes(binding.provider)) return { ok: false, reason: "bad_provider" };
  if (now > binding.exp) return { ok: false, reason: "expired" };
  const a = Buffer.from(binding.nonce);
  const b = Buffer.from(stateParam);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "nonce_mismatch" };
  }
  return { ok: true, binding };
}

export function stateCookie(value: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${value}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearStateCookie(): string {
  return stateCookie("", 0);
}

export function readStateCookie(req: Request): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return undefined;
}

export { TTL_SECONDS as OAUTH_STATE_TTL_SECONDS };
