import { createHash } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const requestState = vi.hoisted(() => ({
  contributionIp: "198.51.100.42",
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: vi.fn() })),
  headers: vi.fn(
    async () => new Headers({ "x-forwarded-for": requestState.contributionIp }),
  ),
}));

import { pledgeContribution } from "@/services/pledge-contribution";
import { POST as cancelContribution } from "@/app/api/contributions/[code]/cancel/route";
import { getAuthSecret } from "@/config/env";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearRateLimit, consumeRateLimit } from "@/services/rate-limit";

const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
const originalTrustedProxyHops = process.env.TRUSTED_PROXY_HOPS;
const originalAppUrl = process.env.APP_URL;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const loginIp = "198.51.100.41";
const cancellationIp = "198.51.100.43";
const loginWindowMinutes = 15;
const contributionWindowMinutes = 10;
const cancellationWindowMinutes = 10;
const loginEmails = [0, 1, 2].map(
  (index) => `blocked-${suffix}-${index}@example.com`,
);
const contributionAttempts = [0, 1, 2].map((index) => ({
  needId: `blocked-need-${suffix}-${index}`,
  phone: `+3469900${String(index).padStart(4, "0")}`,
}));
const cancellationCodes = [0, 1, 2].map((index) =>
  `AN-C${Date.now().toString(36).slice(-6)}${index}`.toUpperCase(),
);

type Authorize = (
  credentials: Record<string, string> | undefined,
  request: {
    body: Record<string, unknown>;
    query: Record<string, unknown>;
    headers: Record<string, string>;
    method: string;
  },
) => Promise<unknown> | unknown;

function credentialsAuthorize() {
  const provider = authOptions.providers.find(
    (candidate) =>
      typeof candidate !== "function" && candidate.id === "credentials",
  );
  if (!provider || typeof provider === "function") {
    throw new Error("Credentials provider not configured");
  }

  const options = (
    provider as unknown as { options?: { authorize?: Authorize } }
  ).options;
  if (!options?.authorize) {
    throw new Error("Credentials authorize callback not configured");
  }
  return options.authorize;
}

function contributionForm(
  attempt: { needId: string; phone: string },
  index: number,
) {
  const data = new FormData();
  data.set(
    "idempotencyKey",
    `00000000-0000-4000-8000-${String(index + 800).padStart(12, "0")}`,
  );
  data.set("needId", attempt.needId);
  data.set("citizenName", `Ciudadanía bloqueada ${index}`);
  data.set("citizenPhone", attempt.phone);
  data.set("citizenEmail", "");
  data.set("quantity", "1");
  data.set("eta", "");
  data.set("privacyConsent", "on");
  return data;
}

async function exhaustRateLimit({
  action,
  identity,
  limit,
  windowMinutes,
}: {
  action: string;
  identity: string;
  limit: number;
  windowMinutes: number;
}) {
  let allowed = true;
  for (let attempt = 0; attempt <= limit; attempt += 1) {
    allowed = await consumeRateLimit({
      action,
      identity,
      limit,
      windowMinutes,
    });
  }
  expect(allowed).toBe(false);
}

type RateLimitBucket = { action: string; identity: string };

function bucketKeyHash(identity: string) {
  return createHash("sha256")
    .update(`${getAuthSecret()}:${identity}`)
    .digest("hex");
}

async function countThrottleRows(buckets: RateLimitBucket[]) {
  return prisma.submissionThrottle.count({
    where: {
      OR: buckets.map(({ action, identity }) => ({
        action,
        keyHash: bucketKeyHash(identity),
      })),
    },
  });
}

