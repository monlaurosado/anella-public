import { NextRequest, NextResponse } from "next/server";

import { getPublicFireDetectionMap } from "@/services/fire-detection-map";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const municipalityId =
      request.nextUrl.searchParams.get("municipalityId") ?? undefined;
    const featureCollection = await getPublicFireDetectionMap({
      municipalityId,
    });
    return NextResponse.json(featureCollection, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Public fire detection feed failed", error);
    return NextResponse.json(
      { error: "No se ha podido cargar el radar." },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
}
