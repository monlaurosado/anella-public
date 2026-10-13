import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ municipalityId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => Promise<unknown>) => loader,
}));
vi.mock("@/lib/dal", () => ({
  requireCoordinator: async () => ({
    id: "incident-detail-volume-coordinator",
    name: "Coordinación de pruebas de volumen",
    email: "incident-detail-volume@example.test",
    role: "COORDINATOR" as const,
    municipalityId: scope.municipalityId,
    municipalityName: "Municipio de pruebas de volumen",
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
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { GET as getIncidentApi } from "@/app/api/incidents/route";
import {
  getManagedContributionPage,
  getManagedIncidentById,
} from "@/services/incidents";
import type { ManagedIncident, ManagedIncidentTab } from "@/types/domain";

const ITEM_COUNT = 125;
const PAGE_SIZE = 25;

describe("managed incident detail volume", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const fixedTimestamp = new Date("2026-07-13T12:00:00.000Z");
  const needIds = Array.from(
    { length: ITEM_COUNT },
    (_, index) => `detail-need-${suffix}-${String(index).padStart(3, "0")}`,
  );
  const contributionIds = Array.from(
    { length: ITEM_COUNT },
    (_, index) =>
      `detail-contribution-${suffix}-${String(index).padStart(3, "0")}`,
  );
  const auditIds = Array.from(
    { length: ITEM_COUNT },
    (_, index) => `detail-audit-${suffix}-${String(index).padStart(3, "0")}`,
  );
  const contributionCodePrefix =
    `DV${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const contributionStatuses = [
    ContributionStatus.PLEDGED,
    ContributionStatus.EN_ROUTE,
    ContributionStatus.PARTIALLY_DELIVERED,
    ContributionStatus.DELIVERED,
    ContributionStatus.CANCELLED,
    ContributionStatus.NO_SHOW,
  ] as const;

  let municipalityId = "";
  let organizationId = "";
  let coordinatorId = "";
  let incidentId = "";
  let safePointId = "";

  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: `TEST detalle volumen ${suffix}` },
    });
    municipalityId = municipality.id;
    scope.municipalityId = municipality.id;

    const organization = await prisma.organization.create({
      data: {
        name: `TEST organización detalle volumen ${suffix}`,
        municipalityId,
      },
    });
    organizationId = organization.id;

    const coordinator = await prisma.user.create({
      data: {
        name: "Coordinación TEST detalle volumen",
        email: `detail-volume-${suffix}@anella.test`,
        role: UserRole.COORDINATOR,
        municipalityId,
        organizationId,
      },
    });
    coordinatorId = coordinator.id;

    const incident = await prisma.incident.create({
      data: {
        publicCode: `DETAIL-${suffix}`.slice(0, 32),
        title: `SIMULACRO detalle operativo ${suffix}`,
        type: IncidentType.OTHER,
        status: IncidentStatus.ACTIVE,
        priority: Priority.HIGH,
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId,
        organizationId,
        createdById: coordinatorId,
        verifiedById: coordinatorId,
        verifiedAt: fixedTimestamp,
        publicLocationApprovedById: coordinatorId,
        publicLocationApprovedAt: fixedTimestamp,
        publicLocationLabel: municipality.name,
        lastActivityAt: fixedTimestamp,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      },
    });
    incidentId = incident.id;

    const safePoint = await prisma.safePoint.create({
      data: {
        incidentId,
        municipalityId,
        name: "Punto seguro TEST detalle volumen",
        address: "Dirección segura de simulacro",
        instructions: "Entrega solo al personal acreditado.",
        latitude: 41.51,
        longitude: 2.21,
        qrToken: `detail-volume-${suffix}`,
        isActive: true,
        pointStatus: "ACTIVE",
        publishedAt: fixedTimestamp,
        validatedById: coordinatorId,
        validatedAt: fixedTimestamp,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      },
    });
    safePointId = safePoint.id;

    await prisma.need.createMany({
      data: needIds.map((id, index) => ({
        id,
        incidentId,
        safePointId,
        type: NeedType.OTHER,
        title: `Necesidad de volumen ${String(index).padStart(3, "0")}`,
        priority: Priority.HIGH,
        quantityNeeded: 10,
        unit: "uds",
        deadline: new Date("2099-01-01T12:00:00.000Z"),
        status: NeedStatus.ACTIVE,
        requestingOrganizationId: organizationId,
        requestedById: coordinatorId,
        validatedById: coordinatorId,
        validatedAt: fixedTimestamp,
        publishedAt: fixedTimestamp,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      })),
    });

    await prisma.contribution.createMany({
      data: contributionIds.map((id, index) => {
        const status =
          contributionStatuses[index % contributionStatuses.length];
        return {
          id,
          publicCode: `${contributionCodePrefix}${String(index).padStart(3, "0")}`,
          incidentId,
          needId: needIds[index],
          safePointId,
          citizenName: `Ciudadanía TEST detalle ${index}`,
          quantity: 1,
          deliveredQuantity: status === ContributionStatus.DELIVERED ? 1 : 0,
          status,
          consentAt: fixedTimestamp,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
        };
      }),
    });

    await prisma.auditLog.createMany({
      data: auditIds.map((id, index) => ({
        id,
        actorId: coordinatorId,
        incidentId,
        municipalityId,
        action: "test.incident_detail_volume",
        entityType: "Need",
        entityId: needIds[index],
        metadata: { sequence: index },
        createdAt: fixedTimestamp,
      })),
    });

    await prisma.$executeRawUnsafe(
      "ANALYZE TABLE `Need`, `Contribution`, `AuditLog`",
    );
  });

  afterAll(async () => {
    if (!municipalityId) return;

    await prisma.auditLog.deleteMany({ where: { municipalityId } });
    await prisma.incident.deleteMany({ where: { id: incidentId } });
    await prisma.user.deleteMany({ where: { id: coordinatorId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.municipality.deleteMany({ where: { id: municipalityId } });
  });

  async function detail(
    tab: ManagedIncidentTab,
    page = 1,
    pageSize = PAGE_SIZE,
  ): Promise<ManagedIncident> {
    const result = await getManagedIncidentById(incidentId, {
      tab,
      page,
      pageSize,
    });
    if (!result)
      throw new Error("El incidente de volumen no está en su tenant");
    return result;
  }

  function expectOnlyActiveCollection(
    incident: ManagedIncident,
    tab: ManagedIncidentTab,
  ) {
    const activeCollection = {
      summary: null,
      needs: "needs",
      contributions: "contributions",
      "safe-points": "safePoints",
      activity: "activity",
    } as const;
    const collections = [
      "needs",
      "contributions",
      "safePoints",
      "activity",
    ] as const;

    for (const collection of collections) {
      if (activeCollection[tab] !== collection) {
        expect(incident[collection]).toEqual([]);
      }
    }
  }

  it("returns exact counts without loading inactive tab collections", async () => {
    const summary = await detail("summary");

    expect(summary.counts).toEqual({
      needs: ITEM_COUNT,
      contributions: ITEM_COUNT,
      contributionStatuses: {
        pledged: 21,
        en_route: 21,
        partially_delivered: 21,
        delivered: 21,
        cancelled: 21,
        no_show: 20,
      },
      safePoints: 1,
      activity: ITEM_COUNT,
    });
    expect(summary.safePointOptions).toEqual([]);
    expect(summary.needOptions).toEqual([]);
    expect(summary.isPubliclyVisible).toBe(true);
    expectOnlyActiveCollection(summary, "summary");

    const needs = await detail("needs");
    expect(needs.needs).toHaveLength(PAGE_SIZE);
    expect(needs.safePointOptions).toHaveLength(1);
    expect(needs.needOptions).toEqual([]);
    expectOnlyActiveCollection(needs, "needs");

    const contributions = await detail("contributions");
    expect(contributions.contributions).toHaveLength(PAGE_SIZE);
    expect(contributions.safePointOptions).toEqual([]);
    expect(contributions.needOptions).toEqual([]);
    expectOnlyActiveCollection(contributions, "contributions");

    const pledged = await getManagedIncidentById(incidentId, {
      tab: "contributions",
      contributionStatus: "pledged",
      pageSize: 100,
    });
    expect(pledged?.pagination).toMatchObject({
      tab: "contributions",
      total: 21,
      pageCount: 1,
    });
    expect(pledged?.contributions).toHaveLength(21);
    expect(
      pledged?.contributions.every(
        (contribution) => contribution.status === "pledged",
      ),
    ).toBe(true);

    const activity = await detail("activity");
    expect(activity.activity).toHaveLength(PAGE_SIZE);
    expect(activity.safePointOptions).toEqual([]);
    expect(activity.needOptions).toEqual([]);
    expectOnlyActiveCollection(activity, "activity");
  });

  it("resolves a contribution on a later page with the exact stable ordering", async () => {
    const orderedIds = [...contributionIds].sort().reverse();
    const targetId = orderedIds[73]!;
    await expect(
      getManagedContributionPage(incidentId, targetId, {
        pageSize: PAGE_SIZE,
        contributionStatus: "all",
      }),
    ).resolves.toBe(3);

    const page = await detail("contributions", 3);
    expect(page.contributions.map(({ id }) => id)).toContain(targetId);
    await expect(
      getManagedContributionPage("otro-incidente", targetId, {
        pageSize: PAGE_SIZE,
      }),
    ).resolves.toBeNull();
  });

  it("clamps an extreme detail page before issuing collection OFFSET queries", async () => {
    const [needs, contributions, activity, safePoints] = await Promise.all([
      detail("needs", 999_999),
      detail("contributions", 999_999),
      detail("activity", 999_999),
      detail("safe-points", 999_999),
    ]);

    for (const result of [needs, contributions, activity]) {
      expect(result.pagination).toMatchObject({
        page: 5,
        pageSize: PAGE_SIZE,
        total: ITEM_COUNT,
        pageCount: 5,
      });
    }
    expect(needs.needs).toHaveLength(PAGE_SIZE);
    expect(contributions.contributions).toHaveLength(PAGE_SIZE);
    expect(activity.activity).toHaveLength(PAGE_SIZE);
    expect(safePoints.pagination).toMatchObject({
      page: 1,
      pageSize: PAGE_SIZE,
      total: 1,
      pageCount: 1,
    });
    expect(safePoints.safePoints).toHaveLength(1);
  });

  it("walks every page with stable totals, order and no duplicates in under three seconds", async () => {
    const startedAt = performance.now();
    const seenNeeds: string[] = [];
    const seenContributions: string[] = [];
    const seenActivity: string[] = [];

    for (let page = 1; page <= 5; page += 1) {
      const [needs, contributions, activity] = await Promise.all([
        detail("needs", page),
        detail("contributions", page),
        detail("activity", page),
      ]);

      for (const result of [needs, contributions, activity]) {
        expect(result.pagination).toMatchObject({
          page,
          pageSize: PAGE_SIZE,
          total: ITEM_COUNT,
          pageCount: 5,
        });
      }
      expect(needs.pagination.tab).toBe("needs");
      expect(contributions.pagination.tab).toBe("contributions");
      expect(activity.pagination.tab).toBe("activity");
      expectOnlyActiveCollection(needs, "needs");
      expectOnlyActiveCollection(contributions, "contributions");
      expectOnlyActiveCollection(activity, "activity");

      seenNeeds.push(...needs.needs.map((need) => need.id));
      seenContributions.push(
        ...contributions.contributions.map((contribution) => contribution.id),
      );
      seenActivity.push(...activity.activity.map((entry) => entry.id));
    }

    expect(seenNeeds).toEqual([...needIds].sort());
    expect(seenContributions).toEqual([...contributionIds].sort().reverse());
    expect(seenActivity).toEqual([...auditIds].sort().reverse());
    expect(new Set(seenNeeds).size).toBe(ITEM_COUNT);
    expect(new Set(seenContributions).size).toBe(ITEM_COUNT);
    expect(new Set(seenActivity).size).toBe(ITEM_COUNT);
    expect(performance.now() - startedAt).toBeLessThan(3_000);
  });

  it("keeps SQL query count effectively constant from 10 to 100 rows", async () => {
    type QuestionsRow = { Value: number | bigint | string };
    const questions = async () => {
      const rows = await prisma.$queryRawUnsafe<QuestionsRow[]>(
        "SHOW GLOBAL STATUS LIKE 'Questions'",
      );
      return Number(rows[0]?.Value ?? 0);
    };
    const measure = async (tab: ManagedIncidentTab, pageSize: number) => {
      const before = await questions();
      await detail(tab, 1, pageSize);
      const after = await questions();
      return after - before;
    };
    const baseline = async (tab: ManagedIncidentTab, pageSize: number) => {
      const samples: number[] = [];
      for (let sample = 0; sample < 3; sample += 1) {
        samples.push(await measure(tab, pageSize));
      }
      return Math.min(...samples);
    };

    for (const tab of ["needs", "contributions", "activity"] as const) {
      await detail(tab, 1, 10);
      const tenRows = await baseline(tab, 10);
      const hundredRows = await baseline(tab, 100);

      expect(tenRows).toBeGreaterThan(0);
      expect(Math.abs(hundredRows - tenRows)).toBeLessThanOrEqual(5);
      expect(hundredRows).toBeLessThan(50);
    }
  });

  it("uses relevant indexes for each paginated operational collection", async () => {
    type ExplainRow = {
      table: string;
      key: string | null;
      rows: number;
      Extra: string;
    };

    const needPlan = await prisma.$queryRaw<ExplainRow[]>`
      EXPLAIN
      SELECT id
      FROM Need
      WHERE incidentId = ${incidentId}
      ORDER BY priority DESC, createdAt ASC, id ASC
      LIMIT 100
    `;
    expect(needPlan[0]?.key).toBe("Need_incident_priority_created_id_idx");
    expect(needPlan[0]?.Extra ?? "").not.toContain("Using filesort");

    const contributionPlan = await prisma.$queryRaw<ExplainRow[]>`
      EXPLAIN
      SELECT Contribution.id
      FROM Contribution
      INNER JOIN Need ON Need.id = Contribution.needId
      WHERE Need.incidentId = ${incidentId}
        AND Contribution.status = 'PLEDGED'
      ORDER BY Contribution.updatedAt DESC,
               Contribution.createdAt DESC,
               Contribution.id DESC
      LIMIT 100
    `;
    expect(
      contributionPlan.find((row) => row.table === "Contribution")?.key,
    ).toBe("Contribution_queue_status_updated_created_idx");
    expect(contributionPlan.find((row) => row.table === "Need")?.key).toBe(
      "PRIMARY",
    );
    expect(
      contributionPlan.some((row) => row.Extra.includes("Using filesort")),
    ).toBe(false);

    const activityPlan = await prisma.$queryRaw<ExplainRow[]>`
      EXPLAIN
      SELECT id
      FROM AuditLog
      WHERE incidentId = ${incidentId}
      ORDER BY createdAt DESC, id DESC
      LIMIT 100
    `;
    expect(activityPlan[0]?.key).toBe("AuditLog_incidentId_createdAt_idx");
    expect(activityPlan[0]?.Extra ?? "").not.toContain("Using filesort");
  });

  it("projects the same high-volume incident through the public API without N+1", async () => {
    type QuestionsRow = { Value: number | bigint | string };
    const questions = async () => {
      const rows = await prisma.$queryRawUnsafe<QuestionsRow[]>(
        "SHOW GLOBAL STATUS LIKE 'Questions'",
      );
      return Number(rows[0]?.Value ?? 0);
    };

    const before = await questions();
    const startedAt = performance.now();
    const response = await getIncidentApi();
    const elapsedMs = performance.now() - startedAt;
    const after = await questions();
    const payload = (await response.json()) as {
      incidents: Array<{
        id: string;
        needs: Array<{ id: string }>;
        safePoints: Array<{ id: string }>;
      }>;
    };
    const projected = payload.incidents.find(
      (incident) => incident.id === incidentId,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(projected?.needs).toHaveLength(ITEM_COUNT);
    expect(new Set(projected?.needs.map((need) => need.id))).toEqual(
      new Set(needIds),
    );
    expect(projected?.safePoints).toEqual([
      expect.objectContaining({ id: safePointId }),
    ]);
    expect(after - before).toBeGreaterThan(0);
    expect(after - before).toBeLessThan(15);
    expect(elapsedMs).toBeLessThan(3_000);
  });
});
