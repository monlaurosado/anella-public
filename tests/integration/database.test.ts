import { afterAll, describe, expect, it } from "vitest";

import {
  ContributionStatus,
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  Priority,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  ANONYMIZED_CONTRIBUTOR_NAME,
  anonymizeExpiredContributionData,
  runOperationalMaintenance,
} from "@/lib/privacy-retention";

const MAINTENANCE_LOCK_NAME = "anella:operational-maintenance:v1";

async function waitForMaintenanceLock() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await prisma.$queryRaw<
      Array<{ owner: number | bigint | null }>
    >`SELECT IS_USED_LOCK(${MAINTENANCE_LOCK_NAME}) AS owner`;
    if (rows[0]?.owner !== null && rows[0]?.owner !== undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("El mantenimiento no adquirió el lock durante la prueba.");
}

describe("database integration", () => {
  afterAll(async () => {
    await prisma.incident.deleteMany({
      where: { publicCode: { startsWith: "TEST-" } },
    });
    await prisma.$disconnect();
  });

  it("persists relational incident data and cascades children", async () => {
    const municipality = await prisma.municipality.findFirstOrThrow();
    const publicCode = `TEST-${Date.now()}`;
    const incident = await prisma.incident.create({
      data: {
        publicCode,
        title: "Incidente de integracion",
        type: IncidentType.WILDFIRE,
        status: IncidentStatus.DRAFT,
        priority: Priority.MEDIUM,
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
        safePoints: {
          create: {
            name: "Punto de prueba",
            address: "Calle de prueba, 1",
            instructions: "Acceso de prueba",
            latitude: 41.51,
            longitude: 2.21,
            qrToken: `test-${Date.now()}`,
          },
        },
      },
      include: { safePoints: true },
    });

    expect(incident.safePoints).toHaveLength(1);
    await prisma.incident.delete({ where: { id: incident.id } });
    expect(
      await prisma.safePoint.count({ where: { incidentId: incident.id } }),
    ).toBe(0);
  });

  it("anonymizes personal data after the configured retention period", async () => {
    const municipality = await prisma.municipality.findFirstOrThrow();
    const suffix = Date.now();
    const incident = await prisma.incident.create({
      data: {
        publicCode: `TEST-RETENTION-${suffix}`,
        title: "Incidente cerrado para retencion",
        type: IncidentType.WILDFIRE,
        status: IncidentStatus.RESOLVED,
        priority: Priority.LOW,
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
        closedAt: new Date("2020-01-01T00:00:00.000Z"),
        updatedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    const safePoint = await prisma.safePoint.create({
      data: {
        incidentId: incident.id,
        municipalityId: municipality.id,
        name: "Punto de retencion",
        address: "Calle de prueba, 2",
        latitude: 41.51,
        longitude: 2.21,
        qrToken: `test-retention-${suffix}`,
      },
    });
    const need = await prisma.need.create({
      data: {
        incidentId: incident.id,
        safePointId: safePoint.id,
        type: NeedType.WATER,
        title: "Agua de prueba",
        quantityNeeded: 2,
        unit: "packs",
      },
    });
    const contribution = await prisma.contribution.create({
      data: {
        publicCode: `AN-T-${String(suffix).slice(-10)}`,
        incidentId: incident.id,
        cancelTokenHash: "a".repeat(64),
        needId: need.id,
        safePointId: safePoint.id,
        citizenName: "Persona de prueba",
        citizenPhone: "+34600000000",
        citizenEmail: "retention@example.test",
        quantity: 1,
        eta: new Date(),
        notes: "Dato personal temporal",
        consentAt: new Date(),
        statusReason: "Llamar a María al llegar",
      },
    });
    const audit = await prisma.auditLog.create({
      data: {
        incidentId: incident.id,
        municipalityId: municipality.id,
        action: "contribution.pledged_by_citizen",
        entityType: "Contribution",
        entityId: contribution.id,
        metadata: {
          eta: new Date().toISOString(),
          reason: "Llamar a María al llegar",
        },
      },
    });

    const result = await anonymizeExpiredContributionData();
    const [anonymized, redactedAudit] = await Promise.all([
      prisma.contribution.findUniqueOrThrow({
        where: { id: contribution.id },
      }),
      prisma.auditLog.findUniqueOrThrow({ where: { id: audit.id } }),
    ]);

    expect(result.anonymizedContributions).toBeGreaterThanOrEqual(1);
    expect(anonymized).toMatchObject({
      citizenName: ANONYMIZED_CONTRIBUTOR_NAME,
      citizenPhone: null,
      citizenEmail: null,
      notes: null,
      eta: null,
      statusReason: null,
      cancelTokenHash: null,
    });
    expect(result.redactedAuditEntries).toBeGreaterThanOrEqual(1);
    expect(redactedAudit.metadata).toMatchObject({
      retentionRedacted: true,
    });
    expect(JSON.stringify(redactedAudit.metadata)).not.toContain("María");
  });

  it("defers expiry while a delivery is in progress and expires clear needs", async () => {
    const municipality = await prisma.municipality.findFirstOrThrow();
    const suffix = Date.now();
    const now = new Date();
    const incident = await prisma.incident.create({
      data: {
        publicCode: `TEST-DEADLINE-${suffix}`.slice(0, 32),
        title: "Incidente para vencimiento automático",
        type: IncidentType.OTHER,
        status: IncidentStatus.DRAFT,
        priority: Priority.LOW,
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
      },
    });
    const safePoint = await prisma.safePoint.create({
      data: {
        incidentId: incident.id,
        municipalityId: municipality.id,
        name: "Punto con entrega pendiente",
        latitude: 41.51,
        longitude: 2.21,
        qrToken: `test-deadline-${suffix}`,
      },
    });
    const need = await prisma.need.create({
      data: {
        incidentId: incident.id,
        safePointId: safePoint.id,
        type: NeedType.OTHER,
        title: "Necesidad vencida",
        quantityNeeded: 3,
        deadline: new Date(now.getTime() - 60_000),
        status: NeedStatus.ACTIVE,
      },
    });
    const contribution = await prisma.contribution.create({
      data: {
        publicCode: `AN-DUE-${String(suffix).slice(-10)}`,
        incidentId: incident.id,
        needId: need.id,
        safePointId: safePoint.id,
        citizenName: "SIMULACRO entrega en curso",
        quantity: 2,
        status: ContributionStatus.EN_ROUTE,
        consentAt: now,
      },
    });
    const clearNeed = await prisma.need.create({
      data: {
        incidentId: incident.id,
        safePointId: safePoint.id,
        type: NeedType.OTHER,
        title: "Necesidad vencida sin entregas",
        quantityNeeded: 1,
        deadline: new Date(now.getTime() - 60_000),
        status: NeedStatus.ACTIVE,
      },
    });

    const result = await runOperationalMaintenance(now);
    const [updatedNeed, updatedClearNeed, updatedContribution, auditCount] =
      await Promise.all([
        prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
        prisma.need.findUniqueOrThrow({ where: { id: clearNeed.id } }),
        prisma.contribution.findUniqueOrThrow({
          where: { id: contribution.id },
        }),
        prisma.auditLog.count({
          where: {
            action: "need.expired_automatically",
            entityId: clearNeed.id,
          },
        }),
      ]);

    expect(result.skippedBecauseLocked).toBe(false);
    expect(result.expiredNeeds).toBeGreaterThanOrEqual(1);
    expect(result.deferredNeeds).toBeGreaterThanOrEqual(1);
    expect(updatedNeed.status).toBe(NeedStatus.ACTIVE);
    expect(updatedClearNeed.status).toBe(NeedStatus.EXPIRED);
    expect(updatedContribution.status).toBe(ContributionStatus.EN_ROUTE);
    expect(auditCount).toBe(1);
  });

  it("commits privacy work in bounded batches and is idempotent on successive runs", async () => {
    const municipality = await prisma.municipality.findFirstOrThrow();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const incident = await prisma.incident.create({
      data: {
        publicCode: `TEST-BATCH-${suffix}`.slice(0, 32),
        title: "Incidente con backlog de privacidad",
        type: IncidentType.OTHER,
        status: IncidentStatus.RESOLVED,
        priority: Priority.LOW,
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
        closedAt: new Date("2020-01-01T00:00:00.000Z"),
        updatedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });

    try {
      const safePoint = await prisma.safePoint.create({
        data: {
          incidentId: incident.id,
          municipalityId: municipality.id,
          name: "Punto para backlog de privacidad",
          latitude: 41.51,
          longitude: 2.21,
          qrToken: `test-batch-${suffix}`,
        },
      });
      const need = await prisma.need.create({
        data: {
          incidentId: incident.id,
          safePointId: safePoint.id,
          type: NeedType.OTHER,
          title: "Necesidad con más de un lote",
          quantityNeeded: 501,
        },
      });
      const contributionPrefix = Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();
      await prisma.contribution.createMany({
        data: Array.from({ length: 501 }, (_, index) => ({
          publicCode: `B-${contributionPrefix}-${String(index).padStart(4, "0")}`,
          incidentId: incident.id,
          needId: need.id,
          safePointId: safePoint.id,
          citizenName: `Persona backlog ${index}`,
          citizenPhone: `+3461${String(index).padStart(7, "0")}`,
          citizenEmail: `backlog-${index}@example.test`,
          quantity: 1,
          eta: now,
          notes: `Nota privada ${index}`,
          statusReason: `Motivo privado ${index}`,
          consentAt: now,
        })),
      });

      const first = await runOperationalMaintenance(now);
      const [remainingPersonalData, firstAuditCount] = await Promise.all([
        prisma.contribution.count({
          where: {
            needId: need.id,
            OR: [
              { citizenName: { not: ANONYMIZED_CONTRIBUTOR_NAME } },
              { citizenPhone: { not: null } },
              { citizenEmail: { not: null } },
              { notes: { not: null } },
              { eta: { not: null } },
              { statusReason: { not: null } },
            ],
          },
        }),
        prisma.auditLog.count({
          where: {
            incidentId: incident.id,
            action: "privacy.contributions_anonymized",
          },
        }),
      ]);

      expect(first.skippedBecauseLocked).toBe(false);
      expect(first.anonymizedContributions).toBeGreaterThanOrEqual(501);
      expect(remainingPersonalData).toBe(0);
      expect(firstAuditCount).toBe(2);

      const second = await runOperationalMaintenance(now);
      const secondAuditCount = await prisma.auditLog.count({
        where: {
          incidentId: incident.id,
          action: "privacy.contributions_anonymized",
        },
      });

      expect(second).toMatchObject({
        skippedBecauseLocked: false,
        anonymizedContributions: 0,
        redactedAuditEntries: 0,
      });
      expect(secondAuditCount).toBe(firstAuditCount);
    } finally {
      await prisma.auditLog.deleteMany({
        where: { incidentId: incident.id },
      });
      await prisma.incident.deleteMany({ where: { id: incident.id } });
    }
  }, 60_000);

  it("keeps the advisory lock while batches commit and skips a concurrent run", async () => {
    const municipality = await prisma.municipality.findFirstOrThrow();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const incident = await prisma.incident.create({
      data: {
        publicCode: `TEST-LOCK-${suffix}`.slice(0, 32),
        title: "Incidente para exclusión de mantenimiento",
        type: IncidentType.OTHER,
        status: IncidentStatus.DRAFT,
        priority: Priority.LOW,
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
      },
    });

    try {
      const safePoint = await prisma.safePoint.create({
        data: {
          incidentId: incident.id,
          municipalityId: municipality.id,
          name: "Punto para exclusión de mantenimiento",
          latitude: 41.51,
          longitude: 2.21,
          qrToken: `test-lock-${suffix}`,
        },
      });
      const need = await prisma.need.create({
        data: {
          incidentId: incident.id,
          safePointId: safePoint.id,
          type: NeedType.OTHER,
          title: "Necesidad bloqueada durante la prueba",
          quantityNeeded: 1,
          deadline: new Date(now.getTime() - 60_000),
          status: NeedStatus.ACTIVE,
        },
      });

      let markRowLocked: () => void = () => undefined;
      const rowLocked = new Promise<void>((resolve) => {
        markRowLocked = resolve;
      });
      let releaseRow: () => void = () => undefined;
      const rowReleased = new Promise<void>((resolve) => {
        releaseRow = resolve;
      });
      const blocker = prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM Need WHERE id = ${need.id} FOR UPDATE
          `;
          markRowLocked();
          await rowReleased;
        },
        { maxWait: 5_000, timeout: 15_000 },
      );
      await rowLocked;

      const firstRun = runOperationalMaintenance(now);
      let concurrentResult:
        Awaited<ReturnType<typeof runOperationalMaintenance>> | undefined;
      let observationError: unknown;
      try {
        await waitForMaintenanceLock();
        concurrentResult = await runOperationalMaintenance(now);
      } catch (error) {
        observationError = error;
      } finally {
        releaseRow();
      }

      const [firstResult] = await Promise.all([firstRun, blocker]);
      if (observationError) throw observationError;

      const [updatedNeed, auditCount] = await Promise.all([
        prisma.need.findUniqueOrThrow({ where: { id: need.id } }),
        prisma.auditLog.count({
          where: {
            incidentId: incident.id,
            action: "need.expired_automatically",
            entityId: need.id,
          },
        }),
      ]);

      expect(concurrentResult).toMatchObject({
        skippedBecauseLocked: true,
        expiredNeeds: 0,
        anonymizedContributions: 0,
      });
      expect(firstResult.skippedBecauseLocked).toBe(false);
      expect(firstResult.expiredNeeds).toBeGreaterThanOrEqual(1);
      expect(updatedNeed.status).toBe(NeedStatus.EXPIRED);
      expect(auditCount).toBe(1);
    } finally {
      await prisma.auditLog.deleteMany({
        where: { incidentId: incident.id },
      });
      await prisma.incident.deleteMany({ where: { id: incident.id } });
    }
  });
});
