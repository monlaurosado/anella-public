import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { isHostedDeployment, isStagingDeployment } from "@/config/env";

function contentSecurityPolicy(nonce: string) {
  const developmentConnectPolicy =
    process.env.NODE_ENV === "development" ? " ws: wss:" : "";
  const developmentScriptPolicy =
    process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const upgrade = isHostedDeployment() ? "; upgrade-insecure-requests" : "";

  return (
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScriptPolicy}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://tile.openstreetmap.org",
      "font-src 'self' data:",
      `connect-src 'self'${developmentConnectPolicy}`,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ") + upgrade
  );
}

function referrerPolicy(pathname: string) {
  return isPrivateContributionPath(pathname)
    ? "no-referrer"
    : "strict-origin-when-cross-origin";
}

function isPrivateContributionPath(pathname: string) {
  return (
    pathname === "/aportaciones" ||
    pathname.startsWith("/aportaciones/") ||
    pathname === "/api/contributions" ||
    pathname.startsWith("/api/contributions/")
  );
}

export function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", policy);
  // Some managed reverse proxies replace the standard CSP header. This copy
  // lets the final edge restore the exact nonce policy and remove the helper
  // header before the response is exposed.
  response.headers.set("X-Anella-Upstream-CSP", policy);
  response.headers.set(
    "Referrer-Policy",
    referrerPolicy(request.nextUrl.pathname),
  );
  if (isStagingDeployment()) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  if (isPrivateContributionPath(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
    },
  ],
};
