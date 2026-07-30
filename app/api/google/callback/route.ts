import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";
import { encryptToken, exchangeCode, GOOGLE_SCOPES, googleConfigured } from "@/lib/server/google";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleConfigured()) return NextResponse.redirect(`${url.origin}/settings?google=unavailable`);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code || !stateRaw) return NextResponse.redirect(`${url.origin}/settings?google=error`);
  try {
    const state = JSON.parse(Buffer.from(stateRaw, "base64url").toString()) as {
      provider: "gmail" | "calendar";
      accessToken: string;
    };
    const tokens = await exchangeCode(code, `${url.origin}/api/google/callback`);
    if (!tokens.refresh_token) throw new Error("no refresh token granted");
    const email = tokens.id_token
      ? (JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email ?? ""
      : "";
    const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${state.accessToken}` } },
    });
    // Upsert one connection per provider.
    await db.from("google_connections").delete().eq("provider", state.provider);
    const { error } = await db.from("google_connections").insert({
      provider: state.provider,
      scopes: [GOOGLE_SCOPES[state.provider]],
      account_email: email,
      refresh_token_encrypted: encryptToken(tokens.refresh_token),
    });
    if (error) throw new Error(error.message);
    return NextResponse.redirect(`${url.origin}/settings?google=connected`);
  } catch {
    return NextResponse.redirect(`${url.origin}/settings?google=error`);
  }
}
