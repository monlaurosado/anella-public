import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCoordinator: vi.fn(),
  config: vi.fn(),
  detectionFindMany: vi.fn(),
  healthFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/env", () => ({
  getAutomaticFireIngestionConfig: mocks.config,
}));
vi.mock("@/lib/dal", () => ({
  assertCoordinator: mocks.assertCoordinator,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    externalDetection: { findMany: mocks.detectionFindMany },
    externalSourceSync: { findMany: mocks.healthFindMany },
  },
}));

import {
  getFireDetectionMap,
  getPublicFireDetectionMap,
} from "@/services/fire-detection-map";

const now = new Date("2026-07-14T18:00:00.000Z");

describe("multifeed fire map", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.assertCoordinator.mockReset().mockResolvedValue({
      role: "COORDINATOR",
      municipalityId: "municipality-1",
    });
    mocks.config.mockReset().mockReturnValue({
      maximumAgeHours: 24,
      intervalMinutes: 5,
      sources: [{ product: "VIIRS_SNPP_NRT", label: "NASA VIIRS Suomi-NPP" }],
      officialSources: [
        { sourceKey: "JCYL", label: "Junta de Castilla y León" },
        { sourceKey: "INFOCA", label: "Plan INFOCA · Andalucía" },
      ],
    });
    mocks.detectionFindMany.mockReset().mockResolvedValue([
      {
        id: "official-1",
        source: "CIVIL_PROTECTION",
        provider: "INFOCA",
        providerStatus: "ACTIVE",
        providerStatusChangedAt: new Date("2026-07-14T17:55:00.000Z"),
        latitude: 36.701317,
        longitude: -6.322042,
        detectedAt: new Date("2026-07-14T16:31:00.000Z"),
        confidence: "official",
        status: "PENDING",
        satellite: null,
        instrument: "PARTE_OFICIAL",
        fireRadiativePowerMw: null,
        footprintAreaHectares: null,
        footprintJson: null,
        rawJson: {
          municipality: "Rota",
          incidentType: "IIFF INCENDIOS FORESTALES",
          sourceUpdatedAt: "2026-07-14T17:56:00.000Z",
        },
        municipality: { name: "Rota" },
      },
    ]);
    mocks.healthFindMany.mockReset().mockResolvedValue([
      {
        sourceKey: "VIIRS_SNPP_NRT",
        status: "HEALTHY",
        lastAttemptAt: new Date("2026-07-14T17:30:00.000Z"),
        lastSuccessAt: new Date("2026-07-14T17:30:00.000Z"),
        received: 10,
        imported: 1,
        updated: 0,
        statusChanged: 0,
      },
      {
        sourceKey: "JCYL",
        status: "HEALTHY",
        lastAttemptAt: new Date("2026-07-14T17:58:00.000Z"),
        lastSuccessAt: new Date("2026-07-14T17:58:00.000Z"),
        received: 2,
        imported: 0,
        updated: 2,
        statusChanged: 1,
      },
      {
        sourceKey: "INFOCA",
        status: "FAILED",
        lastAttemptAt: new Date("2026-07-14T17:59:00.000Z"),
        lastSuccessAt: new Date("2026-07-14T17:50:00.000Z"),
        received: 0,
        imported: 0,
        updated: 0,
        statusChanged: 0,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps provider state separate and exposes source freshness", async () => {
    const result = await getFireDetectionMap();

    expect(result.features[0]).toMatchObject({
      properties: {
        source: "CIVIL_PROTECTION",
        provider: "INFOCA",
        providerStatus: "ACTIVE",
        fireType: "FOREST",
        sourceUpdatedAt: "2026-07-14T17:56:00.000Z",
        status: "PENDING",
        municipalityName: "Rota",
        footprintRadiusMeters: 650,
      },
    });
    expect(
      result.sourceHealth.map(({ sourceKey, status }) => ({
        sourceKey,
        status,
      })),
    ).toEqual([
      { sourceKey: "VIIRS_SNPP_NRT", status: "stale" },
      { sourceKey: "JCYL", status: "healthy" },
      { sourceKey: "INFOCA", status: "degraded" },
    ]);
    expect(result.overallStatus).toBe("stale");
  });

  it("scopes both open and recently extinguished signals to the coordinator's municipality", async () => {
    await getFireDetectionMap();

    const query = mocks.detectionFindMany.mock.calls[0]?.[0];
    expect(query.where.municipalityId).toBe("municipality-1");
    expect(query.where.status.in).toEqual(["PENDING", "LINKED"]);
    expect(query.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerStatus: {
            in: expect.arrayContaining(["ACTIVE", "CONTROLLED"]),
          },
        }),
        expect.objectContaining({ providerStatus: "EXTINGUISHED" }),
      ]),
    );
  });

  it("returns the complete Spain-wide layer to a super admin without a municipality filter", async () => {
    mocks.assertCoordinator.mockResolvedValue({
      role: "SUPER_ADMIN",
      municipalityId: null,
    });

    await getFireDetectionMap();

    const query = mocks.detectionFindMany.mock.calls[0]?.[0];
    expect(query.where).not.toHaveProperty("municipalityId");
    expect(query).not.toHaveProperty("take");
  });

  it("publishes the complete safe projection without requiring authentication", async () => {
    mocks.assertCoordinator.mockClear();
    mocks.assertCoordinator.mockRejectedValue(new Error("UNAUTHORIZED"));

    const result = await getPublicFireDetectionMap();

    expect(mocks.assertCoordinator).not.toHaveBeenCalled();
    const query = mocks.detectionFindMany.mock.calls[0]?.[0];
    expect(query.where).not.toHaveProperty("municipalityId");
    expect(query).not.toHaveProperty("take");
    expect(result.features[0]).not.toHaveProperty("properties.rawJson");
    expect(result.features[0]).not.toHaveProperty(
      "properties.linkedIncidentId",
    );
    expect(result.features[0]).not.toHaveProperty("properties.status");
  });

  it("never projects stored detections outside Spanish territory", async () => {
    mocks.detectionFindMany.mockResolvedValue([
      {
        id: "spain-1",
        source: "CIVIL_PROTECTION",
        provider: "INFOCA",
        providerStatus: "ACTIVE",
        providerStatusChangedAt: new Date("2026-07-14T17:55:00.000Z"),
        latitude: 36.701317,
        longitude: -6.322042,
        detectedAt: new Date("2026-07-14T16:31:00.000Z"),
        confidence: "official",
        status: "PENDING",
        satellite: null,
        instrument: "PARTE_OFICIAL",
        fireRadiativePowerMw: null,
        footprintAreaHectares: null,
        footprintJson: null,
        rawJson: {},
        municipality: { name: "Rota" },
      },
      {
        id: "africa-1",
        source: "NASA_FIRMS",
        provider: "NASA_FIRMS",
        providerStatus: null,
        providerStatusChangedAt: null,
        latitude: 35.204,
        longitude: 0.333,
        detectedAt: new Date("2026-07-14T16:31:00.000Z"),
        confidence: "nominal",
        status: "PENDING",
        satellite: "NOAA-21",
        instrument: "VIIRS",
        fireRadiativePowerMw: null,
        footprintAreaHectares: null,
        footprintJson: null,
        rawJson: {},
        municipality: null,
      },
    ]);

    const result = await getPublicFireDetectionMap();

    expect(result.features.map((feature) => feature.id)).toEqual(["spain-1"]);
  });
});
