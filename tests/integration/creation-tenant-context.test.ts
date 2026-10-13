import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const actionState = vi.hoisted(() => ({
  coordinator: {
    id: "",
    name: "Superadministración TEST",
    email: "",
    role: "SUPER_ADMIN" as "COORDINATOR" | "MUNICIPAL_ADMIN" | "SUPER_ADMIN",
    municipalityId: "" as string | null,
    municipalityName: "" as string | null,
    organizationId: "" as string | null,
    organizationName: "" as string | null,
    mustChangePassword: false,
    sessionVersion: 1,
  },
  redirect: vi.fn((url: string): never => {
    throw new Error(`TEST_REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: actionState.redirect }));
vi.mock("next/cache", () => ({
  revalidatePath: actionState.revalidatePath,
  updateTag: actionState.updateTag,
}));
vi.mock("@/lib/dal", () => ({
  assertCoordinator: vi.fn(async () => actionState.coordinator),
  incidentScopeWhere: vi.fn(
    (coordinator: { role: string; municipalityId: string | null }) =>
      coordinator.role === "SUPER_ADMIN"
        ? {}
        : { municipalityId: coordinator.municipalityId ?? "__none__" },
  ),
}));

import { createIncident, createNeed } from "@/actions/coordination";
import {
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  Priority,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getIncidentById } from "@/services/incidents";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const municipalityIds: string[] = [];
let municipalityAId = "";
let municipalityBId = "";
let municipalityBName = "";
let organizationAId = "";
let organizationAName = "";
let superAdminId = "";
let incidentAId = "";
let incidentBId = "";
let safePointAId = "";
let safePointBId = "";

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

function incidentForm(input: { title: string; municipalityId?: string }) {
  return formData({
    idempotencyKey: randomUUID(),
    municipalityId: input.municipalityId,
    title: input.title,
    type: IncidentType.OTHER,
    priority: Priority.HIGH,
    publicSummary:
      "Información pública de prueba sin datos operativos ni sensibles.",
    safetyNotice:
      "No acudir a la zona de riesgo; utilizar únicamente puntos seguros.",
    latitude: 41.5,
    longitude: 2.2,
    radiusMeters: 1500,
  });
}

function needForm(input: {
  incidentId: string;
  safePointId: string;
  title: string;
}) {
  return formData({
    idempotencyKey: randomUUID(),
    incidentId: input.incidentId,
    safePointId: input.safePointId,
    type: NeedType.OTHER,
    title: input.title,
    description: "Necesidad pública validada para comprobar el aislamiento.",
    priority: Priority.HIGH,
    quantityNeeded: 5,
    unit: "uds",
    deadline: "2099-01-01T12:00",
    deadlineOccurrence: "reject",
    publish: true,
  });
}

async function expectRedirect(action: Promise<unknown>) {
  try {
    await action;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TEST_REDIRECT:")) {
      return error.message.slice("TEST_REDIRECT:".length);
    }
    throw error;
  }
  throw new Error("La acción terminó sin redirigir.");
}

function redirectMessage(url: string, kind: "notice" | "error") {
  return new URL(url, "http://anella.test").searchParams.get(kind);
}

describe("explicit tenant context in creation actions", () => {
  beforeAll(async () => {
    const [municipalityA, municipalityB] = await Promise.all([
      prisma.municipality.create({
        data: { name: `TEST contexto creación A ${suffix}` },
      }),
      prisma.municipality.create({
        data: { name: `TEST contexto creación B ${suffix}` },
      }),
    ]);
    municipalityAId = municipalityA.id;
    municipalityBId = municipalityB.id;
    municipalityBName = municipalityB.name;
    municipalityIds.push(municipalityA.id, municipalityB.id);

    const [organizationA, organizationB] = await Promise.all([
      prisma.organization.create({
        data: {
          name: `TEST organización creación A ${suffix}`,
          municipalityId: municipalityA.id,
        },
      }),
      prisma.organization.create({
        data: {
          name: `TEST organización creación B ${suffix}`,
          municipalityId: municipalityB.id,
        },
      }),
    ]);
    organizationAId = organizationA.id;
    organizationAName = organizationA.name;

    const superAdmin = await prisma.user.create({
      data: {
        name: "Superadministración TEST contexto de creación",
        email: `super-creation-${suffix}@anella.test`,
        role: UserRole.SUPER_ADMIN,
        municipalityId: municipalityA.id,
        organizationId: organizationA.id,
        mustChangePassword: false,
      },
    });
    superAdminId = superAdmin.id;
    Object.assign(actionState.coordinator, {
      id: superAdmin.id,
      email: superAdmin.email,
      municipalityId: municipalityA.id,
      municipalityName: municipalityA.name,
      organizationId: organizationA.id,
      organizationName: organizationA.name,
    });

    const now = new Date();
    const [incidentA, incidentB] = await Promise.all([
      prisma.incident.create({
        data: {
          publicCode: `CTX-A-${suffix}`.slice(0, 32),
          title: `TEST incidente publicable A ${suffix}`,
          type: IncidentType.OTHER,
          status: IncidentStatus.ACTIVE,
          priority: Priority.HIGH,
          operationalLatitude: 41.5,
          operationalLongitude: 2.2,
          publicLocationLabel: municipalityA.name,
          publicLocationApprovedAt: now,
          publicLocationApprovedById: superAdmin.id,
          verifiedAt: now,
          verifiedById: superAdmin.id,
          createdById: superAdmin.id,
          municipalityId: municipalityA.id,
          organizationId: organizationA.id,
        },
      }),
      prisma.incident.create({
        data: {
          publicCode: `CTX-B-${suffix}`.slice(0, 32),
          title: `TEST incidente publicable B ${suffix}`,
          type: IncidentType.OTHER,
          status: IncidentStatus.ACTIVE,
          priority: Priority.HIGH,
          operationalLatitude: 42.1,
          operationalLongitude: 1.8,
          publicLocationLabel: municipalityB.name,
          publicLocationApprovedAt: now,
          publicLocationApprovedById: superAdmin.id,
          verifiedAt: now,
          verifiedById: superAdmin.id,
          createdById: superAdmin.id,
          municipalityId: municipalityB.id,
          organizationId: organizationB.id,
        },
      }),
    ]);
    incidentAId = incidentA.id;
    incidentBId = incidentB.id;

    const [safePointA, safePointB] = await Promise.all([
      prisma.safePoint.create({
        data: {
          incidentId: incidentA.id,
          municipalityId: municipalityA.id,
          name: `Punto seguro contexto A ${suffix}`,
          address: "Dirección segura A, 1",
          instructions: "Entrega únicamente al personal acreditado.",
          latitude: 41.51,
          longitude: 2.21,
          qrToken: `ctx-a-${suffix}`,
          isActive: true,
          pointStatus: "ACTIVE",
          publishedAt: now,
          validatedAt: now,
          validatedById: superAdmin.id,
        },
      }),
      prisma.safePoint.create({
        data: {
          incidentId: incidentB.id,
          municipalityId: municipalityB.id,
          name: `Punto seguro contexto B ${suffix}`,
          address: "Dirección segura B, 1",
          instructions: "Entrega únicamente al personal acreditado.",
          latitude: 42.11,
          longitude: 1.81,
          qrToken: `ctx-b-${suffix}`,
          isActive: true,
          pointStatus: "ACTIVE",
          publishedAt: now,
          validatedAt: now,
          validatedById: superAdmin.id,
        },
      }),
    ]);
    safePointAId = safePointA.id;
    safePointBId = safePointB.id;
  });

  afterAll(async () => {
    if (municipalityIds.length === 0) return;
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { municipalityId: { in: municipalityIds } },
          { actorId: superAdminId || "__none__" },
        ],
      },
    });
    await prisma.need.deleteMany({
      where: { incident: { municipalityId: { in: municipalityIds } } },
    });
    await prisma.safePoint.deleteMany({
      where: { municipalityId: { in: municipalityIds } },
    });
    await prisma.incident.deleteMany({
      where: { municipalityId: { in: municipalityIds } },
    });
    if (superAdminId) {
      await prisma.user.delete({ where: { id: superAdminId } });
    }
    await prisma.organization.deleteMany({
      where: { municipalityId: { in: municipalityIds } },
    });
    await prisma.municipality.deleteMany({
      where: { id: { in: municipalityIds } },
    });
  });

  it("requires an explicit municipality from a super admin direct action", async () => {
    const title = `TEST incidente sin contexto ${suffix}`;

    const url = await expectRedirect(createIncident(incidentForm({ title })));

    expect(redirectMessage(url, "error")).toContain(
      "Selecciona un municipio responsable",
    );
    await expect(prisma.incident.count({ where: { title } })).resolves.toBe(0);
  });

  it("preserves the actor organization when creating an incident in its tenant", async () => {
    const title = `TEST incidente creación tenant A ${suffix}`;

    const url = await expectRedirect(
      createIncident(incidentForm({ title, municipalityId: municipalityAId })),
    );

    expect(redirectMessage(url, "notice")).toContain(
      "Incidente creado como borrador",
    );
    const incident = await prisma.incident.findFirstOrThrow({
      where: { title },
    });
    expect(incident).toMatchObject({
      status: IncidentStatus.DRAFT,
      municipalityId: municipalityAId,
      organizationId: organizationAId,
      responsibleOrgName: organizationAName,
      createdById: superAdminId,
    });
  });

  it("does not inherit the actor organization in a cross-tenant incident", async () => {
    const title = `TEST incidente creación tenant B ${suffix}`;

    await expectRedirect(
      createIncident(incidentForm({ title, municipalityId: municipalityBId })),
    );

    const incident = await prisma.incident.findFirstOrThrow({
      where: { title },
    });
    expect(incident).toMatchObject({
      municipalityId: municipalityBId,
      organizationId: null,
      responsibleOrgName: municipalityBName,
      createdById: superAdminId,
    });
  });

  it("resolves the requester organization only inside the need tenant", async () => {
    const sameTenantTitle = `TEST necesidad tenant A ${suffix}`;
    const crossTenantTitle = `TEST necesidad tenant B ${suffix}`;

    await expectRedirect(
      createNeed(
        needForm({
          incidentId: incidentAId,
          safePointId: safePointAId,
          title: sameTenantTitle,
        }),
      ),
    );
    await expectRedirect(
      createNeed(
        needForm({
          incidentId: incidentBId,
          safePointId: safePointBId,
          title: crossTenantTitle,
        }),
      ),
    );

    const [sameTenantNeed, crossTenantNeed] = await Promise.all([
      prisma.need.findFirstOrThrow({
        where: { title: sameTenantTitle },
        include: { requestingOrganization: true },
      }),
      prisma.need.findFirstOrThrow({
        where: { title: crossTenantTitle },
        include: { requestingOrganization: true },
      }),
    ]);
    const [crossTenantAudit, publicIncident] = await Promise.all([
      prisma.auditLog.findFirstOrThrow({
        where: {
          action: "need.created",
          entityId: crossTenantNeed.id,
        },
      }),
      getIncidentById(incidentBId),
    ]);
    expect(sameTenantNeed).toMatchObject({
      incidentId: incidentAId,
      status: NeedStatus.ACTIVE,
      requestingOrganizationId: organizationAId,
      requestingOrganization: { id: organizationAId, name: organizationAName },
    });
    expect(crossTenantNeed).toMatchObject({
      incidentId: incidentBId,
      status: NeedStatus.ACTIVE,
      requestingOrganizationId: null,
      requestingOrganization: null,
    });
    expect(crossTenantAudit).toMatchObject({
      actorId: superAdminId,
      incidentId: incidentBId,
      municipalityId: municipalityBId,
      action: "need.created",
      entityId: crossTenantNeed.id,
    });
    expect(publicIncident).not.toBeNull();
    const publicNeed = publicIncident?.needs.find(
      (need) => need.id === crossTenantNeed.id,
    );
    expect(publicNeed).toBeDefined();
    expect(publicNeed?.requestingOrganizationName).toBeUndefined();
    expect(JSON.stringify(publicNeed)).not.toContain(organizationAName);
  });
});
