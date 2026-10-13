import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  setCookie: vi.fn(),
  updateTag: vi.fn(),
  coordinator: {
    id: "",
    name: "Coordinación TEST concurrencia",
    email: "",
    role: "COORDINATOR" as const,
    municipalityId: "" as string | null,
    municipalityName: "Municipio TEST concurrencia" as string | null,
    organizationId: "" as string | null,
    organizationName: "Organización TEST concurrencia" as string | null,
    mustChangePassword: false,
    sessionVersion: 1,
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: actionMocks.updateTag,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: actionMocks.setCookie })),
  headers: vi.fn(
    async () =>
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        "x-real-ip": "127.0.0.1",
      }),
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`TEST_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/dal", () => ({
  assertCoordinator: vi.fn(async () => actionMocks.coordinator),
  incidentScopeWhere: vi.fn(() => ({
    municipalityId: actionMocks.coordinator.municipalityId ?? "__none__",
  })),
}));

vi.mock("@/services/rate-limit", () => ({
  consumeRateLimit: vi.fn(async () => true),
}));

import { pledgeContribution } from "@/services/pledge-contribution";
import {
  createIncident,
  createNeed,
  createSafePoint,
  updateContributionStatus,
} from "@/actions/coordination";
import {
  ContributionStatus,
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  Priority,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  getContributionAccessCookieName,
  LAST_CONTRIBUTION_COOKIE_NAME,
} from "@/services/contributions";

const outstanding = [
  ContributionStatus.PLEDGED,
  ContributionStatus.EN_ROUTE,
  ContributionStatus.PARTIALLY_DELIVERED,
];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const incidentIds: string[] = [];
let municipalityId = "";
let organizationId = "";
let coordinatorId = "";
let scenarioSequence = 0;

function formData(
  values: Record<string, string | number | boolean | undefined>,
) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === false) continue;
    result.set(key, value === true ? "on" : String(value));
  }
  return result;
}

async function scenario(label: string, quantityNeeded: number) {
  scenarioSequence += 1;
  const now = new Date();
  const incident = await prisma.incident.create({
    data: {
      publicCode: `RACE-${scenarioSequence}-${suffix}`.slice(0, 32),
      title: `SIMULACRO concurrencia ${label}`,
      type: IncidentType.OTHER,
      status: IncidentStatus.ACTIVE,
      priority: Priority.LOW,
      operationalLatitude: 41.5,
      operationalLongitude: 2.2,
      publicLocationLabel: "Municipio TEST concurrencia",
      publicLocationApprovedAt: now,
      publicLocationApprovedById: coordinatorId,
      verifiedAt: now,
      verifiedById: coordinatorId,
      createdById: coordinatorId,
      municipalityId,
      organizationId,
      timeZone: "Europe/Madrid",
    },
  });
  incidentIds.push(incident.id);
  const point = await prisma.safePoint.create({
    data: {
      incidentId: incident.id,
      municipalityId,
      name: `Punto ${label}`,
      address: "Dirección de simulacro",
      instructions: "Entrega únicamente al personal acreditado.",
      latitude: 41.51,
      longitude: 2.21,
      qrToken: `race-${scenarioSequence}-${suffix}`,
      isActive: true,
      validatedAt: now,
      validatedById: coordinatorId,
    },
  });
  const need = await prisma.need.create({
    data: {
      incidentId: incident.id,
      safePointId: point.id,
      type: NeedType.OTHER,
      title: `Necesidad ${label}`,
      quantityNeeded,
      unit: "uds",
      deadline: new Date("2099-01-01T11:00:00.000Z"),
      status: NeedStatus.ACTIVE,
      requestingOrganizationId: organizationId,
      requestedById: coordinatorId,
      validatedAt: now,
      validatedById: coordinatorId,
      publishedAt: now,
    },
  });
  return { incident, point, need };
}

function pledgeData(needId: string, index: number, quantity: number) {
  return formData({
    idempotencyKey: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    needId,
    citizenName: `Ciudadanía simultánea ${index}`,
    citizenPhone: `+34610${String(index).padStart(6, "0")}`,
    citizenEmail: "",
    quantity,
    eta: "",
    privacyConsent: true,
  });
}

describe("operational quantity and concurrency contracts", () => {
  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: `TEST concurrencia ${suffix}` },
    });
    municipalityId = municipality.id;
    const organization = await prisma.organization.create({
      data: {
        name: `TEST organización concurrencia ${suffix}`,
        municipalityId,
      },
    });
    organizationId = organization.id;
    const coordinator = await prisma.user.create({
      data: {
        name: "Coordinación TEST concurrencia",
        email: `concurrency-${suffix}@anella.test`,
        role: UserRole.COORDINATOR,
        municipalityId,
        organizationId,
      },
    });
    coordinatorId = coordinator.id;
    Object.assign(actionMocks.coordinator, {
      id: coordinator.id,
      email: coordinator.email,
      municipalityId,
      municipalityName: municipality.name,
      organizationId,
      organizationName: organization.name,
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { municipalityId } });
    await prisma.incident.deleteMany({ where: { id: { in: incidentIds } } });
    await prisma.user.deleteMany({ where: { id: coordinatorId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.municipality.deleteMany({ where: { id: municipalityId } });
  });

  it("enforces quantity bounds in MySQL even outside application code", async () => {
    const { need, point } = await scenario("checks", 5);

    await expect(
      prisma.need.update({
        where: { id: need.id },
        data: { quantityReceived: 6 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.contribution.create({
        data: {
          publicCode: `CHK-${scenarioSequence}-${suffix}`.slice(0, 20),
          incidentId: need.incidentId,
          needId: need.id,
          safePointId: point.id,
          citizenName: "SIMULACRO",
          quantity: 3,
          deliveredQuantity: 4,
          consentAt: new Date(),
        },
      }),
    ).rejects.toThrow();

    const unchanged = await prisma.need.findUniqueOrThrow({
      where: { id: need.id },
    });
    expect(unchanged.quantityReceived).toBe(0);
  });

  it("serializes simultaneous real citizen pledges without overcommitting", async () => {
    const { incident, need } = await scenario("pledges", 5);
    actionMocks.setCookie.mockClear();
    actionMocks.updateTag.mockClear();

    const results = await Promise.all([
      pledgeContribution(
        { ok: false, message: "" },
        pledgeData(need.id, scenarioSequence * 10 + 1, 4),
      ),
      pledgeContribution(
        { ok: false, message: "" },
        pledgeData(need.id, scenarioSequence * 10 + 2, 4),
      ),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.message).toBe(
      "Ahora mismo solo faltan 1 uds.",
    );
    const [commitments, contributions, audits] = await Promise.all([
      prisma.contribution.aggregate({
        where: { needId: need.id, status: { in: outstanding } },
        _sum: { quantity: true },
      }),
      prisma.contribution.findMany({ where: { needId: need.id } }),
      prisma.auditLog.findMany({
        where: {
          incidentId: incident.id,
          action: "contribution.pledged_by_citizen",
        },
      }),
    ]);
    expect(commitments._sum.quantity).toBe(4);
    expect(contributions).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: null,
      entityId: contributions[0]?.id,
    });
    expect(audits[0]?.metadata).toEqual(
      expect.objectContaining({ quantity: 4, needId: need.id }),
    );
    expect(actionMocks.updateTag).not.toHaveBeenCalled();
    const successfulResult = results.find((result) => result.ok);
    expect(successfulResult?.publicCode).toBeTruthy();
    expect(successfulResult?.cancelToken).toBeTruthy();
    expect(actionMocks.setCookie).toHaveBeenCalledTimes(2);
    expect(actionMocks.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: getContributionAccessCookieName(successfulResult!.publicCode!),
        value: successfulResult!.cancelToken,
        httpOnly: true,
        secure: true,
        sameSite: "strict",
      }),
    );
    expect(actionMocks.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: LAST_CONTRIBUTION_COOKIE_NAME,
        value: successfulResult!.publicCode,
        httpOnly: true,
        secure: true,
        sameSite: "strict",
      }),
    );
  });

  it("accepts a verified need without automatic expiry", async () => {
    const { need } = await scenario("without-deadline", 3);
    await prisma.need.update({
      where: { id: need.id },
      data: { deadline: null },
    });

    const result = await pledgeContribution(
      { ok: false, message: "" },
      pledgeData(need.id, scenarioSequence * 10 + 9, 1),
    );

    expect(result).toMatchObject({ ok: true });
    await expect(
      prisma.contribution.count({ where: { needId: need.id } }),
    ).resolves.toBe(1);
  });

  it.each(["......", "------", "()()()", "+ + + + + +"])(
    "rejects a formatting-only citizen phone (%s)",
    async (citizenPhone) => {
      const data = pledgeData(
        "need-that-must-not-be-read",
        scenarioSequence * 10 + 3,
        1,
      );
      data.set("citizenPhone", citizenPhone);

      await expect(
        pledgeContribution({ ok: false, message: "" }, data),
      ).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining("teléfono válido"),
      });
    },
  );

  it("rejects reuse of a citizen idempotency key with any changed payload", async () => {
    const { need } = await scenario("pledge-idempotency", 10);
    const { need: otherNeed } = await scenario("pledge-idempotency-other", 10);
    const keyIndex = scenarioSequence * 10 + 4;
    const first = await pledgeContribution(
      { ok: false, message: "" },
      pledgeData(need.id, keyIndex, 1),
    );
    const changedQuantity = await pledgeContribution(
      { ok: false, message: "" },
      pledgeData(need.id, keyIndex, 2),
    );
    const changedPhoneData = pledgeData(need.id, keyIndex, 1);
    changedPhoneData.set("citizenPhone", "+34699123456");
    const changedPhone = await pledgeContribution(
      { ok: false, message: "" },
      changedPhoneData,
    );
    const changedNeed = await pledgeContribution(
      { ok: false, message: "" },
      pledgeData(otherNeed.id, keyIndex, 1),
    );

    expect(first.ok).toBe(true);
    for (const changed of [changedQuantity, changedPhone, changedNeed]) {
      expect(changed).toMatchObject({ ok: false });
      expect(changed.message).toContain("otros datos");
    }
    await expect(
      prisma.contribution.count({
        where: { needId: { in: [need.id, otherNeed.id] } },
      }),
    ).resolves.toBe(1);
  });

  it("creates one need for simultaneous submissions with the same key", async () => {
    const { incident, point } = await scenario("create-need-idempotency", 10);
    const title = `Necesidad idempotente ${suffix}`;
    const values = {
      idempotencyKey: "00000000-0000-4000-8000-000000000901",
      incidentId: incident.id,
      safePointId: point.id,
      type: "OTHER",
      title,
      description: "Creación concurrente de prueba",
      priority: "MEDIUM",
      quantityNeeded: 8,
      unit: "cajas",
      deadline: "2099-01-02T12:00",
      deadlineOccurrence: "reject",
      publish: true,
    };

    await Promise.allSettled([
      createNeed(formData(values)),
      createNeed(formData(values)),
    ]);

    const created = await prisma.need.findMany({
      where: { incidentId: incident.id, title },
    });
    expect(created).toHaveLength(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "need.created",
          entityId: created[0]!.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("creates one safe point for simultaneous submissions with the same key", async () => {
    const { incident } = await scenario("create-point-idempotency", 10);
    const name = `Punto idempotente ${suffix}`;
    const values = {
      idempotencyKey: "00000000-0000-4000-8000-000000000902",
      incidentId: incident.id,
      name,
      address: "Calle de la concurrencia, 1",
      instructions: "Acceso verificado para esta prueba concurrente.",
      latitude: 41.52,
      longitude: 2.22,
      radiusMeters: 30,
      capacityNote: "Prueba",
      confirmSafePointSafety: true,
    };

    await Promise.allSettled([
      createSafePoint(formData(values)),
      createSafePoint(formData(values)),
    ]);

    const created = await prisma.safePoint.findMany({
      where: { incidentId: incident.id, name },
    });
    expect(created).toHaveLength(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "safe_point.created_and_validated",
          entityId: created[0]!.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("creates one manual incident for simultaneous submissions with the same key", async () => {
    const title = `Incidente idempotente ${suffix}`;
    const values = {
      idempotencyKey: "00000000-0000-4000-8000-000000000903",
      title,
      type: "OTHER",
      priority: "LOW",
      publicSummary:
        "Incidente de simulacro creado con doble envío concurrente.",
      safetyNotice:
        "No te acerques; sigue únicamente indicaciones verificadas.",
      latitude: 41.53,
      longitude: 2.23,
      radiusMeters: 1500,
    };

    await Promise.allSettled([
      createIncident(formData(values)),
      createIncident(formData(values)),
    ]);

    const created = await prisma.incident.findMany({
      where: { municipalityId, title },
    });
    expect(created).toHaveLength(1);
    incidentIds.push(created[0]!.id);
    await expect(
      prisma.auditLog.count({
        where: { action: "incident.created", entityId: created[0]!.id },
      }),
    ).resolves.toBe(1);
  });

  it.each(["verifiedById", "publicLocationApprovedById"] as const)(
    "rejects a pledge when incident provenance field %s is removed",
    async (field) => {
      const { incident, need } = await scenario(`provenance-${field}`, 5);
      await prisma.incident.update({
        where: { id: incident.id },
        data: { [field]: null },
      });

      const result = await pledgeContribution(
        { ok: false, message: "" },
        pledgeData(need.id, scenarioSequence * 10 + 3, 1),
      );

      expect(result).toMatchObject({
        ok: false,
        message: "Esta necesidad ya no admite aportaciones.",
      });
      await expect(
        prisma.contribution.count({ where: { needId: need.id } }),
      ).resolves.toBe(0);
    },
  );

  it("rolls back the losing real reception and keeps revision and audit consistent", async () => {
    const { incident, need, point } = await scenario("receptions", 5);
    const contributions = await Promise.all(
      [1, 2].map((index) =>
        prisma.contribution.create({
          data: {
            publicCode: `RCV-${scenarioSequence}-${index}-${suffix}`.slice(
              0,
              20,
            ),
            incidentId: incident.id,
            needId: need.id,
            safePointId: point.id,
            citizenName: `SIMULACRO recepción ${index}`,
            quantity: 4,
            consentAt: new Date(),
          },
        }),
      ),
    );

    const results = await Promise.all(
      contributions.map((contribution) =>
        updateContributionStatus(
          { ok: false, message: "" },
          formData({
            incidentId: incident.id,
            contributionId: contribution.id,
            revision: contribution.revision,
            status: ContributionStatus.DELIVERED,
          }),
        ),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.message).toMatch(
      /alcanzado|modificado|cambiado/i,
    );

    const [updatedNeed, updatedContributions, audits] = await Promise.all([
      prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
      prisma.contribution.findMany({
        where: { needId: need.id },
        orderBy: { publicCode: "asc" },
      }),
      prisma.auditLog.findMany({
        where: {
          incidentId: incident.id,
          action: "contribution.status_changed",
        },
      }),
    ]);
    expect(updatedNeed).toMatchObject({
      quantityReceived: 4,
      status: NeedStatus.ACTIVE,
    });
    expect(
      updatedContributions.filter(
        (item) => item.status === ContributionStatus.DELIVERED,
      ),
    ).toHaveLength(1);
    expect(
      updatedContributions.filter(
        (item) => item.status === ContributionStatus.PLEDGED,
      ),
    ).toHaveLength(1);
    expect(updatedContributions.map((item) => item.revision).sort()).toEqual([
      1, 2,
    ]);
    expect(
      updatedContributions.map((item) => item.deliveredQuantity).sort(),
    ).toEqual([0, 4]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: coordinatorId,
      entityId: updatedContributions.find(
        (item) => item.status === ContributionStatus.DELIVERED,
      )?.id,
    });
    expect(audits[0]?.metadata).toEqual(
      expect.objectContaining({
        from: ContributionStatus.PLEDGED,
        to: ContributionStatus.DELIVERED,
        deliveredBefore: 0,
        deliveredAfter: 4,
        revisionBefore: 1,
      }),
    );
  });
});
