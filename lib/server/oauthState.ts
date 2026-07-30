import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// OAuth state handling. NOTHING sensitive ever travels through the OAuth
// `state` query parameter: state is a single-use random nonce, and the full
// binding (user, provider, callback URL, PKCE verifier, issue/expiry, and the
// caller's Supabase session token) lives in an ENCRYPTED + AUTHENTICATED
// HttpOnly/Secure/SameSite=Lax cookie the browser cannot read.

const COOKIE_NAME = "ccc_oauth_state";
const TTL_MS = 10 * 60 * 1000;

export interface OAuthStateBinding {
  nonce: string;
  userId: string;
  provider: "gmail" | "calendar";
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

export function seal(binding: OAuthStateBinding): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(binding), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), enc.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function open(sealed: string): OAuthStateBinding | null {
  try {
    const [iv, data, tag] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(plain) as OAuthStateBinding;
  } catch {
    return null; // tampered / malformed / wrong key
  }
}

export function newBinding(
  userId: string,
  provider: "gmail" | "calendar",
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
    exp: now + TTL_MS,
  };
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export type StateValidation =
  | { ok: true; binding: OAuthStateBinding }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "nonce_mismatch" | "bad_provider" };

/** Constant-time nonce comparison; rejects missing/tampered/expired state. */
export function validateState(
  sealedCookie: string | undefined,
  stateParam: string | null,
  now = Date.now(),
): StateValidation {
  if (!sealedCookie || !stateParam) return { ok: false, reason: "missing" };
  const binding = open(sealedCookie);
  if (!binding) return { ok: false, reason: "malformed" };
  if (binding.provider !== "gmail" && binding.provider !== "calendar") {
    return { ok: false, reason: "bad_provider" };
  }
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
