import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

// OAuth state security contract (release blocker #1): the `state` query
// parameter is an opaque single-use nonce; the full binding — user, provider,
// callback, PKCE verifier, session token, issue/expiry — travels ONLY in an
// encrypted+authenticated HttpOnly cookie. These tests exercise the actual
// module the routes use.

import {
  clearStateCookie,
  codeChallenge,
  newBinding,
  open,
  seal,
  stateCookie,
  validateState,
  type OAuthStateBinding,
} from "../lib/server/oauthState";
import { authUrl } from "../lib/server/google";

const KEY = randomBytes(32).toString("hex");
const USER = "5f0f8f5e-1111-4222-8333-444455556666";
const TOKEN = "sbat-super-secret-session-token";
const REDIRECT = "https://ccc.example.com/api/google/callback";

let priorKey: string | undefined;
let priorClient: string | undefined;
beforeAll(() => {
  priorKey = process.env.CCC_TOKEN_ENCRYPTION_KEY;
  priorClient = process.env.GOOGLE_CLIENT_ID;
  process.env.CCC_TOKEN_ENCRYPTION_KEY = KEY;
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
});
afterAll(() => {
  process.env.CCC_TOKEN_ENCRYPTION_KEY = priorKey;
  process.env.GOOGLE_CLIENT_ID = priorClient;
});

describe("OAuth state: nothing sensitive leaves the server unencrypted", () => {
  it("the authorization URL carries only the opaque nonce — no token, user id, or email anywhere", () => {
    const b = newBinding(USER, "gmail", REDIRECT, TOKEN);
    const url = authUrl("gmail", REDIRECT, b.nonce, b.codeVerifier);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("state")).toBe(b.nonce);
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain(USER);
    expect(url).not.toContain(b.codeVerifier); // only the S256 challenge travels
    expect(parsed.searchParams.get("code_challenge")).toBe(codeChallenge(b.codeVerifier));
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("the nonce itself is random and carries no derived data", () => {
    const b1 = newBinding(USER, "gmail", REDIRECT, TOKEN);
    const b2 = newBinding(USER, "gmail", REDIRECT, TOKEN);
    expect(b1.nonce).not.toBe(b2.nonce);
    expect(b1.codeVerifier).not.toBe(b2.codeVerifier);
    expect(b1.nonce).not.toContain(USER.slice(0, 8));
  });

  it("the sealed cookie is ciphertext: none of the bound values appear in it", () => {
    const b = newBinding(USER, "gmail", REDIRECT, TOKEN);
    const sealed = seal(b);
    for (const secret of [TOKEN, USER, b.codeVerifier, b.nonce, "gmail", REDIRECT]) {
      expect(sealed).not.toContain(secret);
    }
  });

  it("seal → open round-trips the full binding", () => {
    const b = newBinding(USER, "calendar", REDIRECT, TOKEN);
    expect(open(seal(b))).toEqual(b);
  });

  it("fails closed when the encryption key is missing or malformed", () => {
    const b = newBinding(USER, "gmail", REDIRECT, TOKEN);
    process.env.CCC_TOKEN_ENCRYPTION_KEY = "";
    expect(() => seal(b)).toThrow(/32 bytes/);
    process.env.CCC_TOKEN_ENCRYPTION_KEY = "abcd"; // too short
    expect(() => seal(b)).toThrow(/32 bytes/);
    process.env.CCC_TOKEN_ENCRYPTION_KEY = KEY;
  });

  it("a cookie sealed under one key does not open under another (rotation revokes)", () => {
    const b = newBinding(USER, "gmail", REDIRECT, TOKEN);
    const sealed = seal(b);
    process.env.CCC_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    expect(open(sealed)).toBeNull();
    process.env.CCC_TOKEN_ENCRYPTION_KEY = KEY;
  });
});

describe("OAuth state validation", () => {
  const mk = (over: Partial<OAuthStateBinding> = {}) => ({
    ...newBinding(USER, "gmail" as const, REDIRECT, TOKEN),
    ...over,
  });

  it("accepts the genuine cookie + matching state nonce", () => {
    const b = mk();
    const v = validateState(seal(b), b.nonce);
    expect(v).toEqual({ ok: true, binding: b });
  });

  it("rejects a missing cookie or missing state parameter", () => {
    const b = mk();
    expect(validateState(undefined, b.nonce)).toEqual({ ok: false, reason: "missing" });
    expect(validateState(seal(b), null)).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a tampered cookie (any flipped ciphertext byte fails GCM auth)", () => {
    const b = mk();
    const sealed = seal(b);
    const parts = sealed.split(".");
    const body = Buffer.from(parts[1], "base64url");
    body[0] ^= 0xff;
    parts[1] = body.toString("base64url");
    expect(validateState(parts.join("."), b.nonce)).toEqual({ ok: false, reason: "malformed" });
    expect(validateState("garbage", b.nonce)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an expired binding", () => {
    const b = mk();
    const v = validateState(seal(b), b.nonce, b.exp + 1);
    expect(v).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a wrong nonce (including truncations and other users' nonces)", () => {
    const b = mk();
    const other = mk();
    expect(validateState(seal(b), other.nonce)).toEqual({ ok: false, reason: "nonce_mismatch" });
    expect(validateState(seal(b), b.nonce.slice(0, -1))).toEqual({ ok: false, reason: "nonce_mismatch" });
    expect(validateState(seal(b), `${b.nonce}x`)).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("rejects a provider outside the closed enum, even inside an authentic cookie", () => {
    const b = mk({ provider: "drive" as never });
    expect(validateState(seal(b), b.nonce)).toEqual({ ok: false, reason: "bad_provider" });
  });
});

describe("OAuth state cookie shape", () => {
  it("is HttpOnly, Secure, SameSite=Lax and scoped to /api/google", () => {
    const c = stateCookie("value", 600);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/api/google");
    expect(c).toContain("Max-Age=600");
  });

  it("clearStateCookie immediately expires the cookie (single-use)", () => {
    expect(clearStateCookie()).toContain("Max-Age=0");
  });
});
