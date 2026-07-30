import { NextResponse } from "next/server";
import { generateAssetVersion } from "@/lib/server/assetGeneration";
import { authenticatedUserId, serviceRoleConfigured } from "@/lib/server/supabaseAdmin";
import { supabaseForRequest } from "@/lib/server/supabase";

// The ONLY path from the browser to a generated version.
//
// The caller is authenticated with their own session, their user id is
// resolved server-side, the source graph is gated, the payload is built from
// the gated manifest, the model is called here, and the version is committed
// through the service-role transactional function together with its audit
// record. The browser supplies an asset id, optional guidance, and the
// ATTESTED_NO_METRIC acknowledgment — never model name, prompt hash, privacy
// class or truth summary.

const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request) {
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const userId = await authenticatedUserId(db);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });

  if (!serviceRoleConfigured()) {
    return NextResponse.json(
      { unavailable: true, message: "Generation is unavailable: SUPABASE_SERVICE_ROLE_KEY is not configured on the server." },
      { status: 503, headers: NO_STORE },
    );
  }

  const body = (await req.json()) as { assetId?: string; attestedNoMetricOverride?: boolean; guidance?: string };
  if (!body.assetId) return NextResponse.json({ error: "assetId required" }, { status: 400, headers: NO_STORE });

  try {
    const result = await generateAssetVersion(db, userId, body.assetId, {
      attestedNoMetricOverride: body.attestedNoMetricOverride ?? false,
      guidance: body.guidance,
    });
    if (result.blocked) return NextResponse.json({ blocked: true, reasons: result.blocked }, { status: 422, headers: NO_STORE });
    if (result.unavailable) {
      return NextResponse.json(
        { unavailable: true, message: "AI is not configured (ANTHROPIC_API_KEY absent). Generation is unavailable; you can author a version manually." },
        { status: 503, headers: NO_STORE },
      );
    }
    if (result.error) return NextResponse.json({ error: result.error }, { status: 502, headers: NO_STORE });
    return NextResponse.json({ version: result.version }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "generation failed" }, { status: 400, headers: NO_STORE });
  }
}
