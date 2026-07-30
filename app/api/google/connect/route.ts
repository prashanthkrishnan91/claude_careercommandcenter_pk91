import { NextResponse } from "next/server";
import { authUrl, googleConfigured } from "@/lib/server/google";
import { newBinding, seal, stateCookie } from "@/lib/server/oauthState";
import { supabaseForRequest } from "@/lib/server/supabase";

// Starts the OAuth consent flow. The initiating request is authenticated
// server-side (Supabase session token in the Authorization header — never in
// the URL); the state parameter is a single-use random nonce; the full
// binding (user, provider, callback, PKCE verifier, session) lives only in
// an encrypted HttpOnly cookie.

const PROVIDERS = new Set(["gmail", "calendar"]);
const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { unavailable: true, message: "Google ingestion is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / CCC_TOKEN_ENCRYPTION_KEY absent)." },
      { status: 503, headers: NO_STORE },
    );
  }
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const { provider } = (await req.json()) as { provider?: string };
  if (!provider || !PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "unsupported provider" }, { status: 400, headers: NO_STORE });
  }
  const accessToken = (req.headers.get("authorization") ?? "").slice("Bearer ".length);
  const redirectUri = `${new URL(req.url).origin}/api/google/callback`;
  const binding = newBinding(userData.user.id, provider as "gmail" | "calendar", redirectUri, accessToken);
  const url = authUrl(binding.provider, redirectUri, binding.nonce, binding.codeVerifier);
  const res = NextResponse.json({ url }, { headers: NO_STORE });
  res.headers.append("set-cookie", stateCookie(seal(binding), 600));
  return res;
}
