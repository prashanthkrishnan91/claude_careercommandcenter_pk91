import { NextResponse } from "next/server";
import { generateAssetVersion } from "@/lib/server/assetGeneration";
import { supabaseForRequest } from "@/lib/server/supabase";

// Thin wrapper: the canonical source-graph gate, payload manifest, version
// chain, and audit all live in lib/assetService + lib/server/assetGeneration
// (tested directly with a deterministic transport capturing the exact
// outbound payload).
export async function POST(req: Request) {
  const db = supabaseForRequest(req);
  if (!db) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { assetId?: string; attestedNoMetricOverride?: boolean; guidance?: string };
  if (!body.assetId) return NextResponse.json({ error: "assetId required" }, { status: 400 });
  try {
    const result = await generateAssetVersion(db, body.assetId, {
      attestedNoMetricOverride: body.attestedNoMetricOverride ?? false,
      guidance: body.guidance,
    });
    if (result.blocked) return NextResponse.json({ blocked: true, reasons: result.blocked }, { status: 422 });
    if (result.unavailable) {
      return NextResponse.json({ unavailable: true, message: "AI is not configured (ANTHROPIC_API_KEY absent). Generation is unavailable; you can author a version manually." }, { status: 503 });
    }
    if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ version: result.version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "generation failed" }, { status: 400 });
  }
}
