import { describe, expect, it } from "vitest";

import { contentSecurityPolicyForMeta } from "@/lib/content-security-policy";

describe("contentSecurityPolicyForMeta", () => {
  it("preserves enforceable directives and the per-request nonce", () => {
    const policy = contentSecurityPolicyForMeta(
      "default-src 'self'; script-src 'nonce-request-123' 'strict-dynamic'; " +
        "frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests",
    );

    expect(policy).toBe(
      "default-src 'self'; script-src 'nonce-request-123' 'strict-dynamic'; " +
        "object-src 'none'; upgrade-insecure-requests",
    );
  });

  it("omits directives that browsers ignore in a CSP meta element", () => {
    const policy = contentSecurityPolicyForMeta(
      "sandbox allow-forms; report-uri /csp-report; frame-ancestors 'none'",
    );

    expect(policy).toBe("");
  });
});
