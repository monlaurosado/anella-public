import { isIP } from "node:net";

import { getTrustedProxyConfig } from "@/config/env";

type HeaderSource = Headers | Record<string, unknown> | undefined;

function readHeader(source: HeaderSource, name: string) {
  if (!source) return undefined;
  if (source instanceof Headers) return source.get(name) ?? undefined;

  const value = source[name] ?? source[name.toLowerCase()];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function normalizeAddress(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim().replace(/^"|"$/g, "");
  const withoutMappedPrefix = normalized.replace(/^::ffff:/i, "");
  return isIP(withoutMappedPrefix) ? withoutMappedPrefix : undefined;
}

/**
 * Reads forwarding headers only when an explicitly configured reverse proxy is
 * trusted. `trustedHops=1` chooses the right-most X-Forwarded-For address;
 * larger values walk left across a known proxy chain.
 */
export function getClientIp(source: HeaderSource) {
  const { trustHeaders, trustedHops } = getTrustedProxyConfig();
  if (!trustHeaders) return "proxy-headers-disabled";

  const forwarded = (readHeader(source, "x-forwarded-for") ?? "")
    .split(",")
    .map((value) => normalizeAddress(value))
    .filter((value): value is string => Boolean(value));
  const forwardedIndex = forwarded.length - trustedHops;
  if (forwardedIndex >= 0) return forwarded[forwardedIndex];

  return (
    normalizeAddress(readHeader(source, "x-real-ip")) ?? "unknown-proxy-client"
  );
}
