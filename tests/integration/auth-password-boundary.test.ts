import { hash } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { UserRole } from "@/generated/prisma/enums";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearRateLimit } from "@/services/rate-limit";

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

describe("bcrypt password input boundary", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const email = `password-boundary-${suffix}@example.com`;
  const ip = "198.51.100.83";
  const windowMinutes = 15;
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
  const originalTrustedProxyHops = process.env.TRUSTED_PROXY_HOPS;

  beforeAll(() => {
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOPS = "1";
  });

  afterAll(async () => {
    await Promise.all([
      clearRateLimit({
        action: "coordinator-login-ip",
        identity: ip,
        windowMinutes,
      }),
      clearRateLimit({
        action: "coordinator-login-pair",
        identity: `${ip}:${email}`,
        windowMinutes,
      }),
      clearRateLimit({
        action: "coordinator-login-account",
        identity: email,
        windowMinutes,
      }),
    ]);

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

  it("rejects a suffix beyond 72 UTF-8 bytes instead of accepting bcrypt's shared prefix", async () => {
    const exactPassword = `A1!${"x".repeat(69)}`;
    expect(Buffer.byteLength(exactPassword, "utf8")).toBe(72);
    const municipality = await prisma.municipality.create({
      data: { name: `TEST límite contraseña ${suffix}` },
    });
    const user = await prisma.user.create({
      data: {
        name: "Cuenta límite bcrypt",
        email,
        passwordHash: await hash(exactPassword, 4),
        role: UserRole.COORDINATOR,
        municipalityId: municipality.id,
        mustChangePassword: false,
      },
    });
    const authorize = credentialsAuthorize();
    const request = {
      body: {},
      query: {},
      headers: { "x-forwarded-for": ip },
      method: "POST",
    };

    try {
      await expect(
        Promise.resolve(
          authorize({ email, password: `${exactPassword}x` }, request),
        ),
      ).resolves.toBeNull();
      await expect(
        Promise.resolve(authorize({ email, password: exactPassword }, request)),
      ).resolves.toMatchObject({ id: user.id, email });
    } finally {
      await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.municipality.delete({ where: { id: municipality.id } });
    }
  });
});
