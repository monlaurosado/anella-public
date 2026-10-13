import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAppUrl } from "@/config/env";
import { readBoundedJson } from "@/lib/bounded-json-request";
import { getClientIp } from "@/lib/client-ip";
import {
  authorizeContributionLinkExchange,
  getContributionAccessCookieName,
  getContributionAccessCookiePath,
  LAST_CONTRIBUTION_COOKIE_NAME,
} from "@/services/contributions";
import { consumeRateLimit } from "@/services/rate-limit";

export const dynamic = "force-dynamic";

const publicCodeSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9-]+$/);
const accessSchema = z
  .object({
    token: z.string().min(32).max(128),
  })
  .strict();
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
  status: 400 | 401 | 403 | 413 | 415 | 429,
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
    action: "contribution-access-ip",
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

  const body = await readBoundedJson(request);
  if (!body.ok) {
    return errorResponse(body.status, body.message);
  }

  const { code } = await context.params;
  const parsedCode = publicCodeSchema.safeParse(code);
  const parsedAccess = accessSchema.safeParse(body.value);

  if (!parsedCode.success) {
    return errorResponse(400, "El código de aportación no es válido.");
  }
  if (!parsedAccess.success) {
    return errorResponse(
      400,
      "El cuerpo JSON no contiene un token privado válido.",
    );
  }

  const codeAllowed = await consumeRateLimit({
    action: "contribution-access-ip-code",
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

  const authorization = await authorizeContributionLinkExchange(
    parsedCode.data,
    parsedAccess.data.token,
  );

  if (!authorization) {
    return errorResponse(401, "El enlace privado no es válido.");
  }

  const response = NextResponse.json(
    { ok: true },
    { status: 200, headers: privateHeaders },
  );
  response.cookies.set({
    name: getContributionAccessCookieName(parsedCode.data),
    value: parsedAccess.data.token,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: getContributionAccessCookiePath(),
    maxAge: authorization.maxAge,
    priority: "high",
  });
  response.cookies.set({
    name: LAST_CONTRIBUTION_COOKIE_NAME,
    value: parsedCode.data,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: getContributionAccessCookiePath(),
    maxAge: authorization.maxAge,
    priority: "high",
  });

  return response;
}
