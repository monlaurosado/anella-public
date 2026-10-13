import { createHash } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import {
  ContributionStatus,
  IncidentStatus,
  NeedStatus,
} from "@/generated/prisma/enums";
import { PRIVATE_JSON_BODY_LIMIT_BYTES } from "@/lib/bounded-json-request";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  consumeRateLimit: vi.fn(),
  revalidateTag: vi.fn(),
  transaction: vi.fn(),
  contributionUpdateMany: vi.fn(),
  incidentUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/db", () => ({
  prisma: {
    contribution: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/services/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));

import {
  CONTRIBUTION_ACCESS_COOKIE_MAX_AGE,
  authorizeContributionLinkExchange,
  cancelContributionByToken,
  createContributionPrivateLinkToken,
  getContributionAccessCookieName,
  getContributionAccessCookiePath,
  getContributionStatus,
  LAST_CONTRIBUTION_COOKIE_NAME,
  verifyContributionAccess,
} from "@/services/contributions";
import { POST as exchangeAccess } from "@/app/api/contributions/[code]/access/route";
import { POST as cancelContribution } from "@/app/api/contributions/[code]/cancel/route";
import { POST as createPrivateLink } from "@/app/api/contributions/[code]/private-link/route";

const token = "private-token-that-is-at-least-thirty-two-characters";
const originalAppUrl = process.env.APP_URL;
const originalIdempotencySecret = process.env.IDEMPOTENCY_SECRET;
const invalidAccessRequests: Array<{
  label: string;
  headers: Record<string, string>;
  body: string;
  status: number;
  message: string;
}> = [
  {
    label: "Content-Length inválido",
    headers: {
      "Content-Length": "invalid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
    status: 400,
    message: "Content-Length",
  },
  {
    label: "JSON malformado",
    headers: { "Content-Type": "application/json" },
    body: "{",
    status: 400,
    message: "JSON",
  },
];

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function contributionRecord({
  incidentStatus = IncidentStatus.ACTIVE,
  missingIncidentApproval,
  needStatus = NeedStatus.ACTIVE,
  safePointActive = true,
  safePointValidated = true,
  deadline = new Date("2026-07-14T08:00:00.000Z"),
}: {
  incidentStatus?: IncidentStatus;
  missingIncidentApproval?:
    | "verifiedAt"
    | "verifiedById"
    | "publicLocationApprovedAt"
    | "publicLocationApprovedById";
  needStatus?: NeedStatus;
  safePointActive?: boolean;
  safePointValidated?: boolean;
  deadline?: Date | null;
} = {}) {
  const incidentApproval: {
    verifiedAt: Date | null;
    verifiedById: string | null;
    publicLocationApprovedAt: Date | null;
    publicLocationApprovedById: string | null;
  } = {
    verifiedAt: new Date("2026-07-13T07:00:00.000Z"),
    verifiedById: "coordinator-1",
    publicLocationApprovedAt: new Date("2026-07-13T07:30:00.000Z"),
    publicLocationApprovedById: "coordinator-1",
  };
  if (missingIncidentApproval) {
    incidentApproval[missingIncidentApproval] = null;
  }

  return {
    publicCode: "AN-0123456789",
    cancelTokenHash: hashToken(token),
    status: ContributionStatus.PLEDGED,
    quantity: 4,
    deliveredQuantity: 0,
    eta: null,
    createdAt: new Date("2026-07-13T08:00:00.000Z"),
    safePointId: "point-1",
    safePoint: {
      id: "point-1",
      incidentId: "incident-1",
      name: "Centro cívico",
      address: "Carrer Major, 1",
      isActive: safePointActive,
      validatedAt: safePointValidated
        ? new Date("2026-07-13T07:00:00.000Z")
        : null,
      validatedById: safePointValidated ? "coordinator-1" : null,
    },
    need: {
      incidentId: "incident-1",
      safePointId: "point-1",
      title: "Agua potable",
      unit: "cajas",
      status: needStatus,
      deadline,
      validatedAt: new Date("2026-07-13T07:00:00.000Z"),
      validatedById: "coordinator-1",
      publishedAt: new Date("2026-07-13T07:30:00.000Z"),
      safePoint: {
        id: "point-1",
        incidentId: "incident-1",
        isActive: true,
        validatedAt: safePointValidated
          ? new Date("2026-07-13T07:00:00.000Z")
          : null,
        validatedById: safePointValidated ? "coordinator-1" : null,
      },
      incident: {
        status: incidentStatus,
        ...incidentApproval,
        title: "Incendio forestal",
        timeZone: "Europe/Madrid",
      },
    },
  };
}

describe("private contribution access", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.consumeRateLimit.mockReset();
    mocks.revalidateTag.mockReset();
    mocks.transaction.mockReset();
    mocks.contributionUpdateMany.mockReset();
    mocks.incidentUpdate.mockReset();
    mocks.auditCreate.mockReset();
    mocks.consumeRateLimit.mockResolvedValue(true);
    mocks.contributionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.incidentUpdate.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        contribution: { updateMany: mocks.contributionUpdateMany },
        incident: { update: mocks.incidentUpdate },
        auditLog: { create: mocks.auditCreate },
      }),
    );
    process.env.APP_URL = "https://anella.test";
    process.env.IDEMPOTENCY_SECRET =
      "anella-private-link-test-secret-with-at-least-32-characters";
  });

  afterAll(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
    if (originalIdempotencySecret === undefined) {
      delete process.env.IDEMPOTENCY_SECRET;
    } else {
      process.env.IDEMPOTENCY_SECRET = originalIdempotencySecret;
    }
  });

  it("uses a host-only cookie name without exposing the public code", () => {
    const cookieName = getContributionAccessCookieName("AN-0123456789");

    expect(cookieName).toMatch(/^__Host-anella-aportacion-[a-f0-9]{24}$/);
    expect(cookieName).not.toContain("AN-0123456789");
    expect(getContributionAccessCookiePath()).toBe("/");
  });

  it("returns the safe point only while the full delivery context is valid", async () => {
    mocks.findUnique.mockResolvedValue(contributionRecord());

    const result = await getContributionStatus(
      "AN-0123456789",
      token,
      new Date("2026-07-13T09:00:00.000Z"),
    );

    expect(result?.deliveryNotice.canProceed).toBe(true);
    expect(result?.safePointName).toBe("Centro cívico");
    expect(result?.safePointAddress).toBe("Carrer Major, 1");
  });

  it("blocks the delivery and hides the address after the deadline", async () => {
    mocks.findUnique.mockResolvedValue(contributionRecord());

    const result = await getContributionStatus(
      "AN-0123456789",
      token,
      new Date("2026-07-14T08:00:00.000Z"),
    );

    expect(result?.deliveryNotice.canProceed).toBe(false);
    expect(result?.deliveryNotice.message).toContain("plazo");
    expect(result?.safePointName).toBeUndefined();
    expect(result?.safePointAddress).toBeUndefined();
  });

  it("keeps a validated delivery available without automatic expiry", async () => {
    mocks.findUnique.mockResolvedValue(contributionRecord({ deadline: null }));

    const result = await getContributionStatus(
      "AN-0123456789",
      token,
      new Date("2026-07-13T09:00:00.000Z"),
    );

    expect(result?.deliveryNotice.canProceed).toBe(true);
    expect(result?.safePointAddress).toBe("Carrer Major, 1");
  });

  it("blocks the delivery when the assigned point no longer matches the need", async () => {
    const record = contributionRecord();
    record.need.safePointId = "point-2";
    record.need.safePoint.id = "point-2";
    mocks.findUnique.mockResolvedValue(record);

    const result = await getContributionStatus(
      "AN-0123456789",
      token,
      new Date("2026-07-13T09:00:00.000Z"),
    );

    expect(result?.deliveryNotice.canProceed).toBe(false);
    expect(result?.deliveryNotice.message).toContain("ha cambiado");
    expect(result?.safePointAddress).toBeUndefined();
  });

  it("blocks the delivery when the incident is no longer active", async () => {
    const record = contributionRecord({
      incidentStatus: IncidentStatus.RESOLVED,
    });
    mocks.findUnique.mockResolvedValue(record);

    const result = await getContributionStatus(
      "AN-0123456789",
      token,
      new Date("2026-07-13T09:00:00.000Z"),
    );

    expect(result?.deliveryNotice.canProceed).toBe(false);
    expect(result?.deliveryNotice.message).toContain("incidente");
    expect(result?.safePointAddress).toBeUndefined();
  });

  it.each([
    "verifiedAt",
    "verifiedById",
    "publicLocationApprovedAt",
    "publicLocationApprovedById",
  ] as const)(
    "blocks and hides the address when incident approval field %s is missing",
    async (missingIncidentApproval) => {
      mocks.findUnique.mockResolvedValue(
        contributionRecord({ missingIncidentApproval }),
      );

      const result = await getContributionStatus(
        "AN-0123456789",
        token,
        new Date("2026-07-13T09:00:00.000Z"),
      );

      expect(result?.incidentIsPublic).toBe(false);
      expect(result?.deliveryNotice.canProceed).toBe(false);
      expect(result?.deliveryNotice.message).toContain("incidente");
      expect(result?.safePointName).toBeUndefined();
      expect(result?.safePointAddress).toBeUndefined();
    },
  );

  it("blocks the delivery when the need is no longer active", async () => {
    const record = contributionRecord({ needStatus: NeedStatus.CANCELLED });
    mocks.findUnique.mockResolvedValue(record);

    const result = await getContributionStatus(
      "AN-0123456789",
      token,
      new Date("2026-07-13T09:00:00.000Z"),
    );

    expect(result?.deliveryNotice.canProceed).toBe(false);
    expect(result?.deliveryNotice.message).toContain("necesidad");
    expect(result?.safePointAddress).toBeUndefined();
  });

  it("blocks the delivery when the safe point is deactivated", async () => {
    const record = contributionRecord({ safePointActive: false });
    mocks.findUnique.mockResolvedValue(record);

    const result = await getContributionStatus(
      "AN-0123456789",
      token,
      new Date("2026-07-13T09:00:00.000Z"),
    );

    expect(result?.deliveryNotice.canProceed).toBe(false);
    expect(result?.deliveryNotice.message).toContain("desactivado");
    expect(result?.safePointAddress).toBeUndefined();
  });

  it("blocks and hides the address when human approval of the point is missing", async () => {
    const record = contributionRecord({ safePointValidated: false });
    mocks.findUnique.mockResolvedValue(record);

    const result = await getContributionStatus(
      "AN-0123456789",
      token,
      new Date("2026-07-13T09:00:00.000Z"),
    );

    expect(result?.deliveryNotice.canProceed).toBe(false);
    expect(result?.deliveryNotice.message).toContain("validación");
    expect(result?.safePointAddress).toBeUndefined();
  });

  it("does not reveal whether a code exists when the secret is invalid", async () => {
    mocks.findUnique.mockResolvedValue(contributionRecord());

    await expect(
      getContributionStatus(
        "AN-0123456789",
        "invalid-token-that-is-at-least-thirty-two-characters",
      ),
    ).resolves.toBeNull();
  });

  it("exchanges the fragment secret for a hardened no-store cookie", async () => {
    mocks.findUnique.mockResolvedValue({ cancelTokenHash: hashToken(token) });
    const portableToken = await createContributionPrivateLinkToken(
      "AN-0123456789",
      token,
    );
    const body = JSON.stringify({ token: portableToken });
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/access",
      {
        method: "POST",
        headers: {
          "Content-Length": String(Buffer.byteLength(body)),
          "Content-Type": "application/json; charset=utf-8",
          Origin: "https://anella.test",
        },
        body,
      },
    );

    const response = await exchangeAccess(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });
    const setCookie = response.headers.get("set-cookie");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(setCookie).toContain("__Host-anella-aportacion-");
    expect(setCookie).toContain(LAST_CONTRIBUTION_COOKIE_NAME);
    expect(setCookie).toContain("AN-0123456789");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain(token);
  });

  it("rejects replay of a legacy primary token through a fragment", async () => {
    mocks.findUnique.mockResolvedValue({ cancelTokenHash: hashToken(token) });
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/access",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://anella.test",
        },
        body: JSON.stringify({ token }),
      },
    );

    const response = await exchangeAccess(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("creates an expiring portable token without revealing the primary token", async () => {
    const now = new Date("2026-07-14T10:00:00.000Z");
    mocks.findUnique.mockResolvedValue({ cancelTokenHash: hashToken(token) });

    const portableToken = await createContributionPrivateLinkToken(
      "AN-0123456789",
      token,
      now,
    );

    expect(portableToken).toMatch(/^v1\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
    expect(portableToken).not.toContain(token);
    await expect(
      createContributionPrivateLinkToken(
        "AN-0123456789",
        portableToken!,
        new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      ),
    ).resolves.toBe(portableToken);
    await expect(
      authorizeContributionLinkExchange(
        "AN-0123456789",
        portableToken!,
        new Date(
          now.getTime() + CONTRIBUTION_ACCESS_COOKIE_MAX_AGE * 1_000 - 10_000,
        ),
      ),
    ).resolves.toEqual({ maxAge: 10 });
    await expect(
      verifyContributionAccess(
        "AN-0123456789",
        portableToken!,
        new Date(
          now.getTime() + CONTRIBUTION_ACCESS_COOKIE_MAX_AGE * 1_000 - 1,
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      verifyContributionAccess(
        "AN-0123456789",
        portableToken!,
        new Date(now.getTime() + CONTRIBUTION_ACCESS_COOKIE_MAX_AGE * 1_000),
      ),
    ).resolves.toBe(false);
  });

  it("allows cancellation with a valid portable token without storing its hash", async () => {
    const record = contributionRecord();
    const primaryHash = hashToken(token);
    mocks.findUnique
      .mockResolvedValueOnce({ cancelTokenHash: primaryHash })
      .mockResolvedValueOnce({
        ...record,
        id: "contribution-1",
        need: {
          ...record.need,
          incident: {
            ...record.need.incident,
            municipalityId: "municipality-1",
          },
        },
      });
    const portableToken = await createContributionPrivateLinkToken(
      "AN-0123456789",
      token,
    );

    await expect(
      cancelContributionByToken("AN-0123456789", portableToken!),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.contributionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cancelTokenHash: primaryHash }),
      }),
    );
    expect(hashToken(portableToken!)).not.toBe(primaryHash);
  });

  it("rejects an expired portable token before attempting cancellation", async () => {
    const primaryHash = hashToken(token);
    const expiredAt = new Date(
      Date.now() - (CONTRIBUTION_ACCESS_COOKIE_MAX_AGE + 1) * 1_000,
    );
    mocks.findUnique
      .mockResolvedValueOnce({ cancelTokenHash: primaryHash })
      .mockResolvedValueOnce({
        ...contributionRecord(),
        id: "contribution-1",
      });
    const expiredToken = await createContributionPrivateLinkToken(
      "AN-0123456789",
      token,
      expiredAt,
    );

    await expect(
      cancelContributionByToken("AN-0123456789", expiredToken!),
    ).resolves.toMatchObject({ ok: false });
    expect(mocks.contributionUpdateMany).not.toHaveBeenCalled();
  });

  it("returns a private fragment link only in a no-store response body", async () => {
    mocks.findUnique.mockResolvedValue({ cancelTokenHash: hashToken(token) });
    const cookieName = getContributionAccessCookieName("AN-0123456789");
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/private-link",
      {
        method: "POST",
        headers: {
          Cookie: `${cookieName}=${token}`,
          Origin: "https://anella.test",
          "Sec-Fetch-Site": "same-origin",
        },
      },
    );

    const response = await createPrivateLink(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });
    const body = await response.json();
    const privateLink = new URL(body.privateLink, "https://anella.test");
    const portableToken = new URLSearchParams(privateLink.hash.slice(1)).get(
      "token",
    );
    const responseHeaders = [...response.headers.values()].join("\n");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("location")).toBeNull();
    expect(privateLink.pathname).toBe("/aportaciones/AN-0123456789");
    expect(privateLink.search).toBe("");
    expect(portableToken).toMatch(/^v1\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
    expect(portableToken).not.toBe(token);
    expect(responseHeaders).not.toContain(token);
    expect(responseHeaders).not.toContain(portableToken!);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
  });

  it("rejects private-link creation without a same-origin request", async () => {
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/private-link",
      { method: "POST" },
    );

    const response = await createPrivateLink(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("requires a valid private cookie before creating a portable link", async () => {
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/private-link",
      {
        method: "POST",
        headers: { Origin: "https://anella.test" },
      },
    );

    const response = await createPrivateLink(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("rate-limits the access exchange before looking up a contribution", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce(false);
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/access",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://anella.test",
        },
        body: JSON.stringify({ token }),
      },
    );

    const response = await exchangeAccess(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects a cancellation body that is not JSON", async () => {
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/cancel",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://anella.test",
        },
        body: new URLSearchParams({ token }),
      },
    );

    const response = await cancelContribution(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("Content-Type application/json"),
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
  });

  it("rejects a declared oversized access body without consuming its stream", async () => {
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/access",
      {
        method: "POST",
        headers: {
          "Content-Length": String(PRIVATE_JSON_BODY_LIMIT_BYTES + 1),
          "Content-Type": "application/json",
          Origin: "https://anella.test",
        },
        body: JSON.stringify({ token }),
      },
    );

    const response = await exchangeAccess(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(
        `${PRIVATE_JSON_BODY_LIMIT_BYTES} bytes`,
      ),
    });
    expect(request.bodyUsed).toBe(false);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
  });

  it("stops an oversized streamed body even without Content-Length", async () => {
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/access",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://anella.test",
        },
        body: JSON.stringify({
          token,
          padding: "x".repeat(PRIVATE_JSON_BODY_LIMIT_BYTES),
        }),
      },
    );

    const response = await exchangeAccess(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(true);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
  });

  it.each(invalidAccessRequests)(
    "returns a clear 4xx response for $label",
    async ({ headers, body, status, message }) => {
      const request = new NextRequest(
        "https://anella.test/api/contributions/AN-0123456789/access",
        {
          method: "POST",
          headers: { ...headers, Origin: "https://anella.test" },
          body,
        },
      );

      const response = await exchangeAccess(request, {
        params: Promise.resolve({ code: "AN-0123456789" }),
      });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining(message),
      });
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    },
  );

  it("rate-limits cancellation before reading JSON or deriving a code bucket", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce(false);
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/cancel",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://anella.test",
        },
        body: JSON.stringify({ confirmed: true }),
      },
    );

    const response = await cancelContribution(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(request.bodyUsed).toBe(false);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contribution-cancel-ip" }),
    );
  });

  it("returns 401 when cancellation has no private cookie", async () => {
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/cancel",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://anella.test",
        },
        body: JSON.stringify({ confirmed: true }),
      },
    );

    const response = await cancelContribution(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("acceso privado"),
    });
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("invalidates the public snapshot after a successful citizen cancellation", async () => {
    const record = contributionRecord();
    mocks.findUnique.mockResolvedValue({
      ...record,
      id: "contribution-1",
      need: {
        ...record.need,
        incident: {
          ...record.need.incident,
          municipalityId: "municipality-1",
        },
      },
    });
    const cookieName = getContributionAccessCookieName("AN-0123456789");
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/cancel",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${cookieName}=${token}`,
          Origin: "https://anella.test",
        },
        body: JSON.stringify({ confirmed: true }),
      },
    );

    const response = await cancelContribution(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://anella.test/aportaciones/AN-0123456789",
    );
    expect(mocks.contributionUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      PUBLIC_INCIDENTS_CACHE_TAG,
      { expire: 0 },
    );
  });

  it("rejects fragment exchange without a same-origin Origin header", async () => {
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/access",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      },
    );

    const response = await exchangeAccess(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("rejects cancellation sent from another origin even with a cookie", async () => {
    const cookieName = getContributionAccessCookieName("AN-0123456789");
    const request = new NextRequest(
      "https://anella.test/api/contributions/AN-0123456789/cancel",
      {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          Cookie: `${cookieName}=${token}`,
        },
      },
    );

    const response = await cancelContribution(request, {
      params: Promise.resolve({ code: "AN-0123456789" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
