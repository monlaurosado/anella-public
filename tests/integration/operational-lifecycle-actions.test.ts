import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  coordinator: {
    id: "",
    name: "Coordinación TEST",
    email: "",
    role: "COORDINATOR" as const,
    municipalityId: "" as string | null,
    municipalityName: "Municipio TEST" as string | null,
    organizationId: "" as string | null,
    organizationName: "Organización TEST" as string | null,
    mustChangePassword: false,
    sessionVersion: 1,
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: actionMocks.updateTag,
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

import {
  createIncident,
  createNeed,
  createSafePoint,
  getContributionReassignmentTargets,
  reassignContribution,
  updateContributionStatus,
  updateIncidentDetails,
  updateIncidentStatus,
  updateNeed,
  updateNeedStatus,
  updatePublicLocation,
  updateSafePoint,
  toggleSafePoint,
} from "@/actions/coordination";
import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
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

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
let scenarioSequence = 0;
let contributionSequence = 0;
let municipalityId = "";
let organizationId = "";
let coordinatorId = "";
let previousVerifierId = "";

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

type ScenarioOptions = {
  incidentStatus?: IncidentStatus;
  publicLocationApproved?: boolean;
  safePointActive?: boolean;
  needStatus?: NeedStatus;
  quantityNeeded?: number;
  quantityReceived?: number;
  deadline?: Date;
};

async function createScenario(options: ScenarioOptions = {}) {
  scenarioSequence += 1;
  const incidentStatus = options.incidentStatus ?? IncidentStatus.ACTIVE;
  const needStatus = options.needStatus ?? NeedStatus.ACTIVE;
  const publicLocationApproved = options.publicLocationApproved ?? true;
  const verified =
    incidentStatus === IncidentStatus.ACTIVE ||
    incidentStatus === IncidentStatus.MONITORING;
  const now = new Date();

  const incident = await prisma.incident.create({
    data: {
      publicCode: `LIFE-${scenarioSequence}-${suffix}`.slice(0, 32),
      title: `TEST ciclo operativo ${scenarioSequence}`,
      type: IncidentType.OTHER,
      status: incidentStatus,
      priority: Priority.MEDIUM,
      operationalLatitude: 41.5,
      operationalLongitude: 2.2,
      publicLocationLabel: "Municipio TEST",
      publicLocationApprovedAt: publicLocationApproved ? now : null,
      publicLocationApprovedById: publicLocationApproved ? coordinatorId : null,
      verifiedAt: verified ? now : null,
      verifiedById: verified ? coordinatorId : null,
      createdById: coordinatorId,
      municipalityId,
      organizationId,
      timeZone: "Europe/Madrid",
    },
  });
  const safePoint = await prisma.safePoint.create({
    data: {
      incidentId: incident.id,
      municipalityId,
      name: `Punto seguro TEST ${scenarioSequence}`,
      address: "Dirección segura de pruebas",
      instructions: "Entrega únicamente al personal acreditado.",
      latitude: 41.51,
      longitude: 2.21,
      qrToken: `life-point-${scenarioSequence}-${suffix}`,
      isActive: options.safePointActive ?? true,
      pointStatus: (options.safePointActive ?? true) ? "ACTIVE" : "CLOSED",
      publishedAt: (options.safePointActive ?? true) ? now : null,
      validatedAt: (options.safePointActive ?? true) ? now : null,
      validatedById: (options.safePointActive ?? true) ? coordinatorId : null,
    },
  });
  const humanValidated =
    needStatus === NeedStatus.ACTIVE || needStatus === NeedStatus.COVERED;
  const need = await prisma.need.create({
    data: {
      incidentId: incident.id,
      safePointId: safePoint.id,
      type: NeedType.OTHER,
      title: `Necesidad TEST ${scenarioSequence}`,
      priority: Priority.HIGH,
      quantityNeeded: options.quantityNeeded ?? 10,
      quantityReceived: options.quantityReceived ?? 0,
      unit: "uds",
      deadline: options.deadline ?? new Date("2099-01-01T11:00:00.000Z"),
      status: needStatus,
      requestingOrganizationId: organizationId,
      requestedById: coordinatorId,
      validatedById: humanValidated ? coordinatorId : null,
      validatedAt: humanValidated ? now : null,
      publishedAt: humanValidated ? now : null,
    },
  });
  return { incident, safePoint, need };
}

async function createContribution(input: {
  needId: string;
  safePointId: string;
  quantity: number;
  deliveredQuantity?: number;
  status?: ContributionStatus;
}) {
  contributionSequence += 1;
  const need = await prisma.need.findUniqueOrThrow({
    where: { id: input.needId },
    select: { incidentId: true },
  });
  return prisma.contribution.create({
    data: {
      publicCode: `LC-${contributionSequence}-${suffix}`.slice(0, 20),
      incidentId: need.incidentId,
      needId: input.needId,
      safePointId: input.safePointId,
      citizenName: `Ciudadanía TEST ${contributionSequence}`,
      quantity: input.quantity,
      deliveredQuantity: input.deliveredQuantity ?? 0,
      status: input.status ?? ContributionStatus.PLEDGED,
      consentAt: new Date(),
    },
  });
}

describe("operational lifecycle through coordination actions", () => {
  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: `TEST ciclo ${suffix}` },
    });
    municipalityId = municipality.id;
    const organization = await prisma.organization.create({
      data: {
        name: `TEST organización ciclo ${suffix}`,
        municipalityId,
      },
    });
    organizationId = organization.id;
    const [coordinator, previousVerifier] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Coordinación TEST ciclo",
          email: `lifecycle-${suffix}@anella.test`,
          role: UserRole.COORDINATOR,
          municipalityId,
          organizationId,
        },
      }),
      prisma.user.create({
        data: {
          name: "Verificación histórica TEST ciclo",
          email: `previous-verifier-${suffix}@anella.test`,
          role: UserRole.COORDINATOR,
          municipalityId,
          organizationId,
        },
      }),
    ]);
    coordinatorId = coordinator.id;
    previousVerifierId = previousVerifier.id;
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
    await prisma.incident.deleteMany({ where: { municipalityId } });
    await prisma.user.deleteMany({
      where: { id: { in: [coordinatorId, previousVerifierId] } },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.municipality.deleteMany({ where: { id: municipalityId } });
  });

  it("requires human public-location approval before activation and audits both decisions", async () => {
    const { incident } = await createScenario({
      incidentStatus: IncidentStatus.PENDING_VALIDATION,
      publicLocationApproved: false,
      needStatus: NeedStatus.DRAFT,
    });
    actionMocks.updateTag.mockClear();

    const blockedUrl = await expectRedirect(
      updateIncidentStatus(
        formData({ incidentId: incident.id, status: IncidentStatus.ACTIVE }),
      ),
    );
    expect(redirectMessage(blockedUrl, "error")).toContain(
      "Revisa y aprueba primero la ubicación",
    );
    await expect(
      prisma.incident.findUniqueOrThrow({ where: { id: incident.id } }),
    ).resolves.toMatchObject({ status: IncidentStatus.PENDING_VALIDATION });
    expect(actionMocks.updateTag).not.toHaveBeenCalled();

    const approvalUrl = await expectRedirect(
      updatePublicLocation(
        formData({
          incidentId: incident.id,
          expectedUpdatedAt: incident.updatedAt.toISOString(),
          mode: "MUNICIPALITY_ONLY",
          label: "Municipio TEST — área no operativa",
          reason: "Revisión humana del área pública no operativa",
          confirmPublicSafety: true,
        }),
      ),
    );
    expect(redirectMessage(approvalUrl, "notice")).toContain(
      "Ubicación pública revisada",
    );
    expect(actionMocks.updateTag).toHaveBeenLastCalledWith(
      PUBLIC_INCIDENTS_CACHE_TAG,
    );
    expect(actionMocks.updateTag).toHaveBeenCalledTimes(1);

    const activationUrl = await expectRedirect(
      updateIncidentStatus(
        formData({ incidentId: incident.id, status: IncidentStatus.ACTIVE }),
      ),
    );
    expect(redirectMessage(activationUrl, "notice")).toContain(
      "Estado del incidente actualizado",
    );
    expect(actionMocks.updateTag).toHaveBeenLastCalledWith(
      PUBLIC_INCIDENTS_CACHE_TAG,
    );
    expect(actionMocks.updateTag).toHaveBeenCalledTimes(2);

    const [updated, audits] = await Promise.all([
      prisma.incident.findUniqueOrThrow({ where: { id: incident.id } }),
      prisma.auditLog.findMany({
        where: { incidentId: incident.id },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    expect(updated).toMatchObject({
      status: IncidentStatus.ACTIVE,
      verifiedById: coordinatorId,
      publicLocationApprovedById: coordinatorId,
    });
    expect(updated.verifiedAt).toBeInstanceOf(Date);
    expect(audits.map((audit) => audit.action)).toEqual([
      "incident.public_location_approved",
      "incident.status_changed",
    ]);
    expect(audits.every((audit) => audit.actorId === coordinatorId)).toBe(true);
    expect(audits[1]?.metadata).toEqual(
      expect.objectContaining({
        from: IncidentStatus.PENDING_VALIDATION,
        to: IncidentStatus.ACTIVE,
      }),
    );
  });

  it("renews human verification when public incident content changes", async () => {
    const { incident } = await createScenario();
    const previousVerifiedAt = new Date("2025-01-02T03:04:05.000Z");
    const prepared = await prisma.incident.update({
      where: { id: incident.id },
      data: {
        verifiedById: previousVerifierId,
        verifiedAt: previousVerifiedAt,
      },
    });
    const verificationStartedAt = Date.now();
    actionMocks.updateTag.mockClear();

    const url = await expectRedirect(
      updateIncidentDetails(
        formData({
          incidentId: incident.id,
          expectedUpdatedAt: prepared.updatedAt.toISOString(),
          title: `TEST ficha pública renovada ${scenarioSequence}`,
          type: IncidentType.OTHER,
          priority: Priority.CRITICAL,
          publicSummary:
            "Resumen público revisado por coordinación para esta regresión.",
          safetyNotice:
            "No acudir a la zona de riesgo; utilizar solo puntos seguros.",
          latitude: 41.55,
          longitude: 2.25,
          radiusMeters: 1800,
          reason: "Actualización humana del contenido público del incidente",
        }),
      ),
    );

    expect(redirectMessage(url, "notice")).toContain(
      "Datos operativos y públicos actualizados",
    );
    expect(actionMocks.updateTag).toHaveBeenLastCalledWith(
      PUBLIC_INCIDENTS_CACHE_TAG,
    );
    const [updated, audit] = await Promise.all([
      prisma.incident.findUniqueOrThrow({ where: { id: incident.id } }),
      prisma.auditLog.findFirstOrThrow({
        where: {
          incidentId: incident.id,
          action: "incident.updated",
        },
      }),
    ]);
    expect(updated).toMatchObject({
      title: `TEST ficha pública renovada ${scenarioSequence}`,
      priority: Priority.CRITICAL,
      verifiedById: coordinatorId,
    });
    expect(updated.verifiedAt).toBeInstanceOf(Date);
    expect(updated.verifiedAt!.getTime()).toBeGreaterThanOrEqual(
      verificationStartedAt,
    );
    expect(audit).toMatchObject({
      actorId: coordinatorId,
      municipalityId,
      entityId: incident.id,
    });
    expect(audit.metadata).toEqual(
      expect.objectContaining({
        reason: "Actualización humana del contenido público del incidente",
        humanVerification: {
          before: {
            actorId: previousVerifierId,
            verifiedAt: previousVerifiedAt.toISOString(),
          },
          after: {
            actorId: coordinatorId,
            verifiedAt: updated.verifiedAt!.toISOString(),
          },
        },
      }),
    );
  });

  it("reopens resolved incidents only into private revalidation", async () => {
    const { incident } = await createScenario({
      incidentStatus: IncidentStatus.RESOLVED,
      needStatus: NeedStatus.COVERED,
    });
    await prisma.incident.update({
      where: { id: incident.id },
      data: {
        verifiedAt: new Date(),
        verifiedById: coordinatorId,
        publicLocationApprovedAt: new Date(),
        publicLocationApprovedById: coordinatorId,
        closedAt: new Date(),
        closedReason: "Cierre previo de pruebas",
      },
    });

    const reopenedUrl = await expectRedirect(
      updateIncidentStatus(
        formData({
          incidentId: incident.id,
          status: IncidentStatus.PENDING_VALIDATION,
          reason: "Reapertura revisada por nueva información municipal",
          confirmStatusChange: true,
        }),
      ),
    );
    expect(redirectMessage(reopenedUrl, "notice")).toContain(
      "Estado del incidente actualizado",
    );
    await expect(
      prisma.incident.findUniqueOrThrow({ where: { id: incident.id } }),
    ).resolves.toMatchObject({
      status: IncidentStatus.PENDING_VALIDATION,
      verifiedAt: null,
      verifiedById: null,
      publicLocationApprovedAt: null,
      publicLocationApprovedById: null,
      closedAt: null,
      closedReason: null,
    });
  });

  it("blocks operational contribution states when the destination is invalid", async () => {
    const { incident, safePoint, need } = await createScenario();
    const contribution = await createContribution({
      needId: need.id,
      safePointId: safePoint.id,
      quantity: 2,
    });
    await prisma.safePoint.update({
      where: { id: safePoint.id },
      data: { isActive: false, validatedAt: null, validatedById: null },
    });

    const result = await updateContributionStatus(
      { ok: false, message: "" },
      formData({
        incidentId: incident.id,
        contributionId: contribution.id,
        revision: contribution.revision,
        status: ContributionStatus.DELIVERED,
        deliveredQuantity: contribution.quantity,
      }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("punto de entrega");
    await expect(
      prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } }),
    ).resolves.toMatchObject({
      status: ContributionStatus.PLEDGED,
      deliveredQuantity: 0,
      revision: contribution.revision,
    });
  });

  it("rejects missing or mismatched destinations at the database boundary", async () => {
    const { incident, safePoint, need } = await createScenario();
    const alternatePoint = await prisma.safePoint.create({
      data: {
        incidentId: incident.id,
        municipalityId,
        name: `Punto alternativo TEST ${scenarioSequence}`,
        address: "Otra dirección segura de pruebas",
        latitude: 41.52,
        longitude: 2.22,
        qrToken: `life-point-alternate-${scenarioSequence}-${suffix}`,
        isActive: true,
        validatedAt: new Date(),
        validatedById: coordinatorId,
      },
    });
    contributionSequence += 1;
    const now = new Date();
    const insert = (id: string, code: string, safePointId: string | null) =>
      prisma.$executeRaw`
        INSERT INTO Contribution (
          id, publicCode, needId, safePointId, citizenName, quantity,
          consentAt, createdAt, updatedAt
        ) VALUES (
          ${id}, ${code}, ${need.id}, ${safePointId}, 'Ciudadanía TEST', 2,
          ${now}, ${now}, ${now}
        )
      `;

    await expect(
      insert(
        `missing-destination-${contributionSequence}-${suffix}`,
        `LM-${contributionSequence}-${suffix}`.slice(0, 20),
        null,
      ),
    ).rejects.toThrow();
    await expect(
      insert(
        `mismatched-destination-${contributionSequence}-${suffix}`,
        `LX-${contributionSequence}-${suffix}`.slice(0, 20),
        alternatePoint.id,
      ),
    ).rejects.toThrow();

    await expect(
      prisma.contribution.count({ where: { needId: need.id } }),
    ).resolves.toBe(0);
    expect(safePoint.id).toBe(need.safePointId);
  });

  it("loads compatible destinations on demand and audits reassignment", async () => {
    const { incident, safePoint, need } = await createScenario({
      quantityNeeded: 10,
    });
    const targetNeed = await prisma.need.create({
      data: {
        incidentId: incident.id,
        safePointId: safePoint.id,
        type: need.type,
        title: `Necesidad destino TEST ${scenarioSequence}`,
        priority: Priority.HIGH,
        quantityNeeded: 6,
        quantityReceived: 0,
        unit: need.unit,
        deadline: new Date("2099-01-01T12:00:00.000Z"),
        status: NeedStatus.ACTIVE,
        requestingOrganizationId: organizationId,
        requestedById: coordinatorId,
        validatedById: coordinatorId,
        validatedAt: new Date(),
        publishedAt: new Date(),
      },
    });
    const contribution = await createContribution({
      needId: need.id,
      safePointId: safePoint.id,
      quantity: 2,
    });

    const targets = await getContributionReassignmentTargets(
      incident.id,
      contribution.id,
    );
    expect(targets).toMatchObject({
      ok: true,
      targets: [
        {
          id: targetNeed.id,
          remaining: 6,
          unit: need.unit,
        },
      ],
    });

    const result = await reassignContribution(
      { ok: false, message: "" },
      formData({
        incidentId: incident.id,
        contributionId: contribution.id,
        targetNeedId: targetNeed.id,
        revision: contribution.revision,
        reason: "Destino compatible verificado por coordinación",
        confirmReassignment: true,
      }),
    );
    expect(result).toMatchObject({ ok: true, revision: 2 });
    await expect(
      prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } }),
    ).resolves.toMatchObject({
      needId: targetNeed.id,
      safePointId: safePoint.id,
      revision: 2,
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: "contribution.reassigned",
          entityId: contribution.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("blocks destination edits while a delivery is outstanding", async () => {
    const { incident, safePoint, need } = await createScenario();
    await createContribution({
      needId: need.id,
      safePointId: safePoint.id,
      quantity: 2,
      status: ContributionStatus.EN_ROUTE,
    });

    const blockedUrl = await expectRedirect(
      updateSafePoint(
        formData({
          incidentId: incident.id,
          safePointId: safePoint.id,
          expectedUpdatedAt: safePoint.updatedAt.toISOString(),
          name: safePoint.name,
          address: "Otra dirección segura de pruebas",
          instructions: safePoint.instructions ?? "Entrega acreditada",
          latitude: Number(safePoint.latitude),
          longitude: Number(safePoint.longitude),
          reason: "Cambio revisado de destino durante las pruebas",
          confirmSafePointUpdate: true,
        }),
      ),
    );
    expect(redirectMessage(blockedUrl, "error")).toContain(
      "entregas pendientes",
    );
    await expect(
      prisma.safePoint.findUniqueOrThrow({ where: { id: safePoint.id } }),
    ).resolves.toMatchObject({ address: safePoint.address });
  });

  it("runs creation, publication, monitoring and cancellation through audited actions", async () => {
    const title = `TEST flujo completo ${suffix}`;
    const creationUrl = await expectRedirect(
      createIncident(
        formData({
          idempotencyKey: "00000000-0000-4000-8000-000000000911",
          title,
          type: IncidentType.OTHER,
          priority: Priority.HIGH,
          publicSummary:
            "Información pública de simulacro validable sin datos operativos.",
          safetyNotice:
            "No acudir a la zona de intervención; usar solo puntos seguros.",
          latitude: 41.5,
          longitude: 2.2,
          radiusMeters: 1500,
        }),
      ),
    );
    const incidentId = creationUrl.match(
      /\/coordinacion\/incidentes\/([^?]+)/,
    )?.[1];
    expect(incidentId).toBeTruthy();
    const created = await prisma.incident.findUniqueOrThrow({
      where: { id: incidentId! },
    });
    expect(created.status).toBe(IncidentStatus.DRAFT);

    await expectRedirect(
      createSafePoint(
        formData({
          idempotencyKey: "00000000-0000-4000-8000-000000000912",
          incidentId: created.id,
          name: `Punto seguro flujo ${suffix}`,
          address: "Dirección segura del flujo, 1",
          instructions: "Entregar solo al equipo acreditado del punto.",
          latitude: 41.51,
          longitude: 2.21,
          radiusMeters: 30,
          capacityNote: "Capacidad revisada",
          confirmSafePointSafety: true,
        }),
      ),
    );
    const safePoint = await prisma.safePoint.findFirstOrThrow({
      where: { incidentId: created.id },
      orderBy: { createdAt: "desc" },
    });
    expect(safePoint).toMatchObject({
      isActive: true,
      validatedById: coordinatorId,
    });
    expect(safePoint.validatedAt).toBeInstanceOf(Date);

    const afterPoint = await prisma.incident.findUniqueOrThrow({
      where: { id: created.id },
    });
    await expectRedirect(
      updatePublicLocation(
        formData({
          incidentId: created.id,
          expectedUpdatedAt: afterPoint.updatedAt.toISOString(),
          mode: "MUNICIPALITY_ONLY",
          label: "Municipio TEST — publicación segura",
          reason: "Revisión humana de la representación pública del incidente",
          confirmPublicSafety: true,
        }),
      ),
    );
    await expectRedirect(
      updateIncidentStatus(
        formData({
          incidentId: created.id,
          status: IncidentStatus.PENDING_VALIDATION,
        }),
      ),
    );
    await expectRedirect(
      updateIncidentStatus(
        formData({ incidentId: created.id, status: IncidentStatus.ACTIVE }),
      ),
    );

    await expectRedirect(
      createNeed(
        formData({
          idempotencyKey: "00000000-0000-4000-8000-000000000913",
          incidentId: created.id,
          safePointId: safePoint.id,
          type: NeedType.OTHER,
          title: `Necesidad publicada flujo ${suffix}`,
          description: "Solicitud pública validada para el flujo integral.",
          priority: Priority.HIGH,
          quantityNeeded: 5,
          unit: "uds",
          deadline: "2099-01-01T12:00",
          deadlineOccurrence: "reject",
          publish: true,
        }),
      ),
    );
    const need = await prisma.need.findFirstOrThrow({
      where: { incidentId: created.id },
      orderBy: { createdAt: "desc" },
    });
    expect(need).toMatchObject({
      status: NeedStatus.ACTIVE,
      validatedById: coordinatorId,
    });

    await expectRedirect(
      updateIncidentStatus(
        formData({ incidentId: created.id, status: IncidentStatus.MONITORING }),
      ),
    );
    const blockedCancellation = await expectRedirect(
      updateIncidentStatus(
        formData({
          incidentId: created.id,
          status: IncidentStatus.CANCELLED,
          reason: "Cancelación operativa revisada durante el simulacro",
          confirmStatusChange: true,
        }),
      ),
    );
    expect(redirectMessage(blockedCancellation, "error")).toContain(
      "necesidades",
    );

    await expectRedirect(
      updateNeedStatus(
        formData({
          incidentId: created.id,
          needId: need.id,
          status: NeedStatus.CANCELLED,
          reason: "Solicitud retirada tras una revisión humana del simulacro",
          confirmNeedStatusChange: true,
        }),
      ),
    );
    await expectRedirect(
      updateIncidentStatus(
        formData({
          incidentId: created.id,
          status: IncidentStatus.CANCELLED,
          reason: "Cancelación operativa revisada durante el simulacro",
          confirmStatusChange: true,
        }),
      ),
    );

    const [finished, audits] = await Promise.all([
      prisma.incident.findUniqueOrThrow({ where: { id: created.id } }),
      prisma.auditLog.findMany({
        where: { incidentId: created.id },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    expect(finished).toMatchObject({
      status: IncidentStatus.CANCELLED,
      closedReason: "Cancelación operativa revisada durante el simulacro",
    });
    expect(finished.closedAt).toBeInstanceOf(Date);
    expect(audits.map((audit) => audit.action)).toEqual([
      "incident.created",
      "safe_point.created_and_validated",
      "incident.public_location_approved",
      "incident.status_changed",
      "incident.status_changed",
      "need.created",
      "incident.status_changed",
      "need.status_changed",
      "incident.status_changed",
    ]);
  });

  it("blocks closure and safe-point deactivation until pending work is resolved", async () => {
    const { incident, safePoint, need } = await createScenario();
    const contribution = await createContribution({
      needId: need.id,
      safePointId: safePoint.id,
      quantity: 4,
    });

    const closeBlockedUrl = await expectRedirect(
      updateIncidentStatus(
        formData({
          incidentId: incident.id,
          status: IncidentStatus.RESOLVED,
          reason: "Simulacro finalizado de forma verificada",
          confirmStatusChange: true,
        }),
      ),
    );
    expect(redirectMessage(closeBlockedUrl, "error")).toContain(
      "entregas pendientes",
    );

    const pointBlockedUrl = await expectRedirect(
      toggleSafePoint(
        formData({
          incidentId: incident.id,
          safePointId: safePoint.id,
          safePointAction: "deactivate",
          reason: "Revisión preventiva del punto seguro",
          confirmSafePointChange: true,
        }),
      ),
    );
    expect(redirectMessage(pointBlockedUrl, "error")).toContain(
      "necesidades activas",
    );

    const cancelledContribution = await updateContributionStatus(
      { ok: false, message: "" },
      formData({
        incidentId: incident.id,
        contributionId: contribution.id,
        revision: contribution.revision,
        status: ContributionStatus.CANCELLED,
        reason: "La persona confirma que no puede realizar la entrega",
        confirmContributionStatus: true,
      }),
    );
    expect(cancelledContribution).toMatchObject({ ok: true, revision: 2 });

    const needUrl = await expectRedirect(
      updateNeedStatus(
        formData({
          incidentId: incident.id,
          needId: need.id,
          status: NeedStatus.CANCELLED,
          reason: "Necesidad retirada tras revisión de coordinación",
          confirmNeedStatusChange: true,
        }),
      ),
    );
    expect(redirectMessage(needUrl, "notice")).toContain(
      "Estado de la necesidad actualizado",
    );

    const pointUrl = await expectRedirect(
      toggleSafePoint(
        formData({
          incidentId: incident.id,
          safePointId: safePoint.id,
          safePointAction: "deactivate",
          reason: "Punto desactivado al finalizar la operativa",
          confirmSafePointChange: true,
        }),
      ),
    );
    expect(redirectMessage(pointUrl, "notice")).toContain(
      "Estado del punto de entrega actualizado",
    );

    const closeUrl = await expectRedirect(
      updateIncidentStatus(
        formData({
          incidentId: incident.id,
          status: IncidentStatus.RESOLVED,
          reason: "Simulacro finalizado de forma verificada",
          confirmStatusChange: true,
        }),
      ),
    );
    expect(redirectMessage(closeUrl, "notice")).toContain(
      "Estado del incidente actualizado",
    );

    const [updatedIncident, updatedPoint, updatedNeed, updatedContribution] =
      await Promise.all([
        prisma.incident.findUniqueOrThrow({ where: { id: incident.id } }),
        prisma.safePoint.findUniqueOrThrow({ where: { id: safePoint.id } }),
        prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
        prisma.contribution.findUniqueOrThrow({
          where: { id: contribution.id },
        }),
      ]);
    expect(updatedIncident).toMatchObject({
      status: IncidentStatus.RESOLVED,
      closedReason: "Simulacro finalizado de forma verificada",
    });
    expect(updatedIncident.closedAt).toBeInstanceOf(Date);
    expect(updatedPoint).toMatchObject({
      isActive: false,
      deactivationReason: "Punto desactivado al finalizar la operativa",
    });
    expect(updatedNeed).toMatchObject({ status: NeedStatus.CANCELLED });
    expect(updatedContribution).toMatchObject({
      status: ContributionStatus.CANCELLED,
      deliveredQuantity: 0,
      revision: 2,
    });

    const audits = await prisma.auditLog.findMany({
      where: { incidentId: incident.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      "contribution.status_changed",
      "need.status_changed",
      "safe_point.deactivated",
      "incident.status_changed",
    ]);
    expect(audits.every((audit) => audit.actorId === coordinatorId)).toBe(true);
    expect(
      audits.find((audit) => audit.action === "incident.status_changed")
        ?.metadata,
    ).toEqual(
      expect.objectContaining({
        from: IncidentStatus.ACTIVE,
        to: IncidentStatus.RESOLVED,
        reason: "Simulacro finalizado de forma verificada",
      }),
    );
  });

  it.each([
    {
      label: ContributionStatus.PLEDGED,
      status: ContributionStatus.PLEDGED,
      deliveredQuantity: 0,
    },
    {
      label: ContributionStatus.EN_ROUTE,
      status: ContributionStatus.EN_ROUTE,
      deliveredQuantity: 0,
    },
    {
      label: ContributionStatus.PARTIALLY_DELIVERED,
      status: ContributionStatus.PARTIALLY_DELIVERED,
      deliveredQuantity: 1,
    },
  ])(
    "uses $label as the only blocker for need, safe-point and incident closure",
    async ({ status, deliveredQuantity }) => {
      const { incident, safePoint, need } = await createScenario({
        quantityNeeded: 10,
        quantityReceived: deliveredQuantity,
      });
      const contribution = await createContribution({
        needId: need.id,
        safePointId: safePoint.id,
        quantity: 4,
        deliveredQuantity,
        status,
      });
      actionMocks.updateTag.mockClear();

      const needBlockedUrl = await expectRedirect(
        updateNeedStatus(
          formData({
            incidentId: incident.id,
            needId: need.id,
            status: NeedStatus.CANCELLED,
            reason: "Necesidad retirada tras revisión de coordinación",
            confirmNeedStatusChange: true,
          }),
        ),
      );
      expect(redirectMessage(needBlockedUrl, "error")).toBe(
        "Quedan 1 aportaciones pendientes. Cancélalas, reasígnalas o complétalas primero.",
      );

      await prisma.need.update({
        where: { id: need.id },
        data: {
          status: NeedStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: "Preparación aislada del escenario de cierre",
        },
      });

      const pointBlockedUrl = await expectRedirect(
        toggleSafePoint(
          formData({
            incidentId: incident.id,
            safePointId: safePoint.id,
            safePointAction: "deactivate",
            reason: "Revisión preventiva del punto seguro",
            confirmSafePointChange: true,
          }),
        ),
      );
      expect(redirectMessage(pointBlockedUrl, "error")).toBe(
        "No se puede desactivar: 0 necesidades activas y 1 entregas pendientes dependen del punto.",
      );

      for (const closingStatus of [
        IncidentStatus.RESOLVED,
        IncidentStatus.CANCELLED,
      ]) {
        const incidentBlockedUrl = await expectRedirect(
          updateIncidentStatus(
            formData({
              incidentId: incident.id,
              status: closingStatus,
              reason: "Cierre operativo revisado por coordinación",
              confirmStatusChange: true,
            }),
          ),
        );
        expect(redirectMessage(incidentBlockedUrl, "error")).toBe(
          "No se puede cerrar: quedan 1 entregas pendientes. Cancélalas, reasígnalas o complétalas primero.",
        );
      }

      const [updatedIncident, updatedPoint, updatedNeed, updatedContribution] =
        await Promise.all([
          prisma.incident.findUniqueOrThrow({ where: { id: incident.id } }),
          prisma.safePoint.findUniqueOrThrow({ where: { id: safePoint.id } }),
          prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
          prisma.contribution.findUniqueOrThrow({
            where: { id: contribution.id },
          }),
        ]);
      expect(updatedIncident.status).toBe(IncidentStatus.ACTIVE);
      expect(updatedPoint.isActive).toBe(true);
      expect(updatedNeed.status).toBe(NeedStatus.CANCELLED);
      expect(updatedContribution).toMatchObject({
        status,
        deliveredQuantity,
        revision: 1,
      });
      await expect(
        prisma.auditLog.count({
          where: {
            incidentId: incident.id,
            action: {
              in: [
                "incident.status_changed",
                "need.status_changed",
                "safe_point.deactivated",
              ],
            },
          },
        }),
      ).resolves.toBe(0);
      expect(actionMocks.updateTag).not.toHaveBeenCalled();
    },
  );

  it("rejects direct cross-tenant incident, need and safe-point mutations without side effects", async () => {
    const foreign = await prisma.$transaction(async (transaction) => {
      const municipality = await transaction.municipality.create({
        data: { name: `TEST ciclo ajeno ${suffix}` },
      });
      const now = new Date();
      const incident = await transaction.incident.create({
        data: {
          publicCode: `FOREIGN-LIFE-${suffix}`.slice(0, 32),
          title: "TEST incidente de otro municipio",
          type: IncidentType.OTHER,
          status: IncidentStatus.ACTIVE,
          priority: Priority.MEDIUM,
          operationalLatitude: 42.1,
          operationalLongitude: 1.8,
          publicLocationLabel: municipality.name,
          publicLocationApprovedAt: now,
          publicLocationApprovedById: coordinatorId,
          verifiedAt: now,
          verifiedById: coordinatorId,
          createdById: coordinatorId,
          municipalityId: municipality.id,
          timeZone: "Europe/Madrid",
        },
      });
      const safePoint = await transaction.safePoint.create({
        data: {
          incidentId: incident.id,
          municipalityId: municipality.id,
          name: "Punto seguro ajeno",
          address: "Dirección segura ajena, 1",
          instructions: "Entrega al personal acreditado del municipio ajeno.",
          latitude: 42.11,
          longitude: 1.81,
          capacityNote: "Capacidad original",
          qrToken: `foreign-life-${suffix}`,
          isActive: true,
          validatedAt: now,
          validatedById: coordinatorId,
        },
      });
      const need = await transaction.need.create({
        data: {
          incidentId: incident.id,
          safePointId: safePoint.id,
          type: NeedType.OTHER,
          title: "Necesidad del municipio ajeno",
          priority: Priority.HIGH,
          quantityNeeded: 10,
          unit: "uds",
          deadline: new Date("2099-01-01T11:00:00.000Z"),
          status: NeedStatus.ACTIVE,
          requestedById: coordinatorId,
          validatedById: coordinatorId,
          validatedAt: now,
          publishedAt: now,
        },
      });
      return { municipality, incident, safePoint, need };
    });

    try {
      const [incidentBefore, needBefore, safePointBefore] = await Promise.all([
        prisma.incident.findUniqueOrThrow({
          where: { id: foreign.incident.id },
          select: { status: true, updatedAt: true },
        }),
        prisma.need.findUniqueOrThrow({
          where: { id: foreign.need.id },
          select: {
            deadline: true,
            quantityNeeded: true,
            status: true,
            updatedAt: true,
          },
        }),
        prisma.safePoint.findUniqueOrThrow({
          where: { id: foreign.safePoint.id },
          select: {
            capacityNote: true,
            updatedAt: true,
            validatedAt: true,
            validatedById: true,
          },
        }),
      ]);
      actionMocks.updateTag.mockClear();

      const incidentUrl = await expectRedirect(
        updateIncidentStatus(
          formData({
            incidentId: foreign.incident.id,
            status: IncidentStatus.MONITORING,
          }),
        ),
      );
      expect(redirectMessage(incidentUrl, "error")).toBe(
        "Incidente no encontrado.",
      );

      const needUrl = await expectRedirect(
        updateNeed(
          formData({
            incidentId: foreign.incident.id,
            needId: foreign.need.id,
            quantityNeeded: 11,
            deadline: "2099-01-02T12:00",
            reason: "Intento directo desde otro municipio",
            confirmNeedUpdate: true,
          }),
        ),
      );
      expect(redirectMessage(needUrl, "error")).toBe(
        "Necesidad no encontrada.",
      );

      const safePointUrl = await expectRedirect(
        updateSafePoint(
          formData({
            incidentId: foreign.incident.id,
            safePointId: foreign.safePoint.id,
            name: foreign.safePoint.name,
            address: foreign.safePoint.address ?? "Dirección segura ajena, 1",
            instructions:
              foreign.safePoint.instructions ??
              "Entrega al personal acreditado del municipio ajeno.",
            latitude: Number(foreign.safePoint.latitude),
            longitude: Number(foreign.safePoint.longitude),
            capacityNote: "Capacidad manipulada",
            expectedUpdatedAt: foreign.safePoint.updatedAt.toISOString(),
            reason: "Intento directo desde otro municipio",
            confirmSafePointUpdate: true,
          }),
        ),
      );
      expect(redirectMessage(safePointUrl, "error")).toBe(
        "Punto de entrega no encontrado.",
      );

      const [incidentAfter, needAfter, safePointAfter, auditCount] =
        await Promise.all([
          prisma.incident.findUniqueOrThrow({
            where: { id: foreign.incident.id },
            select: { status: true, updatedAt: true },
          }),
          prisma.need.findUniqueOrThrow({
            where: { id: foreign.need.id },
            select: {
              deadline: true,
              quantityNeeded: true,
              status: true,
              updatedAt: true,
            },
          }),
          prisma.safePoint.findUniqueOrThrow({
            where: { id: foreign.safePoint.id },
            select: {
              capacityNote: true,
              updatedAt: true,
              validatedAt: true,
              validatedById: true,
            },
          }),
          prisma.auditLog.count({
            where: { incidentId: foreign.incident.id },
          }),
        ]);
      expect(incidentAfter).toEqual(incidentBefore);
      expect(needAfter).toEqual(needBefore);
      expect(safePointAfter).toEqual(safePointBefore);
      expect(auditCount).toBe(0);
      expect(actionMocks.updateTag).not.toHaveBeenCalled();
    } finally {
      await prisma.auditLog.deleteMany({
        where: { incidentId: foreign.incident.id },
      });
      await prisma.incident.delete({ where: { id: foreign.incident.id } });
      await prisma.municipality.delete({
        where: { id: foreign.municipality.id },
      });
    }
  });

  it("keeps partial receipts and revisions monotonic and covers only at the exact total", async () => {
    const { incident, safePoint, need } = await createScenario({
      quantityNeeded: 10,
    });
    const first = await createContribution({
      needId: need.id,
      safePointId: safePoint.id,
      quantity: 8,
    });
    const second = await createContribution({
      needId: need.id,
      safePointId: safePoint.id,
      quantity: 2,
    });

    const partial = await updateContributionStatus(
      { ok: false, message: "" },
      formData({
        incidentId: incident.id,
        contributionId: first.id,
        revision: 1,
        status: ContributionStatus.PARTIALLY_DELIVERED,
        deliveredQuantity: 3,
      }),
    );
    expect(partial).toMatchObject({ ok: true, revision: 2 });

    const stale = await updateContributionStatus(
      partial,
      formData({
        incidentId: incident.id,
        contributionId: first.id,
        revision: 1,
        status: ContributionStatus.PARTIALLY_DELIVERED,
        deliveredQuantity: 4,
      }),
    );
    expect(stale).toMatchObject({ ok: false });
    expect(stale.message).toContain("datos han cambiado");

    const decrement = await updateContributionStatus(
      partial,
      formData({
        incidentId: incident.id,
        contributionId: first.id,
        revision: 2,
        status: ContributionStatus.PARTIALLY_DELIVERED,
        deliveredQuantity: 2,
      }),
    );
    expect(decrement).toMatchObject({ ok: false });
    expect(decrement.message).toContain("debe superar 3");

    const regression = await updateContributionStatus(
      partial,
      formData({
        incidentId: incident.id,
        contributionId: first.id,
        revision: 2,
        status: ContributionStatus.EN_ROUTE,
      }),
    );
    expect(regression).toMatchObject({ ok: false });
    expect(regression.message).toContain("retrocede");

    const firstDelivered = await updateContributionStatus(
      partial,
      formData({
        incidentId: incident.id,
        contributionId: first.id,
        revision: 2,
        status: ContributionStatus.DELIVERED,
      }),
    );
    expect(firstDelivered).toMatchObject({ ok: true, revision: 3 });
    await expect(
      prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
    ).resolves.toMatchObject({
      quantityReceived: 8,
      status: NeedStatus.ACTIVE,
    });

    const secondDelivered = await updateContributionStatus(
      { ok: false, message: "" },
      formData({
        incidentId: incident.id,
        contributionId: second.id,
        revision: 1,
        status: ContributionStatus.DELIVERED,
      }),
    );
    expect(secondDelivered).toMatchObject({ ok: true, revision: 2 });

    const terminalMutation = await updateContributionStatus(
      firstDelivered,
      formData({
        incidentId: incident.id,
        contributionId: first.id,
        revision: 3,
        status: ContributionStatus.CANCELLED,
        reason: "Intento de alterar una entrega ya cerrada",
        confirmContributionStatus: true,
      }),
    );
    expect(terminalMutation).toMatchObject({ ok: false });
    expect(terminalMutation.message).toContain("estado ya finalizado");

    const [updatedNeed, updatedFirst, audits] = await Promise.all([
      prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
      prisma.contribution.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.auditLog.findMany({
        where: {
          incidentId: incident.id,
          action: "contribution.status_changed",
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    expect(updatedNeed).toMatchObject({
      quantityReceived: 10,
      status: NeedStatus.COVERED,
    });
    expect(updatedFirst).toMatchObject({
      status: ContributionStatus.DELIVERED,
      deliveredQuantity: 8,
      revision: 3,
    });
    expect(audits).toHaveLength(3);
    expect(audits[0]?.metadata).toEqual(
      expect.objectContaining({
        deliveredBefore: 0,
        deliveredAfter: 3,
        revisionBefore: 1,
      }),
    );
    expect(audits[2]?.metadata).toEqual(
      expect.objectContaining({ needStatus: NeedStatus.COVERED }),
    );
  });

  it("reopens covered needs only with complete human validation provenance", async () => {
    const valid = await createScenario({
      needStatus: NeedStatus.COVERED,
      quantityNeeded: 10,
      quantityReceived: 10,
    });
    const missingValidator = await createScenario({
      needStatus: NeedStatus.COVERED,
      quantityNeeded: 10,
      quantityReceived: 10,
    });
    const incompleteNeed = await prisma.need.update({
      where: { id: missingValidator.need.id },
      data: { validatedById: null },
    });
    expect(incompleteNeed.validatedAt).toBeInstanceOf(Date);

    const validUrl = await expectRedirect(
      updateNeed(
        formData({
          incidentId: valid.incident.id,
          needId: valid.need.id,
          quantityNeeded: 11,
          deadline: "2099-01-01T12:00",
          reason: "Reapertura revisada por nueva capacidad necesaria",
          confirmNeedUpdate: true,
        }),
      ),
    );
    const incompleteUrl = await expectRedirect(
      updateNeed(
        formData({
          incidentId: missingValidator.incident.id,
          needId: missingValidator.need.id,
          quantityNeeded: 11,
          deadline: "2099-01-01T12:00",
          reason: "Reapertura revisada sin autoría de validación vigente",
          confirmNeedUpdate: true,
        }),
      ),
    );

    expect(redirectMessage(validUrl, "notice")).toContain(
      "Necesidad actualizada y auditada",
    );
    expect(redirectMessage(incompleteUrl, "notice")).toContain(
      "Necesidad actualizada y auditada",
    );
    const [validNeed, draftNeed, validAudit, draftAudit] = await Promise.all([
      prisma.need.findUniqueOrThrow({ where: { id: valid.need.id } }),
      prisma.need.findUniqueOrThrow({
        where: { id: missingValidator.need.id },
      }),
      prisma.auditLog.findFirstOrThrow({
        where: { action: "need.updated", entityId: valid.need.id },
      }),
      prisma.auditLog.findFirstOrThrow({
        where: {
          action: "need.updated",
          entityId: missingValidator.need.id,
        },
      }),
    ]);
    expect(validNeed).toMatchObject({
      quantityNeeded: 11,
      status: NeedStatus.ACTIVE,
      validatedById: coordinatorId,
    });
    expect(draftNeed).toMatchObject({
      quantityNeeded: 11,
      status: NeedStatus.DRAFT,
      validatedById: null,
      validatedAt: incompleteNeed.validatedAt,
    });
    expect(validAudit.metadata).toEqual(
      expect.objectContaining({
        before: expect.objectContaining({ status: NeedStatus.COVERED }),
        after: expect.objectContaining({ status: NeedStatus.ACTIVE }),
      }),
    );
    expect(draftAudit.metadata).toEqual(
      expect.objectContaining({
        before: expect.objectContaining({ status: NeedStatus.COVERED }),
        after: expect.objectContaining({ status: NeedStatus.DRAFT }),
      }),
    );
  });

  it("does not reduce a need below received plus outstanding commitments", async () => {
    const { incident, safePoint, need } = await createScenario({
      quantityNeeded: 10,
      quantityReceived: 3,
    });
    await createContribution({
      needId: need.id,
      safePointId: safePoint.id,
      quantity: 3,
      deliveredQuantity: 3,
      status: ContributionStatus.DELIVERED,
    });
    await createContribution({
      needId: need.id,
      safePointId: safePoint.id,
      quantity: 4,
      status: ContributionStatus.PLEDGED,
    });

    const blockedUrl = await expectRedirect(
      updateNeed(
        formData({
          incidentId: incident.id,
          needId: need.id,
          quantityNeeded: 6,
          deadline: "2099-01-01T12:00",
          reason: "Ajuste revisado por la coordinación responsable",
          confirmNeedUpdate: true,
        }),
      ),
    );
    expect(redirectMessage(blockedUrl, "error")).toContain(
      "no puede ser menor que 7",
    );
    await expect(
      prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
    ).resolves.toMatchObject({ quantityNeeded: 10 });
    await expect(
      prisma.auditLog.count({
        where: { incidentId: incident.id, action: "need.updated" },
      }),
    ).resolves.toBe(0);

    const updatedUrl = await expectRedirect(
      updateNeed(
        formData({
          incidentId: incident.id,
          needId: need.id,
          quantityNeeded: 7,
          deadline: "2099-01-01T12:00",
          reason: "Ajuste revisado por la coordinación responsable",
          confirmNeedUpdate: true,
        }),
      ),
    );
    expect(redirectMessage(updatedUrl, "notice")).toContain(
      "Necesidad actualizada y auditada",
    );

    const coverBlockedUrl = await expectRedirect(
      updateNeedStatus(
        formData({
          incidentId: incident.id,
          needId: need.id,
          status: NeedStatus.COVERED,
          reason: "Comprobación manual del material recibido",
          confirmNeedStatusChange: true,
        }),
      ),
    );
    expect(redirectMessage(coverBlockedUrl, "error")).toContain(
      "cantidad recibida alcanza el total",
    );

    const [updatedNeed, audits] = await Promise.all([
      prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
      prisma.auditLog.findMany({
        where: { incidentId: incident.id, action: "need.updated" },
      }),
    ]);
    expect(updatedNeed).toMatchObject({
      quantityNeeded: 7,
      quantityReceived: 3,
      status: NeedStatus.ACTIVE,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toEqual(
      expect.objectContaining({
        protectedQuantity: 7,
        before: expect.objectContaining({ quantityNeeded: 10 }),
        after: expect.objectContaining({ quantityNeeded: 7 }),
      }),
    );
  });
});
