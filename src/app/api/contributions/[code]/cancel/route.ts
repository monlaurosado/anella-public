import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import { getAppUrl } from "@/config/env";
import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import { readBoundedJson } from "@/lib/bounded-json-request";
import { getClientIp } from "@/lib/client-ip";
import {
  cancelContributionByToken,
  getContributionAccessCookieName,
} from "@/services/contributions";
import { consumeRateLimit } from "@/services/rate-limit";

export const dynamic = "force-dynamic";

const publicCodeSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9-]+$/);
const cancellationSchema = z.object({ confirmed: z.literal(true) }).strict();
const privateHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function isAllowedOrigin(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    requestOrigin === new URL(getAppUrl()).origin &&
    (!fetchSite || fetchSite === "same-origin")
  );
}

function errorResponse(
  status: 400 | 401 | 403 | 409 | 413 | 415 | 429,
  message: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { ...privateHeaders, ...headers } },
  );
}

function redirectToCleanStatus(publicCode: string) {
  const response = NextResponse.redirect(
    new URL(`/aportaciones/${encodeURIComponent(publicCode)}`, getAppUrl()),
    { status: 303 },
  );

  for (const [name, value] of Object.entries(privateHeaders)) {
    response.headers.set(name, value);
  }

  return response;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  if (!isAllowedOrigin(request)) {
    return errorResponse(403, "El origen de la solicitud no está permitido.");
  }

  const requestIp = getClientIp(request.headers);
  const ipAllowed = await consumeRateLimit({
    action: "contribution-cancel-ip",
    identity: requestIp,
    limit: 30,
    windowMinutes: 10,
  });
  if (!ipAllowed) {
    return errorResponse(
      429,
      "Demasiados intentos. Prueba de nuevo más tarde.",
      { "Retry-After": "600" },
    );
  }

  const body = await readBoundedJson(request);
  if (!body.ok) {
    return errorResponse(body.status, body.message);
  }

  const { code } = await context.params;
  const parsedCode = publicCodeSchema.safeParse(code);

  if (!parsedCode.success) {
    return errorResponse(400, "El código de aportación no es válido.");
  }
  if (!cancellationSchema.safeParse(body.value).success) {
    return errorResponse(
      400,
      "El cuerpo JSON debe confirmar expresamente la cancelación.",
    );
  }

  const codeAllowed = await consumeRateLimit({
    action: "contribution-cancel-ip-code",
    identity: `${requestIp}:${parsedCode.data}`,
    limit: 10,
    windowMinutes: 10,
  });
  if (!codeAllowed) {
    return errorResponse(
      429,
      "Demasiados intentos. Prueba de nuevo más tarde.",
      { "Retry-After": "600" },
    );
  }

  const token = request.cookies.get(
    getContributionAccessCookieName(parsedCode.data),
  )?.value;

  if (!token) {
    return errorResponse(
      401,
      "El acceso privado a la aportación no es válido.",
    );
  }

  const result = await cancelContributionByToken(parsedCode.data, token);
  if (!result.ok) {
    return errorResponse(
      409,
      "La aportación ya no puede cancelarse o ha cambiado.",
    );
  }

  revalidateTag(PUBLIC_INCIDENTS_CACHE_TAG, { expire: 0 });
  return redirectToCleanStatus(parsedCode.data);
}