describe("coarse rate-limit buckets bound throttle-key growth", () => {
  beforeAll(() => {
    process.env.APP_URL = "https://anella.test";
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOPS = "1";
  });

  afterAll(async () => {
    await Promise.all([
      clearRateLimit({
        action: "coordinator-login-ip",
        identity: loginIp,
        windowMinutes: loginWindowMinutes,
      }),
      clearRateLimit({
        action: "pledge-contribution-ip",
        identity: requestState.contributionIp,
        windowMinutes: contributionWindowMinutes,
      }),
      clearRateLimit({
        action: "contribution-cancel-ip",
        identity: cancellationIp,
        windowMinutes: cancellationWindowMinutes,
      }),
      ...loginEmails.flatMap((email) => [
        clearRateLimit({
          action: "coordinator-login-pair",
          identity: `${loginIp}:${email}`,
          windowMinutes: loginWindowMinutes,
        }),
        clearRateLimit({
          action: "coordinator-login-account",
          identity: email,
          windowMinutes: loginWindowMinutes,
        }),
      ]),
      ...contributionAttempts.flatMap(({ needId, phone }) => [
        clearRateLimit({
          action: "pledge-contribution-ip-need",
          identity: `${requestState.contributionIp}:${needId}`,
          windowMinutes: contributionWindowMinutes,
        }),
        clearRateLimit({
          action: "pledge-contribution-identity",
          identity: `${requestState.contributionIp}:${phone}`,
          windowMinutes: contributionWindowMinutes,
        }),
      ]),
      ...cancellationCodes.map((code) =>
        clearRateLimit({
          action: "contribution-cancel-ip-code",
          identity: `${cancellationIp}:${code}`,
          windowMinutes: cancellationWindowMinutes,
        }),
      ),
    ]);

    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
    if (originalTrustProxyHeaders === undefined) {
      delete process.env.TRUST_PROXY_HEADERS;
    } else {
      process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    }
    if (originalTrustedProxyHops === undefined) {
      delete process.env.TRUSTED_PROXY_HOPS;
    } else {
      process.env.TRUSTED_PROXY_HOPS = originalTrustedProxyHops;
    }
  });

  it("does not create pair or account rows when a blocked IP rotates emails", async () => {
    await exhaustRateLimit({
      action: "coordinator-login-ip",
      identity: loginIp,
      limit: 60,
      windowMinutes: loginWindowMinutes,
    });

    const coarseBucket = {
      action: "coordinator-login-ip",
      identity: loginIp,
    };
    const fineBuckets = loginEmails.flatMap((email) => [
      {
        action: "coordinator-login-pair",
        identity: `${loginIp}:${email}`,
      },
      {
        action: "coordinator-login-account",
        identity: email,
      },
    ]);
    const trackedBuckets = [coarseBucket, ...fineBuckets];
    const baselineRows = await countThrottleRows(trackedBuckets);
    const baselineFineRows = await countThrottleRows(fineBuckets);
    expect(baselineRows).toBe(1);
    expect(baselineFineRows).toBe(0);
    const authorize = credentialsAuthorize();

    for (const email of loginEmails) {
      await expect(
        Promise.resolve(
          authorize(
            { email, password: "Blocked-at-IP-2026!" },
            {
              body: {},
              query: {},
              headers: { "x-forwarded-for": loginIp },
              method: "POST",
            },
          ),
        ),
      ).resolves.toBeNull();
      await expect(countThrottleRows(trackedBuckets)).resolves.toBe(
        baselineRows,
      );
      await expect(countThrottleRows(fineBuckets)).resolves.toBe(
        baselineFineRows,
      );
    }
  });

  it("does not create per-need or per-phone rows when a blocked IP rotates both", async () => {
    await exhaustRateLimit({
      action: "pledge-contribution-ip",
      identity: requestState.contributionIp,
      limit: 20,
      windowMinutes: contributionWindowMinutes,
    });

    const coarseBucket = {
      action: "pledge-contribution-ip",
      identity: requestState.contributionIp,
    };
    const fineBuckets = contributionAttempts.flatMap(({ needId, phone }) => [
      {
        action: "pledge-contribution-ip-need",
        identity: `${requestState.contributionIp}:${needId}`,
      },
      {
        action: "pledge-contribution-identity",
        identity: `${requestState.contributionIp}:${phone}`,
      },
    ]);
    const trackedBuckets = [coarseBucket, ...fineBuckets];
    const baselineRows = await countThrottleRows(trackedBuckets);
    const baselineFineRows = await countThrottleRows(fineBuckets);
    expect(baselineRows).toBe(1);
    expect(baselineFineRows).toBe(0);

    for (const [index, attempt] of contributionAttempts.entries()) {
      const result = await pledgeContribution(
        { ok: false, message: "" },
        contributionForm(attempt, index),
      );

      expect(result).toEqual({
        ok: false,
        message:
          "Se han realizado demasiados intentos. Prueba de nuevo más tarde.",
      });
      await expect(countThrottleRows(trackedBuckets)).resolves.toBe(
        baselineRows,
      );
      await expect(countThrottleRows(fineBuckets)).resolves.toBe(
        baselineFineRows,
      );
    }
  });

  it("does not read cancellation bodies or create per-code rows for a blocked IP", async () => {
    await exhaustRateLimit({
      action: "contribution-cancel-ip",
      identity: cancellationIp,
      limit: 30,
      windowMinutes: cancellationWindowMinutes,
    });

    const coarseBucket = {
      action: "contribution-cancel-ip",
      identity: cancellationIp,
    };
    const fineBuckets = cancellationCodes.map((code) => ({
      action: "contribution-cancel-ip-code",
      identity: `${cancellationIp}:${code}`,
    }));
    const trackedBuckets = [coarseBucket, ...fineBuckets];
    const baselineRows = await countThrottleRows(trackedBuckets);
    const baselineFineRows = await countThrottleRows(fineBuckets);
    expect(baselineRows).toBe(1);
    expect(baselineFineRows).toBe(0);

    for (const code of cancellationCodes) {
      const request = new NextRequest(
        `https://anella.test/api/contributions/${code}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://anella.test",
            "x-forwarded-for": cancellationIp,
          },
          body: JSON.stringify({ confirmed: true }),
        },
      );

      const response = await cancelContribution(request, {
        params: Promise.resolve({ code }),
      });

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("600");
      expect(request.bodyUsed).toBe(false);
      await expect(countThrottleRows(trackedBuckets)).resolves.toBe(
        baselineRows,
      );
      await expect(countThrottleRows(fineBuckets)).resolves.toBe(
        baselineFineRows,
      );
    }
  });
});
