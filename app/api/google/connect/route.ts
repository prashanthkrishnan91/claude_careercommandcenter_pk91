import { NextResponse } from "next/server";
import { authUrl, googleConfigured } from "@/lib/server/google";

// Starts the OAuth consent flow. The state parameter carries the provider and
// the caller's Supabase access token so the callback can write the connection
// under the user's own RLS identity.
export async function POST(req: Request) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { unavailable: true, message: "Google ingestion is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / CCC_TOKEN_ENCRYPTION_KEY absent)." },
      { status: 503 },
    );
  }
  const { provider, accessToken } = (await req.json()) as {
    provider?: "gmail" | "calendar";
    accessToken?: string;
  };
  if (!provider || !accessToken) {
    return NextResponse.json({ error: "provider and accessToken required" }, { status: 400 });
  }
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/google/callback`;
  const state = Buffer.from(JSON.stringify({ provider, accessToken })).toString("base64url");
  return NextResponse.json({ url: authUrl(provider, redirectUri, state) });
}
