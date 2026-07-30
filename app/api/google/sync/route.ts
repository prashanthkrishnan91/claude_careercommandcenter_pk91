import { NextResponse } from "next/server";
import { createRow, listRows, updateRow } from "@/lib/genericRepo";
import {
  decryptToken,
  fetchCalendarCandidates,
  fetchGmailCandidates,
  googleConfigured,
  refreshAccessToken,
} from "@/lib/server/google";
import { supabaseForRequest } from "@/lib/server/supabase";
import type { GoogleConnection } from "@/lib/entities";

// Idempotent manual sync: fetches candidate items (metadata only), inserts
// unseen ones keyed by (user, external_id), logs the run. Every run is
// user-visible in the ingestion audit (v2 §8).
export async function POST(req: Request) {
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!googleConfigured()) {
    return NextResponse.json({ unavailable: true, message: "Google ingestion is not configured." }, { status: 503 });
  }
  const { provider } = (await req.json()) as { provider?: "gmail" | "calendar" };
  const connections = await listRows<GoogleConnection>(db, "google_connections", {
    eq: provider ? { provider } : {},
  });
  const connection = connections.find((c) => !c.revoked_at);
  if (!connection) return NextResponse.json({ error: "no active connection" }, { status: 404 });

  try {
    const accessToken = await refreshAccessToken(decryptToken(connection.refresh_token_encrypted));
    const candidates =
      connection.provider === "gmail"
        ? await fetchGmailCandidates(accessToken)
        : await fetchCalendarCandidates(accessToken);
    let inserted = 0;
    for (const c of candidates) {
      const { error } = await db
        .from("ingested_items")
        .insert({ ...c, connection_fk: connection.id });
      if (!error) inserted += 1; // duplicates rejected by the idempotency key
    }
    await createRow(db, "ingestion_runs", {
      connection_fk: connection.id,
      items_found: inserted,
      run_status: "ok",
    });
    await updateRow(db, "google_connections", connection.id, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: `ok: ${inserted} new item(s)`,
    });
    return NextResponse.json({ inserted, scanned: candidates.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await createRow(db, "ingestion_runs", {
      connection_fk: connection.id,
      run_status: "error",
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
