import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ municipalityId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal", () => ({
  requireCoordinator: async () => ({
    id: "safe-point-operations-coordinator",
    name: "Coordinación de recepción",
    email: "safe-point-operations@example.test",
    role: "COORDINATOR" as const,
    municipalityId: scope.municipalityId,
    municipalityName: "Municipio de recepción",
    organizationId: null,
    organizationName: null,
    mustChangePassword: false,
    sessionVersion: 1,
  }),
  incidentScopeWhere: () => ({ municipalityId: scope.municipalityId }),
}));

import {
  ContributionStatus,
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  Priority,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getSafePointOperations } from "@/services/incidents";

describe("safe-point reception operations", () => {
  const suffix = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
  const qrToken = `safe-point-operations-${suffix}`;
  const contributionCodes: string[] = [];
  const contributionRevisions = new Map<string, number>();
  let municipalityId = "";
  let incidentId = "";

  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: `TEST municipio recepción ${suffix}` },
    });
    municipalityId = municipality.id;
    scope.municipalityId = municipality.id;

    const incident = await prisma.incident.create({
      data: {
        publicCode: `OPS-${suffix}`.slice(0, 32),
        title: "TEST incidente para recepción paginada",
        type: IncidentType.OTHER,
        status: IncidentStatus.ACTIVE,
        priority: Priority.MEDIUM,
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
      },
    });
    incidentId = incident.id;

    const safePoint = await prisma.safePoint.create({
      data: {
        incidentId: incident.id,
        municipalityId: municipality.id,
        name: "TEST punto de recepción paginada",
        address: "Calle de pruebas, 27",
        latitude: 41.51,
        longitude: 2.21,
        qrToken,
      },
    });
    const need = await prisma.need.create({
      data: {
        incidentId: incident.id,
        safePointId: safePoint.id,
        type: NeedType.OTHER,
        title: "TEST material para recepción paginada",
        quantityNeeded: 100,
        unit: "uds",
        status: NeedStatus.ACTIVE,
      },
    });
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const data = Array.from({ length: 27 }, (_, index) => {
      const publicCode = `OP${String(index).padStart(2, "0")}${suffix}`.slice(
        0,
        20,
      );
      const revision = index + 1;
      const timestamp = new Date(anchor.getTime() + index * 60_000);
      contributionCodes.push(publicCode);
      contributionRevisions.set(publicCode, revision);
      return {
        publicCode,
        incidentId: incident.id,
        needId: need.id,
        safePointId: safePoint.id,
        citizenName: `TEST persona ${index}`,
        quantity: 1,
        deliveredQuantity: 0,
        status: ContributionStatus.PLEDGED,
        revision,
        consentAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

    await prisma.contribution.createMany({ data });
  });

  afterAll(async () => {
    if (incidentId) {
      await prisma.incident.deleteMany({ where: { id: incidentId } });
    }
    if (municipalityId) {
      await prisma.municipality.deleteMany({ where: { id: municipalityId } });
    }
  });

  it("paginates the complete assigned queue and preserves every revision", async () => {
    const first = await getSafePointOperations(qrToken, {
      page: 1,
      pageSize: 10,
    });
    const second = await getSafePointOperations(qrToken, {
      page: 2,
      pageSize: 10,
    });
    const third = await getSafePointOperations(qrToken, {
      page: 3,
      pageSize: 10,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    if (!first || !second || !third) {
      throw new Error("El punto seguro de prueba no se ha recuperado.");
    }

    expect(first.isOperational).toBe(false);

    expect(first.contributions).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 27,
      pageCount: 3,
    });
    expect(first.contributions.items).toHaveLength(10);
    expect(first.contributions.items[0].publicCode).toBe(contributionCodes[26]);
    expect(second.contributions).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 27,
      pageCount: 3,
    });
    expect(second.contributions.items).toHaveLength(10);
    expect(third.contributions).toMatchObject({
      page: 3,
      pageSize: 10,
      total: 27,
      pageCount: 3,
    });
    expect(third.contributions.items).toHaveLength(7);

    const visible = [
      ...first.contributions.items,
      ...second.contributions.items,
      ...third.contributions.items,
    ];
    expect(new Set(visible.map((item) => item.id)).size).toBe(27);
    expect(new Set(visible.map((item) => item.publicCode))).toEqual(
      new Set(contributionCodes),
    );
    for (const contribution of visible) {
      expect(contribution.revision).toBe(
        contributionRevisions.get(contribution.publicCode),
      );
    }
  });

  it("keeps the QR lookup inside the coordinator municipality", async () => {
    const allowedMunicipalityId = scope.municipalityId;
    scope.municipalityId = "municipality-outside-test-scope";

    try {
      await expect(getSafePointOperations(qrToken)).resolves.toBeNull();
    } finally {
      scope.municipalityId = allowedMunicipalityId;
    }
  });

  it("clamps an extreme QR queue page before issuing its OFFSET query", async () => {
    const result = await getSafePointOperations(qrToken, {
      page: 999_999,
      pageSize: 10,
    });

    expect(result?.contributions).toMatchObject({
      page: 3,
      pageSize: 10,
      total: 27,
      pageCount: 3,
    });
    expect(result?.contributions.items).toHaveLength(7);
  });
});
