import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ municipalityId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal", () => ({
  requireCoordinator: async () => ({
    id: "queue-load-coordinator",
    name: "Coordinación de carga",
    email: "queue-load@example.test",
    role: "COORDINATOR" as const,
    municipalityId: scope.municipalityId,
    municipalityName: "TEST carga de colas",
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

const DATASET_SIZE = 1_000;
const PAGE_SIZE = 100;
const PAGE_COUNT = DATASET_SIZE / PAGE_SIZE;
const INSERT_CHUNK_SIZE = 250;
const FIXED_TIMESTAMP = new Date("2026-07-13T12:00:00.000Z");

function readPositiveInteger(name: string, fallback: number, minimum: number) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${name} debe ser un entero >= ${minimum}; recibido: ${raw}`,
    );
  }
  return value;
}

const CONCURRENCY = readPositiveInteger("QUEUE_LOAD_CONCURRENCY", 20, 20);
const REQUEST_COUNT = readPositiveInteger(
  "QUEUE_LOAD_REQUESTS",
  Math.max(80, CONCURRENCY),
  Math.max(40, CONCURRENCY),
);
const P95_SLO_MS = readPositiveInteger("QUEUE_LOAD_P95_MS", 3_000, 1);
const P99_SLO_MS = readPositiveInteger("QUEUE_LOAD_P99_MS", 5_000, 1);

type QueueName = "incidents" | "contributions";

type TimedRequest = {
  queue: QueueName;
  durationMs: number;
  error?: string;
};

type LatencySummary = {
  requests: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}

function summarize(requests: TimedRequest[]): LatencySummary {
  const durations = requests.map(({ durationMs }) => durationMs);
  return {
    requests: requests.length,
    p50Ms: roundMs(percentile(durations, 0.5)),
    p95Ms: roundMs(percentile(durations, 0.95)),
    p99Ms: roundMs(percentile(durations, 0.99)),
    maxMs: roundMs(Math.max(0, ...durations)),
  };
}

async function insertInChunks<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
) {
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    await insert(rows.slice(offset, offset + INSERT_CHUNK_SIZE));
  }
}

const loadDescribe =
  process.env.RUN_QUEUE_LOAD === "true" ? describe : describe.skip;

loadDescribe("coordination queue load gate", () => {
  const token = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const titlePrefix = `TEST QUEUE LOAD ${token}`;
  const contributionCodePrefix = `QL${token.slice(-10)}`.toUpperCase();
  const incidentIds = Array.from(
    { length: DATASET_SIZE },
    (_, index) => `queue-load-i-${token}-${String(index).padStart(4, "0")}`,
  );
  const contributionIds = Array.from(
    { length: DATASET_SIZE },
    (_, index) => `queue-load-c-${token}-${String(index).padStart(4, "0")}`,
  );
  let queryCountMetrics = {
    incidents: { pageSize10: 0, pageSize100: 0 },
    contributions: { pageSize10: 0, pageSize100: 0 },
  };

  async function cleanupTenant() {
    if (!scope.municipalityId) return;

    await prisma.incident.deleteMany({
      where: { municipalityId: scope.municipalityId },
    });
    await prisma.municipality.deleteMany({
      where: { id: scope.municipalityId },
    });
    scope.municipalityId = "";
  }

  beforeAll(async () => {
    try {
      const municipality = await prisma.municipality.create({
        data: { name: `TEST queue load tenant ${token}` },
      });
      scope.municipalityId = municipality.id;

      const incidentStatuses = [
        IncidentStatus.ACTIVE,
        IncidentStatus.MONITORING,
        IncidentStatus.DRAFT,
      ];
      const priorities = [
        Priority.LOW,
        Priority.MEDIUM,
        Priority.HIGH,
        Priority.CRITICAL,
      ];
      const incidentRows = incidentIds.map((id, index) => ({
        id,
        publicCode: `QLI-${token}-${String(index).padStart(4, "0")}`,
        title: `${titlePrefix} ${String(index).padStart(4, "0")}`,
        type: IncidentType.OTHER,
        status: incidentStatuses[index % incidentStatuses.length],
        priority: priorities[index % priorities.length],
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        municipalityId: municipality.id,
        lastActivityAt: FIXED_TIMESTAMP,
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
      }));

      await insertInChunks(incidentRows, (data) =>
        prisma.incident.createMany({ data }),
      );

      const safePoint = await prisma.safePoint.create({
        data: {
          id: `queue-load-sp-${token}`,
          incidentId: incidentIds[0],
          municipalityId: municipality.id,
          name: `TEST punto seguro carga ${token}`,
          address: "Dirección segura de simulacro",
          latitude: 41.51,
          longitude: 2.21,
          qrToken: `queue-load-${token}`,
          createdAt: FIXED_TIMESTAMP,
          updatedAt: FIXED_TIMESTAMP,
        },
      });
      const need = await prisma.need.create({
        data: {
          id: `queue-load-need-${token}`,
          incidentId: incidentIds[0],
          safePointId: safePoint.id,
          type: NeedType.OTHER,
          title: `TEST necesidad carga ${token}`,
          quantityNeeded: DATASET_SIZE * 2,
          unit: "uds",
          status: NeedStatus.ACTIVE,
          createdAt: FIXED_TIMESTAMP,
          updatedAt: FIXED_TIMESTAMP,
        },
      });
      const contributionStatuses = [
        ContributionStatus.PLEDGED,
        ContributionStatus.EN_ROUTE,
        ContributionStatus.DELIVERED,
      ];
      const contributionRows = contributionIds.map((id, index) => {
        const status =
          contributionStatuses[index % contributionStatuses.length];
        return {
          id,
          publicCode: `${contributionCodePrefix}${String(index).padStart(4, "0")}`,
          incidentId: incidentIds[0],
          needId: need.id,
          safePointId: safePoint.id,
          citizenName: `TEST ciudadanía carga ${String(index).padStart(4, "0")}`,
          citizenPhone: `+34900${String(index).padStart(6, "0")}`,
          quantity: 1,
          deliveredQuantity: status === ContributionStatus.DELIVERED ? 1 : 0,
          status,
          consentAt: FIXED_TIMESTAMP,
          createdAt: FIXED_TIMESTAMP,
          updatedAt: FIXED_TIMESTAMP,
        };
      });

      await insertInChunks(contributionRows, (data) =>
        prisma.contribution.createMany({ data }),
      );

      const [incidentCount, contributionCount] = await Promise.all([
        prisma.incident.count({
          where: {
            municipalityId: municipality.id,
            title: { startsWith: titlePrefix },
          },
        }),
        prisma.contribution.count({
          where: {
            publicCode: { startsWith: contributionCodePrefix },
            need: { incident: { municipalityId: municipality.id } },
          },
        }),
      ]);
      expect({ incidentCount, contributionCount }).toEqual({
        incidentCount: DATASET_SIZE,
        contributionCount: DATASET_SIZE,
      });
    } catch (error) {
      await cleanupTenant();
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    await cleanupTenant();
  }, 120_000);

  it("walks all 1,000 rows in both queues without hidden truncation", async () => {
    const seenIncidentIds: string[] = [];
    const seenContributionIds: string[] = [];

    for (let page = 1; page <= PAGE_COUNT; page += 1) {
      const [incidents, contributions] = await Promise.all([
        getIncidentQueue({ query: titlePrefix, page, pageSize: PAGE_SIZE }),
        getContributionQueue({
          query: contributionCodePrefix,
          page,
          pageSize: PAGE_SIZE,
        }),
      ]);

      for (const result of [incidents, contributions]) {
        expect(result).toMatchObject({
          total: DATASET_SIZE,
          page,
          pageSize: PAGE_SIZE,
          pageCount: PAGE_COUNT,
        });
        expect(result.items).toHaveLength(PAGE_SIZE);
      }
      seenIncidentIds.push(...incidents.items.map(({ id }) => id));
      seenContributionIds.push(...contributions.items.map(({ id }) => id));
    }

    expect(seenIncidentIds).toEqual([...incidentIds].sort().reverse());
    expect(seenContributionIds).toEqual([...contributionIds].sort().reverse());
    expect(new Set(seenIncidentIds).size).toBe(DATASET_SIZE);
    expect(new Set(seenContributionIds).size).toBe(DATASET_SIZE);

    const [oversizedIncidents, lastContributions] = await Promise.all([
      getIncidentQueue({ query: titlePrefix, page: 1, pageSize: 500 }),
      getContributionQueue({
        query: contributionCodePrefix,
        page: 999_999,
        pageSize: PAGE_SIZE,
      }),
    ]);
    expect(oversizedIncidents).toMatchObject({
      total: DATASET_SIZE,
      pageSize: PAGE_SIZE,
      pageCount: PAGE_COUNT,
    });
    expect(oversizedIncidents.items).toHaveLength(PAGE_SIZE);
    expect(lastContributions).toMatchObject({
      total: DATASET_SIZE,
      page: PAGE_COUNT,
      pageCount: PAGE_COUNT,
    });
    expect(lastContributions.items).toHaveLength(PAGE_SIZE);
  }, 120_000);

  it("keeps query count flat from 10 to 100 rows", async () => {
    type QuestionsRow = { Value: number | bigint | string };
    const questions = async () => {
      const rows = await prisma.$queryRawUnsafe<QuestionsRow[]>(
        "SHOW GLOBAL STATUS LIKE 'Questions'",
      );
      return Number(rows[0]?.Value ?? 0);
    };
    const measureMinimum = async (operation: () => Promise<unknown>) => {
      const samples: number[] = [];
      for (let sample = 0; sample < 3; sample += 1) {
        const before = await questions();
        await operation();
        const after = await questions();
        samples.push(after - before);
      }
      return Math.min(...samples);
    };

    await Promise.all([
      getIncidentQueue({ query: titlePrefix, pageSize: PAGE_SIZE }),
      getContributionQueue({
        query: contributionCodePrefix,
        pageSize: PAGE_SIZE,
      }),
    ]);

    const incidentTen = await measureMinimum(() =>
      getIncidentQueue({ query: titlePrefix, pageSize: 10 }),
    );
    const incidentHundred = await measureMinimum(() =>
      getIncidentQueue({ query: titlePrefix, pageSize: PAGE_SIZE }),
    );
    const contributionTen = await measureMinimum(() =>
      getContributionQueue({ query: contributionCodePrefix, pageSize: 10 }),
    );
    const contributionHundred = await measureMinimum(() =>
      getContributionQueue({
        query: contributionCodePrefix,
        pageSize: PAGE_SIZE,
      }),
    );
    queryCountMetrics = {
      incidents: {
        pageSize10: incidentTen,
        pageSize100: incidentHundred,
      },
      contributions: {
        pageSize10: contributionTen,
        pageSize100: contributionHundred,
      },
    };

    expect(incidentTen).toBeGreaterThan(0);
    expect(contributionTen).toBeGreaterThan(0);
    expect(incidentHundred).toBeLessThanOrEqual(incidentTen + 3);
    expect(contributionHundred).toBeLessThanOrEqual(contributionTen + 3);
    expect(incidentHundred).toBeLessThan(30);
    expect(contributionHundred).toBeLessThan(30);
  }, 120_000);

  it("uses the queue ordering indexes", async () => {
    const [incidentPlan, contributionPlan] = await Promise.all([
      prisma.$queryRaw<Array<{ key: string | null; Extra: string }>>`
        EXPLAIN
        SELECT id, publicCode, title, status, priority, lastActivityAt
        FROM Incident
        WHERE municipalityId = ${scope.municipalityId}
          AND status = 'ACTIVE'
        ORDER BY lastActivityAt DESC, createdAt DESC, id DESC
        LIMIT 100
      `,
      prisma.$queryRaw<Array<{ key: string | null; Extra: string }>>`
        EXPLAIN
        SELECT id, publicCode, status, updatedAt, createdAt
        FROM Contribution
        WHERE status = 'PLEDGED'
        ORDER BY updatedAt DESC, createdAt DESC, id DESC
        LIMIT 100
      `,
    ]);

    expect(incidentPlan[0]?.key).toBe("Incident_tenant_status_activity_idx");
    expect(incidentPlan[0]?.Extra ?? "").not.toContain("Using filesort");
    expect(contributionPlan[0]?.key).toBe(
      "Contribution_queue_status_updated_created_idx",
    );
    expect(contributionPlan[0]?.Extra ?? "").not.toContain("Using filesort");
  }, 120_000);

  it("meets the local latency SLO with at least 20 concurrent requests", async () => {
    await Promise.all([
      getIncidentQueue({ query: titlePrefix, pageSize: PAGE_SIZE }),
      getContributionQueue({
        query: contributionCodePrefix,
        pageSize: PAGE_SIZE,
      }),
    ]);

    let cursor = 0;
    const samples: TimedRequest[] = [];
    const loadStartedAt = performance.now();
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < REQUEST_COUNT) {
          const requestIndex = cursor;
          cursor += 1;
          const queue: QueueName =
            requestIndex % 2 === 0 ? "incidents" : "contributions";
          const page = (Math.floor(requestIndex / 2) % PAGE_COUNT) + 1;
          const startedAt = performance.now();

          try {
            const result =
              queue === "incidents"
                ? await getIncidentQueue({
                    query: titlePrefix,
                    page,
                    pageSize: PAGE_SIZE,
                  })
                : await getContributionQueue({
                    query: contributionCodePrefix,
                    page,
                    pageSize: PAGE_SIZE,
                  });
            if (
              result.total !== DATASET_SIZE ||
              result.page !== page ||
              result.items.length !== PAGE_SIZE
            ) {
              throw new Error(
                `Respuesta incompleta: total=${result.total}, page=${result.page}, items=${result.items.length}`,
              );
            }
            samples.push({
              queue,
              durationMs: performance.now() - startedAt,
            });
          } catch (error) {
            samples.push({
              queue,
              durationMs: performance.now() - startedAt,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }),
    );
    const elapsedMs = performance.now() - loadStartedAt;
    const failures = samples.filter(({ error }) => error !== undefined);
    const successful = samples.filter(({ error }) => error === undefined);
    const summary = summarize(successful);
    const metrics = {
      dataset: {
        incidents: DATASET_SIZE,
        contributions: DATASET_SIZE,
      },
      concurrency: CONCURRENCY,
      requests: REQUEST_COUNT,
      elapsedMs: roundMs(elapsedMs),
      throughputPerSecond: roundMs(REQUEST_COUNT / (elapsedMs / 1_000)),
      errors: failures.length,
      errorRate: roundMs(failures.length / REQUEST_COUNT),
      latency: summary,
      queryCounts: queryCountMetrics,
      byQueue: {
        incidents: summarize(
          successful.filter(({ queue }) => queue === "incidents"),
        ),
        contributions: summarize(
          successful.filter(({ queue }) => queue === "contributions"),
        ),
      },
      slo: {
        p95Ms: P95_SLO_MS,
        p99Ms: P99_SLO_MS,
        errors: 0,
      },
      failureMessages: [...new Set(failures.map(({ error }) => error))],
    };

    console.info(`[queue-load] ${JSON.stringify(metrics)}`);

    expect(samples).toHaveLength(REQUEST_COUNT);
    expect(failures).toHaveLength(0);
    expect(summary.p95Ms).toBeLessThanOrEqual(P95_SLO_MS);
    expect(summary.p99Ms).toBeLessThanOrEqual(P99_SLO_MS);
  }, 120_000);
});
