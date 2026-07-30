import { NextResponse } from "next/server";
import { authorManualVersionServer } from "@/lib/server/assetGeneration";
import { authenticatedUserId, serviceRoleConfigured } from "@/lib/server/supabaseAdmin";
import { supabaseForRequest } from "@/lib/server/supabase";

// Protected manual-version endpoint.
//
// The browser may submit exactly two things: the asset id and the content it
// typed. Privacy class, truth summary, model metadata, prompt hash, blocked
// status, supersession and current-version are all derived by the database —
// there is no request shape that can carry them.

const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request) {
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const userId = await authenticatedUserId(db);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });

  if (!serviceRoleConfigured()) {
    return NextResponse.json(
      { unavailable: true, message: "Version authoring is unavailable: SUPABASE_SERVICE_ROLE_KEY is not configured on the server." },
      { status: 503, headers: NO_STORE },
    );
  }

  const body = (await req.json()) as { assetId?: string; content?: string };
  if (!body.assetId) return NextResponse.json({ error: "assetId required" }, { status: 400, headers: NO_STORE });
  if (!body.content?.trim()) return NextResponse.json({ error: "content required" }, { status: 400, headers: NO_STORE });

  try {
    // Only the two accepted fields are forwarded; anything else in the body is
    // ignored by construction.
    const version = await authorManualVersionServer(userId, body.assetId, body.content);
    return NextResponse.json({ version }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "authoring failed" },
      { status: 400, headers: NO_STORE },
    );
  }
}
