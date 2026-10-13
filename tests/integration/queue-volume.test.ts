import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ municipalityId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal", () => ({
  requireCoordinator: async () => ({
    id: "volume-test-coordinator",
    name: "Coordinación de pruebas",
    email: "volume@example.test",
    role: "COORDINATOR" as const,
    municipalityId: scope.municipalityId,
    municipalityName: "Municipio de volumen",
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
import { getContributionQueue, getIncidentQueue } from "@/services/incidents";

describe("coordination queue volume", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const titlePrefix = `SIMULACRO VOLUMEN ${suffix}`;
  const matrixPrefix = `SIMULACRO FILTROS ${suffix}`;
  const matrixCodePrefix = `QF${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`.toUpperCase();
  const municipalityName = `TEST municipio volumen ${suffix}`;
  const organizationAlphaName = `TEST organización alfa ${suffix}`;
  const organizationBetaName = `TEST organización beta ${suffix}`;
  const fixedTimestamp = new Date("2026-07-13T12:00:00.000Z");
  const incidentIds = Array.from(
    { length: 125 },
    (_, index) => `queue-incident-${suffix}-${String(index).padStart(3, "0")}`,
  );
  const contributionIds = Array.from(
    { length: 125 },
    (_, index) =>
      `queue-contribution-${suffix}-${String(index).padStart(3, "0")}`,
  );
  const contributionCodePrefix =
    `V${Date.now().toString(36).slice(-5)}${Math.random()
      .toString(36)
      .slice(2, 6)}`.toUpperCase();
  const matrixIncidentIds = Array.from(
    { length: 4 },
    (_, index) => `queue-filter-${suffix}-${index}`,
  );
  const matrixTitles = [
    `${matrixPrefix} A`,
    `${matrixPrefix} B`,
    `${matrixPrefix} C`,
    `${matrixPrefix} D`,
  ];

  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: municipalityName },
    });
    scope.municipalityId = municipality.id;
    const [organizationAlpha, organizationBeta] = await Promise.all([
      prisma.organization.create({
        data: {
          name: organizationAlphaName,
          municipalityId: municipality.id,
        },
      }),
      prisma.organization.create({
        data: {
          name: organizationBetaName,
          municipalityId: municipality.id,
        },
      }),
    ]);

    const statuses = [
      IncidentStatus.DRAFT,
      IncidentStatus.ACTIVE,
      IncidentStatus.MONITORING,
    ];
    const priorities = [
      Priority.LOW,
      Priority.MEDIUM,
      Priority.HIGH,
      Priority.CRITICAL,
    ];

    await prisma.incident.createMany({
      data: Array.from({ length: 125 }, (_, index) => ({
        id: incidentIds[index],
        publicCode: `VOL-${suffix}-${index}`.slice(0, 32),
        title: `${titlePrefix} ${String(index).padStart(3, "0")}`,
        type: IncidentType.OTHER,
        status: statuses[index % statuses.length],
        priority: priorities[index % priorities.length],
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
        lastActivityAt: fixedTimestamp,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      })),
    });

    const matrixCreatedAt = [
      new Date("2026-07-10T12:00:00.000Z"),
      new Date("2026-07-11T12:00:00.000Z"),
      new Date("2026-07-12T12:00:00.000Z"),
      new Date("2026-07-13T12:00:00.000Z"),
    ];
    const matrixActivityAt = [
      new Date("2026-07-13T18:00:00.000Z"),
      new Date("2026-07-12T18:00:00.000Z"),
      new Date("2026-07-11T18:00:00.000Z"),
      new Date("2026-07-10T18:00:00.000Z"),
    ];
    const matrixTypes = [
      IncidentType.WILDFIRE,
      IncidentType.FLOOD,
      IncidentType.STORM,
      IncidentType.SNOW,
    ];
    const matrixStatuses = [
      IncidentStatus.DRAFT,
      IncidentStatus.PENDING_VALIDATION,
      IncidentStatus.ACTIVE,
      IncidentStatus.MONITORING,
    ];
    const matrixPriorities = [
      Priority.LOW,
      Priority.MEDIUM,
      Priority.HIGH,
      Priority.CRITICAL,
    ];

    await prisma.incident.createMany({
      data: matrixIncidentIds.map((id, index) => ({
        id,
        publicCode: `${matrixCodePrefix}-${index}`,
        title: matrixTitles[index],
        type: matrixTypes[index],
        status: matrixStatuses[index],
        priority: matrixPriorities[index],
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
        organizationId:
          index < 2
            ? organizationAlpha.id
            : index === 2
              ? organizationBeta.id
              : null,
        responsibleOrgName:
          index === 3 ? `TEST equipo externo ${suffix}` : null,
        createdAt: matrixCreatedAt[index],
        updatedAt: matrixCreatedAt[index],
        lastActivityAt: matrixActivityAt[index],
      })),
    });

    const matrixSafePoint = await prisma.safePoint.create({
      data: {
        incidentId: matrixIncidentIds[2],
        municipalityId: municipality.id,
        name: `SIMULACRO punto filtros ${suffix}`,
        address: "Dirección segura de simulacro",
        latitude: 41.51,
        longitude: 2.21,
        qrToken: `volume-filters-${suffix}`,
      },
    });
    await prisma.need.create({
      data: {
        incidentId: matrixIncidentIds[2],
        safePointId: matrixSafePoint.id,
        type: NeedType.WATER,
        title: `SIMULACRO necesidad pendiente filtros ${suffix}`,
        quantityNeeded: 10,
        unit: "paquetes",
        deadline: new Date("2027-01-01T12:00:00.000Z"),
        status: NeedStatus.ACTIVE,
      },
    });
    await prisma.contribution.create({
      data: {
        publicCode: `PENDING-${suffix}`.slice(0, 20),
        incidentId: matrixIncidentIds[2],
        safePointId: matrixSafePoint.id,
        category: "WATER",
        description: "Aportación directa pendiente para filtros",
        citizenName: "Ciudadanía TEST filtros",
        quantity: 1,
        status: ContributionStatus.PLEDGED,
        consentAt: fixedTimestamp,
      },
    });

    const contributionIncident = await prisma.incident.create({
      data: {
        publicCode: `VCI-${suffix}`.slice(0, 32),
        title: `SIMULACRO COLA APORTACIONES ${suffix}`,
        type: IncidentType.OTHER,
        status: IncidentStatus.ACTIVE,
        priority: Priority.MEDIUM,
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
      },
    });
    const safePoint = await prisma.safePoint.create({
      data: {
        incidentId: contributionIncident.id,
        municipalityId: municipality.id,
        name: `SIMULACRO punto volumen ${suffix}`,
        address: "Dirección segura de simulacro",
        latitude: 41.51,
        longitude: 2.21,
        qrToken: `volume-contributions-${suffix}`,
      },
    });
    const need = await prisma.need.create({
      data: {
        incidentId: contributionIncident.id,
        safePointId: safePoint.id,
        type: NeedType.OTHER,
        title: `SIMULACRO necesidad volumen ${suffix}`,
        quantityNeeded: 500,
        unit: "uds",
        status: NeedStatus.ACTIVE,
      },
    });
    const contributionStatuses = [
      ContributionStatus.PLEDGED,
      ContributionStatus.EN_ROUTE,
      ContributionStatus.DELIVERED,
    ];
    await prisma.contribution.createMany({
      data: Array.from({ length: 125 }, (_, index) => {
        const status =
          contributionStatuses[index % contributionStatuses.length];
        return {
          id: contributionIds[index],
          publicCode: `${contributionCodePrefix}${index}`,
          incidentId: contributionIncident.id,
          needId: need.id,
          safePointId: safePoint.id,
          citizenName: `SIMULACRO ciudadanía volumen ${index}`,
          citizenPhone: `+34900${String(index).padStart(6, "0")}`,
          quantity: 1,
          deliveredQuantity: status === ContributionStatus.DELIVERED ? 1 : 0,
          status,
          consentAt: fixedTimestamp,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
        };
      }),
    });
  });

  afterAll(async () => {
    if (scope.municipalityId) {
      await prisma.incident.deleteMany({
        where: { municipalityId: scope.municipalityId },
      });
      await prisma.organization.deleteMany({
        where: { municipalityId: scope.municipalityId },
      });
      await prisma.municipality.delete({
        where: { id: scope.municipalityId },
      });
    }
  });

  it("paginates the complete queue instead of truncating at 20 rows", async () => {
    const startedAt = performance.now();
    const seenIds: string[] = [];

    for (let page = 1; page <= 5; page += 1) {
      const result = await getIncidentQueue({
        query: titlePrefix,
        page,
        pageSize: 25,
      });
      expect(result).toMatchObject({
        total: 125,
        page,
        pageSize: 25,
        pageCount: 5,
      });
      expect(result.items).toHaveLength(25);
      seenIds.push(...result.items.map((item) => item.id));
    }

    const elapsedMs = performance.now() - startedAt;

    expect(seenIds).toEqual([...incidentIds].sort().reverse());
    expect(new Set(seenIds).size).toBe(125);
    expect(elapsedMs).toBeLessThan(3_000);
  });

  it("combines tenant, search and status filters while capping page size", async () => {
    const result = await getIncidentQueue({
      query: titlePrefix,
      statuses: ["active"],
      pageSize: 500,
    });

    expect(result.pageSize).toBe(100);
    expect(result.total).toBe(42);
    expect(result.items).toHaveLength(42);
    expect(result.items.every((item) => item.status === "active")).toBe(true);
  });

  it("searches code, title, municipality and organization in SQL", async () => {
    const [byCode, byTitle, byMunicipality, byOrganization] = await Promise.all(
      [
        getIncidentQueue({ query: `${matrixCodePrefix}-1`, pageSize: 10 }),
        getIncidentQueue({ query: matrixPrefix, pageSize: 10 }),
        getIncidentQueue({ query: municipalityName, pageSize: 100 }),
        getIncidentQueue({ query: organizationAlphaName, pageSize: 10 }),
      ],
    );

    expect(byCode.items.map((item) => item.id)).toEqual([matrixIncidentIds[1]]);
    expect(byTitle.items.map((item) => item.id).sort()).toEqual(
      [...matrixIncidentIds].sort(),
    );
    expect(byMunicipality.total).toBe(130);
    expect(
      byMunicipality.items.every(
        (item) => item.municipalityName === municipalityName,
      ),
    ).toBe(true);
    expect(byOrganization.items.map((item) => item.id).sort()).toEqual(
      matrixIncidentIds.slice(0, 2).sort(),
    );
  });

  it("applies every advanced incident filter against persisted rows", async () => {
    const [
      byStatus,
      byType,
      byPriority,
      byMunicipality,
      byOrganization,
      byDate,
      pending,
    ] = await Promise.all([
      getIncidentQueue({
        query: matrixPrefix,
        statuses: ["monitoring"],
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        types: ["flood"],
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        priorities: ["critical"],
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        municipality: `municipio volumen ${suffix}`,
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        organization: `organización beta ${suffix}`,
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        createdFrom: "2026-07-11",
        createdTo: "2026-07-12",
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        hasPendingNeeds: true,
        pageSize: 10,
      }),
    ]);

    expect(byStatus.items.map((item) => item.id)).toEqual([
      matrixIncidentIds[3],
    ]);
    expect(byType.items.map((item) => item.id)).toEqual([matrixIncidentIds[1]]);
    expect(byPriority.items.map((item) => item.id)).toEqual([
      matrixIncidentIds[3],
    ]);
    expect(byMunicipality.items.map((item) => item.id).sort()).toEqual(
      [...matrixIncidentIds].sort(),
    );
    expect(byOrganization.items.map((item) => item.id)).toEqual([
      matrixIncidentIds[2],
    ]);
    expect(byDate.items.map((item) => item.id).sort()).toEqual(
      matrixIncidentIds.slice(1, 3).sort(),
    );
    expect(pending.items.map((item) => item.id)).toEqual([
      matrixIncidentIds[2],
    ]);
  });

  it("orders by activity, priority and creation in both directions", async () => {
    const [
      activityAsc,
      activityDesc,
      priorityAsc,
      priorityDesc,
      createdAsc,
      createdDesc,
    ] = await Promise.all([
      getIncidentQueue({
        query: matrixPrefix,
        sort: "activity",
        direction: "asc",
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        sort: "activity",
        direction: "desc",
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        sort: "priority",
        direction: "asc",
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        sort: "priority",
        direction: "desc",
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        sort: "created",
        direction: "asc",
        pageSize: 10,
      }),
      getIncidentQueue({
        query: matrixPrefix,
        sort: "created",
        direction: "desc",
        pageSize: 10,
      }),
    ]);

    const ids = (result: Awaited<ReturnType<typeof getIncidentQueue>>) =>
      result.items.map((item) => item.id);
    const ascending = [...matrixIncidentIds];
    const descending = [...matrixIncidentIds].reverse();

    expect(ids(activityAsc)).toEqual(descending);
    expect(ids(activityDesc)).toEqual(ascending);
    expect(ids(priorityAsc)).toEqual(ascending);
    expect(ids(priorityDesc)).toEqual(descending);
    expect(ids(createdAsc)).toEqual(ascending);
    expect(ids(createdDesc)).toEqual(descending);
  });

  it("clamps extreme queue pages before issuing an OFFSET query", async () => {
    const [incidents, contributions] = await Promise.all([
      getIncidentQueue({
        query: titlePrefix,
        page: 999_999,
        pageSize: 25,
      }),
      getContributionQueue({
        query: contributionCodePrefix,
        page: 999_999,
        pageSize: 25,
      }),
    ]);

    for (const result of [incidents, contributions]) {
      expect(result).toMatchObject({
        page: 5,
        pageSize: 25,
        total: 125,
        pageCount: 5,
      });
      expect(result.items).toHaveLength(25);
    }
  });

  it("has a usable composite index for tenant/status/activity pagination", async () => {
    const plan = await prisma.$queryRaw<
      Array<{ key: string | null; Extra: string }>
    >`
      EXPLAIN
      SELECT id, publicCode, title, status, priority, lastActivityAt
      FROM Incident
      WHERE municipalityId = ${scope.municipalityId}
        AND status = 'ACTIVE'
      ORDER BY lastActivityAt DESC, createdAt DESC, id DESC
      LIMIT 25
    `;

    expect(plan[0]?.key).toBe("Incident_tenant_status_activity_idx");
    expect(plan[0]?.Extra ?? "").not.toContain("Using filesort");
  });

  it("paginates the global contribution queue beyond 20 rows", async () => {
    const startedAt = performance.now();
    const seenIds: string[] = [];

    for (let page = 1; page <= 5; page += 1) {
      const result = await getContributionQueue({
        query: contributionCodePrefix,
        page,
        pageSize: 25,
      });
      expect(result).toMatchObject({
        total: 125,
        page,
        pageSize: 25,
        pageCount: 5,
      });
      expect(result.items).toHaveLength(25);
      seenIds.push(...result.items.map((item) => item.id));
    }

    const elapsedMs = performance.now() - startedAt;

    expect(seenIds).toEqual([...contributionIds].sort().reverse());
    expect(new Set(seenIds).size).toBe(125);
    expect(elapsedMs).toBeLessThan(3_000);
  });

  it("searches incident and safe point server-side without preloading option lists", async () => {
    const result = await getContributionQueue({
      incidentQuery: `COLA APORTACIONES ${suffix}`,
      safePointQuery: `punto volumen ${suffix}`,
      page: 1,
      pageSize: 10,
    });

    expect(result).toMatchObject({ total: 125, page: 1, pageSize: 10 });
    expect(result.items).toHaveLength(10);
    expect(
      result.items.every(
        (item) =>
          item.incidentTitle.includes(`COLA APORTACIONES ${suffix}`) &&
          item.safePointName?.includes(`punto volumen ${suffix}`),
      ),
    ).toBe(true);
  });

  it("keeps SQL query count effectively constant as page size grows", async () => {
    type QuestionsRow = { Value: number | bigint | string };
    const questions = async () => {
      const rows = await prisma.$queryRawUnsafe<QuestionsRow[]>(
        "SHOW GLOBAL STATUS LIKE 'Questions'",
      );
      return Number(rows[0]?.Value ?? 0);
    };
    const measure = async (pageSize: number) => {
      const before = await questions();
      await getContributionQueue({ query: contributionCodePrefix, pageSize });
      const after = await questions();
      return after - before;
    };

    await getContributionQueue({ query: contributionCodePrefix, pageSize: 10 });
    const tenRows = await measure(10);
    const hundredRows = await measure(100);

    expect(tenRows).toBeGreaterThan(0);
    expect(hundredRows).toBeLessThanOrEqual(tenRows + 2);
    expect(hundredRows).toBeLessThan(20);
  });

  it("uses the global contribution queue ordering index", async () => {
    const plan = await prisma.$queryRaw<
      Array<{ key: string | null; Extra: string }>
    >`
      EXPLAIN
      SELECT id, publicCode, status, updatedAt, createdAt
      FROM Contribution
      WHERE status = 'PLEDGED'
      ORDER BY updatedAt DESC, createdAt DESC, id DESC
      LIMIT 25
    `;

    expect(plan[0]?.key).toBe("Contribution_queue_status_updated_created_idx");
    expect(plan[0]?.Extra ?? "").not.toContain("Using filesort");
  });
});
