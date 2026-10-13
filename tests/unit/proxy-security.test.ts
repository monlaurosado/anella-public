import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

describe("application security proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["normal navigation", {}],
    ["router prefetch", { "next-router-prefetch": "1" }],
    ["purpose prefetch", { purpose: "prefetch" }],
  ])("sets CSP for %s", (_name, headers) => {
    const response = proxy(
      new NextRequest("https://anella.example/coordinacion", { headers }),
    );

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    expect(response.headers.get("X-Anella-Upstream-CSP")).toBe(
      response.headers.get("Content-Security-Policy"),
    );
    expect(response.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it.each([
    "/aportaciones/AN-PRIVATE",
    "/api/contributions/AN-PRIVATE/access",
    "/api/contributions/AN-PRIVATE/cancel",
    "/api/contributions/AN-PRIVATE/private-link",
  ])("does not send a referrer from private contribution route %s", (path) => {
    const response = proxy(new NextRequest(`https://anella.example${path}`));

    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("hardens and prevents indexing of the technical staging host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANELLA_ENV", "staging");

    const response = proxy(
      new NextRequest("https://staging.anella.example/incidentes"),
    );

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "upgrade-insecure-requests",
    );
    expect(response.headers.get("X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive",
    );
  });
});
