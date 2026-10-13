import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAppUrl } from "@/config/env";
import { getClientIp } from "@/lib/client-ip";
import {
  createContributionPrivateLinkToken,
  getContributionAccessCookieName,
} from "@/services/contributions";
import { consumeRateLimit } from "@/services/rate-limit";

export const dynamic = "force-dynamic";

const publicCodeSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9-]+$/);
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
  status: 400 | 401 | 403 | 429,
  message: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { ...privateHeaders, ...headers } },
  );
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
    action: "contribution-private-link-ip",
    identity: requestIp,
    limit: 60,
    windowMinutes: 10,
  });
  if (!ipAllowed) {
    return errorResponse(
      429,
      "Demasiados intentos. Prueba de nuevo más tarde.",
      { "Retry-After": "600" },
    );
  }

  const { code } = await context.params;
  const parsedCode = publicCodeSchema.safeParse(code);
  if (!parsedCode.success) {
    return errorResponse(400, "El código de aportación no es válido.");
  }

  const codeAllowed = await consumeRateLimit({
    action: "contribution-private-link-ip-code",
    identity: `${requestIp}:${parsedCode.data}`,
    limit: 20,
    windowMinutes: 10,
  });
  if (!codeAllowed) {
    return errorResponse(
      429,
      "Demasiados intentos. Prueba de nuevo más tarde.",
      { "Retry-After": "600" },
    );
  }

  const currentToken = request.cookies.get(
    getContributionAccessCookieName(parsedCode.data),
  )?.value;
  if (!currentToken) {
    return errorResponse(
      401,
      "El acceso privado a la aportación no es válido.",
    );
  }

  const portableToken = await createContributionPrivateLinkToken(
    parsedCode.data,
    currentToken,
  );
  if (!portableToken) {
    return errorResponse(
      401,
      "El acceso privado a la aportación no es válido.",
    );
  }

  const privateLink = `/aportaciones/${encodeURIComponent(
    parsedCode.data,
  )}#token=${encodeURIComponent(portableToken)}`;

  return NextResponse.json(
    { ok: true, privateLink },
    { status: 200, headers: privateHeaders },
  );
}
