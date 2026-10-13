import { createHash, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getAutomaticFireIngestionConfig } from "@/config/env";
import { syncAutomaticFireDetections } from "@/services/fire-ingestion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validBearer(request: NextRequest, expected: string) {
  const header = request.headers.get("authorization") ?? "";
  const candidate = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : "";
  if (candidate.length > 512) return false;
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash) && candidate.length > 0;
}

export async function POST(request: NextRequest) {
  let config: ReturnType<typeof getAutomaticFireIngestionConfig>;
  try {
    config = getAutomaticFireIngestionConfig();
  } catch (error) {
    console.error("Automatic fire ingestion configuration is invalid", error);
    return NextResponse.json(
      { ok: false, error: "La ingesta automática no está configurada." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!config.enabled || !config.secret) {
    return NextResponse.json(
      { ok: false, error: "La ingesta automática está desactivada." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!validBearer(request, config.secret)) {
    return NextResponse.json(
      { ok: false, error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await syncAutomaticFireDetections();
    const status =
      result.status === "completed"
        ? 200
        : result.status === "busy"
          ? 409
          : 502;
    return NextResponse.json(result, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Automatic fire ingestion failed", error);
    return NextResponse.json(
      { ok: false, error: "La sincronización automática ha fallado." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
