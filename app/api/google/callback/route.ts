import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";
import { encryptToken, exchangeCode, GOOGLE_SCOPES, googleConfigured } from "@/lib/server/google";
import { clearStateCookie, readStateCookie, validateState } from "@/lib/server/oauthState";

// OAuth callback. Validates the single-use state (constant-time nonce match,
// expiry, provider enum, user binding) from the encrypted HttpOnly cookie,
// consumes it exactly once, exchanges the code with PKCE, and stores the
// encrypted refresh token under the initiating user's RLS identity. Errors
// never reveal token-exchange response bodies.

function redirectTo(origin: string, result: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/settings?google=${result}`);
  res.headers.set("cache-control", "no-store");
  res.headers.append("set-cookie", clearStateCookie()); // single-use: always consume
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleConfigured()) return redirectTo(url.origin, "unavailable");

  const validation = validateState(readStateCookie(req), url.searchParams.get("state"));
  if (!validation.ok) return redirectTo(url.origin, `rejected_${validation.reason}`);
  const binding = validation.binding;

  const code = url.searchParams.get("code");
  if (!code) return redirectTo(url.origin, "error");
  if (binding.redirectUri !== `${url.origin}/api/google/callback`) {
    return redirectTo(url.origin, "rejected_callback_mismatch");
  }

  try {
    const tokens = await exchangeCode(code, binding.redirectUri, binding.codeVerifier);
    if (!tokens.refresh_token) throw new Error("no refresh token");
    const email = tokens.id_token
      ? ((JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email ?? "")
      : "";
    const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${binding.supabaseAccessToken}` } },
    });
    // The session must still belong to the user who initiated the flow.
    const { data: userData } = await db.auth.getUser();
    if (!userData.user || userData.user.id !== binding.userId) {
      return redirectTo(url.origin, "rejected_user_mismatch");
    }
    await db.from("google_connections").delete().eq("provider", binding.provider);
    const { error } = await db.from("google_connections").insert({
      provider: binding.provider,
      scopes: [GOOGLE_SCOPES[binding.provider]],
      account_email: email,
      refresh_token_encrypted: encryptToken(tokens.refresh_token),
    });
    if (error) throw new Error("store failed");
    return redirectTo(url.origin, "connected");
  } catch {
    // Generic failure — no upstream response bodies, no token material.
    return redirectTo(url.origin, "error");
  }
}
