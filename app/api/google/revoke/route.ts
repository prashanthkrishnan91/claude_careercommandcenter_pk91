import { NextResponse } from "next/server";
import { getRow, updateRow } from "@/lib/genericRepo";
import { decryptToken, googleConfigured, revokeGoogleToken } from "@/lib/server/google";
import { supabaseForRequest } from "@/lib/server/supabase";
import type { GoogleConnection } from "@/lib/entities";

// One-click revocation (v2 §8): revokes the Google token upstream, purges the
// stored refresh token, and deletes ingested metadata for the connection.
export async function POST(req: Request) {
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { connectionId } = (await req.json()) as { connectionId?: string };
  if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  const connection = await getRow<GoogleConnection>(db, "google_connections", connectionId);
  if (!connection) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (googleConfigured() && connection.refresh_token_encrypted) {
    try {
      await revokeGoogleToken(decryptToken(connection.refresh_token_encrypted));
    } catch {
      // Upstream revocation is best-effort; local purge still proceeds.
    }
  }
  await db.from("ingested_items").delete().eq("connection_fk", connectionId);
  await updateRow(db, "google_connections", connectionId, {
    refresh_token_encrypted: "",
    revoked_at: new Date().toISOString(),
    status: "archived",
    last_sync_status: "revoked",
  });
  return NextResponse.json({ revoked: true });
}
