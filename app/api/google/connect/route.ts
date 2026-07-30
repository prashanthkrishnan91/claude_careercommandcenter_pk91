import { NextResponse } from "next/server";
import { authUrl, googleConfigured } from "@/lib/server/google";
import {
  issueState,
  newBinding,
  OAUTH_PROVIDERS,
  OAUTH_STATE_TTL_SECONDS,
  seal,
  stateCookie,
  type OAuthProvider,
} from "@/lib/server/oauthState";
import { supabaseForRequest } from "@/lib/server/supabase";

// Starts the OAuth consent flow. The initiating request is authenticated
// server-side (Supabase session token in the Authorization header — never in
// the URL). The state parameter is an opaque random nonce whose HASH is
// persisted server-side as an unconsumed `oauth_states` row; the callback
// claims that row atomically, which is what makes the state single-use. The
// encrypted cookie carries the caller's session so the callback can act as
// them — it is transport, not authority.

const PROVIDERS = new Set<string>(OAUTH_PROVIDERS);
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
  const binding = newBinding(userData.user.id, provider as OAuthProvider, redirectUri, accessToken);
  // Persist the single-use record BEFORE handing the nonce to the browser; if
  // this fails there is no usable state and the flow never starts.
  try {
    await issueState(db, binding);
  } catch {
    return NextResponse.json({ error: "could not start the connection" }, { status: 500, headers: NO_STORE });
  }
  const url = authUrl(binding.provider, redirectUri, binding.nonce, binding.codeVerifier);
  const res = NextResponse.json({ url }, { headers: NO_STORE });
  res.headers.append("set-cookie", stateCookie(seal(binding), OAUTH_STATE_TTL_SECONDS));
  return res;
}
