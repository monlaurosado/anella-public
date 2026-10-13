const META_UNSUPPORTED_DIRECTIVES = new Set([
  "frame-ancestors",
  "report-uri",
  "sandbox",
]);

/**
 * Builds the standards-compliant meta fallback for hosts that overwrite the
 * upstream CSP header. The response header remains the primary policy.
 */
export function contentSecurityPolicyForMeta(policy: string) {
  return policy
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .filter((directive) => {
      const [name] = directive.split(/\s+/, 1);
      return !META_UNSUPPORTED_DIRECTIVES.has(name);
    })
    .join("; ");
}
