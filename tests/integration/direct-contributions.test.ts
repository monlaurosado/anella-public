import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setCookie: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.setCookie })),
  headers: vi.fn(async () => new Headers({ "x-real-ip": "127.0.0.44" })),
}));
vi.mock("@/services/rate-limit", () => ({
  consumeRateLimit: vi.fn(async () => true),
}));

import {
  ContributionCategory,
  ContributionOrigin,
  DropOffPointStatus,
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  OrganizationVerificationStatus,
  Priority,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { pledgeContribution } from "@/services/pledge-contribution";

function form(values: Record<string, string | number | boolean | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === false) continue;
    data.set(key, value === true ? "on" : String(value));
  }
  return data;
}

describe("citizen contributions without registration or mandatory needs", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const incidentIds: string[] = [];
  let municipalityId = "";
  let organizationId = "";
  let coordinatorId = "";
  let incidentId = "";
  let pointId = "";
  let needId = "";

  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: `TEST aportación directa ${suffix}` },
    });
    municipalityId = municipality.id;
    const organization = await prisma.organization.create({
      data: {
        name: `TEST entidad aportaciones ${suffix}`,
        municipalityId,
        verificationStatus: OrganizationVerificationStatus.VERIFIED,
      },
    });
    organizationId = organization.id;
    const coordinator = await prisma.user.create({
      data: {
        name: "Coordinación TEST aportaciones",
        email: `direct-${suffix}@example.test`,
        role: UserRole.COORDINATOR,
        municipalityId,
        organizationId,
      },
    });
    coordinatorId = coordinator.id;
    const now = new Date();
    const incident = await prisma.incident.create({
      data: {
        publicCode: `DIRECT-${suffix}`.slice(0, 32),
        title: "SIMULACRO · Emergencia con aportación directa",
        type: IncidentType.WILDFIRE,
        status: IncidentStatus.ACTIVE,
        priority: Priority.MEDIUM,
        municipalityId,
        organizationId,
        createdById: coordinatorId,
        operationalLatitude: 40.4,
        operationalLongitude: -3.7,
        verifiedAt: now,
        verifiedById: coordinatorId,
        publicLocationApprovedAt: now,
        publicLocationApprovedById: coordinatorId,
      },
    });
    incidentId = incident.id;
    incidentIds.push(incident.id);
    const point = await prisma.safePoint.create({
      data: {
        incidentId,
        municipalityId,
        name: "Punto de entrega TEST",
        address: "Dirección pública TEST",
        instructions: "Entrega solo al personal acreditado.",
        latitude: 40.39,
        longitude: -3.69,
        qrToken: `direct-point-${suffix}`,
        isActive: true,
        pointStatus: DropOffPointStatus.ACTIVE,
        publishedAt: now,
        validatedAt: now,
        validatedById: coordinatorId,
      },
    });
    pointId = point.id;
    const need = await prisma.need.create({
      data: {
        incidentId,
        safePointId: pointId,
        type: NeedType.WATER,
        title: "Solicitud histórica opcional",
        quantityNeeded: 20,
        unit: "cajas",
        deadline: new Date("2099-01-01T12:00:00.000Z"),
        status: NeedStatus.ACTIVE,
        requestingOrganizationId: organizationId,
        requestedById: coordinatorId,
        validatedAt: now,
        validatedById: coordinatorId,
        publishedAt: now,
      },
    });
    needId = need.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { municipalityId } });
    await prisma.incident.deleteMany({ where: { id: { in: incidentIds } } });
    await prisma.user.deleteMany({ where: { id: coordinatorId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.municipality.deleteMany({ where: { id: municipalityId } });
  });

  it("registers a direct contribution with no needId and no citizen account", async () => {
    const result = await pledgeContribution(
      { ok: false, message: "" },
      form({
        idempotencyKey: randomUUID(),
        incidentId,
        safePointId: pointId,
        category: "water",
        description: "Seis cajas de agua cerradas",
        quantity: 6,
        unit: "cajas",
      }),
    );

    expect(result).toMatchObject({ ok: true });
    const contribution = await prisma.contribution.findUniqueOrThrow({
      where: { publicCode: result.publicCode },
    });
    expect(contribution).toMatchObject({
      incidentId,
      safePointId: pointId,
      needId: null,
      category: ContributionCategory.WATER,
      origin: ContributionOrigin.PUBLIC_ANONYMOUS,
      citizenName: "Anónimo",
      citizenEmail: null,
      citizenPhone: null,
    });
    expect(mocks.setCookie).toHaveBeenCalled();
    expect(
      await prisma.user.count({ where: { email: result.publicCode } }),
    ).toBe(0);
  });

  it("keeps the legacy need link optional and internally consistent", async () => {
    const result = await pledgeContribution(
      { ok: false, message: "" },
      form({
        idempotencyKey: randomUUID(),
        needId,
        quantity: 2,
      }),
    );

    expect(result).toMatchObject({ ok: true });
    await expect(
      prisma.contribution.findUniqueOrThrow({
        where: { publicCode: result.publicCode },
      }),
    ).resolves.toMatchObject({
      incidentId,
      safePointId: pointId,
      needId,
      category: ContributionCategory.WATER,
    });
  });

  it("rejects closed points and a point belonging to another emergency", async () => {
    await prisma.safePoint.update({
      where: { id: pointId },
      data: {
        isActive: false,
        pointStatus: DropOffPointStatus.CLOSED,
        closedAt: new Date(),
      },
    });
    const closed = await pledgeContribution(
      { ok: false, message: "" },
      form({
        idempotencyKey: randomUUID(),
        incidentId,
        safePointId: pointId,
        category: "food",
        description: "Alimentos envasados",
      }),
    );
    expect(closed.ok).toBe(false);
    expect(closed.message).toMatch(/punto de entrega|activo/i);

    await prisma.safePoint.update({
      where: { id: pointId },
      data: {
        isActive: true,
        pointStatus: DropOffPointStatus.ACTIVE,
        closedAt: null,
      },
    });
    const otherIncident = await prisma.incident.create({
      data: {
        publicCode: `OTHER-${suffix}`.slice(0, 32),
        title: "SIMULACRO · Otra emergencia",
        type: IncidentType.OTHER,
        status: IncidentStatus.ACTIVE,
        priority: Priority.LOW,
        municipalityId,
        organizationId,
        createdById: coordinatorId,
        operationalLatitude: 40.5,
        operationalLongitude: -3.8,
        verifiedAt: new Date(),
        verifiedById: coordinatorId,
        publicLocationApprovedAt: new Date(),
        publicLocationApprovedById: coordinatorId,
      },
    });
    incidentIds.push(otherIncident.id);
    const crossIncident = await pledgeContribution(
      { ok: false, message: "" },
      form({
        idempotencyKey: randomUUID(),
        incidentId: otherIncident.id,
        safePointId: pointId,
        category: "other",
        description: "Material de prueba",
      }),
    );
    expect(crossIncident.ok).toBe(false);
  });

  it("rejects the configurable honeypot without persisting submitted PII", async () => {
    const email = `bot-${suffix}@example.test`;
    const result = await pledgeContribution(
      { ok: false, message: "" },
      form({
        idempotencyKey: randomUUID(),
        incidentId,
        safePointId: pointId,
        category: "other",
        description: "Texto automatizado",
        citizenEmail: email,
        privacyConsent: true,
        companyWebsite: "https://spam.example",
      }),
    );

    expect(result.ok).toBe(false);
    expect(
      await prisma.contribution.count({ where: { citizenEmail: email } }),
    ).toBe(0);
  });
});
