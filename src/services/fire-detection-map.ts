import "server-only";

import { z } from "zod";

import { getAutomaticFireIngestionConfig } from "@/config/env";
import { ExternalDetectionStatus } from "@/generated/prisma/enums";
import { assertCoordinator } from "@/lib/dal";
import { prisma } from "@/lib/db";
import {
  FIRE_PROVIDER_STATUSES,
  OPEN_FIRE_PROVIDER_STATUSES,
} from "@/lib/fire-provider-status";
import { isInSpainTerritory } from "@/lib/spain-geography";
import type {
  FireDataSourceHealth,
  FireDetectionFeatureCollection,
  FireDetectionMapFeature,
  FireSignalType,
} from "@/types/domain";

const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const footprintSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(coordinateSchema).min(4).max(64)).length(1),
  })
  .strict();

function validatedFootprint(
  value: unknown,
  center: { latitude: number; longitude: number },
): [Array<[number, number]>] | null {
  const parsed = footprintSchema.safeParse(value);
  if (!parsed.success) return null;
  const ring = parsed.data.coordinates[0];
  const first = ring?.[0];
  const last = ring?.at(-1);
  if (
    !ring ||
    !first ||
    !last ||
    first[0] !== last[0] ||
    first[1] !== last[1] ||
    ring.some(
      ([longitude, latitude]) =>
        Math.abs(longitude - center.longitude) > 0.5 ||
        Math.abs(latitude - center.latitude) > 0.5,
    )
  ) {
    return null;
  }
  return [ring];
}

type FireDetectionMapInput = {
  municipalityId?: string | null;
};

function normalizedMunicipalityId(input: FireDetectionMapInput) {
  return input.municipalityId?.trim().slice(0, 191) || undefined;
}

function normalizedFireType(
  source: string,
  incidentType: string | undefined,
): FireSignalType | undefined {
  if (source === "NASA_FIRMS") return "THERMAL";
  if (!incidentType) return undefined;
  const normalized = incidentType
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (normalized.includes("AGRIC")) return "AGRICULTURAL";
  if (normalized.includes("URBAN")) return "URBAN";
  if (normalized.includes("FOREST")) return "FOREST";
  return undefined;
}

async function buildFireDetectionMap(
  municipalityId?: string,
  includeWorkflowStatus = false,
): Promise<FireDetectionFeatureCollection> {
  const config = getAutomaticFireIngestionConfig();
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - config.maximumAgeHours * 60 * 60 * 1_000,
  );
  const latest = new Date(now.getTime() + 10 * 60 * 1_000);
  const freshnessWindowMs =
    Math.max(20, config.intervalMinutes * 3) * 60 * 1_000;
  const officialFreshnessCutoff = new Date(now.getTime() - freshnessWindowMs);
  const recentlyClosedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const configuredSources = [
    ...config.sources.map((source) => ({
      sourceKey: source.product,
      label: source.label,
    })),
    ...config.officialSources.map((source) => ({
      sourceKey: source.sourceKey,
      label: source.label,
    })),
  ];
  const [detections, healthRows] = await Promise.all([
    prisma.externalDetection.findMany({
      where: {
        status: {
          in: [ExternalDetectionStatus.PENDING, ExternalDetectionStatus.LINKED],
        },
        OR: [
          {
            providerStatus: null,
            detectedAt: { gte: cutoff, lte: latest },
          },
          {
            providerStatus: { in: OPEN_FIRE_PROVIDER_STATUSES },
            lastSeenAt: { gte: officialFreshnessCutoff },
            detectedAt: { lte: latest },
          },
          {
            providerStatus: "EXTINGUISHED",
            providerStatusChangedAt: { gte: recentlyClosedCutoff },
            lastSeenAt: { gte: officialFreshnessCutoff },
            detectedAt: { lte: latest },
          },
        ],
        ...(municipalityId ? { municipalityId } : {}),
      },
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        source: true,
        provider: true,
        providerStatus: true,
        providerStatusChangedAt: true,
        latitude: true,
        longitude: true,
        detectedAt: true,
        confidence: true,
        status: true,
        satellite: true,
        instrument: true,
        fireRadiativePowerMw: true,
        footprintAreaHectares: true,
        footprintJson: true,
        rawJson: true,
        municipality: { select: { name: true } },
      },
    }),
    prisma.externalSourceSync.findMany({
      where: {
        sourceKey: { in: configuredSources.map((source) => source.sourceKey) },
      },
      select: {
        sourceKey: true,
        status: true,
        lastAttemptAt: true,
        lastSuccessAt: true,
        received: true,
        imported: true,
        updated: true,
        statusChanged: true,
      },
    }),
  ]);

  const nationalDetections = detections.filter((detection) =>
    isInSpainTerritory({
      latitude: Number(detection.latitude),
      longitude: Number(detection.longitude),
    }),
  );

  const features: FireDetectionMapFeature[] = nationalDetections.map((detection) => {
    const latitude = Number(detection.latitude);
    const longitude = Number(detection.longitude);
    const footprint = validatedFootprint(detection.footprintJson, {
      latitude,
      longitude,
    });
    const raw = z
      .object({
        footprintRadiusMeters: z.number().positive().max(50_000),
        municipality: z.string().trim().min(1).max(191),
        incidentType: z.string().trim().min(1).max(191),
        sourceUpdatedAt: z.string().trim().min(1).max(64),
      })
      .partial()
      .safeParse(detection.rawJson);
    const providerStatus = z
      .enum(FIRE_PROVIDER_STATUSES)
      .safeParse(detection.providerStatus);
    const area = detection.footprintAreaHectares
      ? Number(detection.footprintAreaHectares)
      : undefined;
    const areaRadius = area ? Math.sqrt((area * 10_000) / Math.PI) : undefined;
    const radius = Math.round(
      raw.success && raw.data.footprintRadiusMeters
        ? raw.data.footprintRadiusMeters
        : (areaRadius ?? 188),
    );
    const source =
      detection.source === "NASA_FIRMS" ||
      detection.source === "EFFIS" ||
      detection.source === "CIVIL_PROTECTION"
        ? detection.source
        : "OTHER";
    const sourceUpdatedAt =
      raw.success && raw.data.sourceUpdatedAt
        ? new Date(raw.data.sourceUpdatedAt)
        : null;
    const fireType = normalizedFireType(
      detection.source,
      raw.success ? raw.data.incidentType : undefined,
    );
    const municipalityName =
      detection.municipality?.name ??
      (raw.success ? raw.data.municipality : undefined);

    return {
      type: "Feature",
      id: detection.id,
      geometry: footprint
        ? { type: "Polygon", coordinates: footprint }
        : { type: "Point", coordinates: [longitude, latitude] },
      properties: {
        source,
        provider: detection.provider ?? detection.source,
        detectedAt: detection.detectedAt.toISOString(),
        ...(sourceUpdatedAt && !Number.isNaN(sourceUpdatedAt.getTime())
          ? { sourceUpdatedAt: sourceUpdatedAt.toISOString() }
          : {}),
        ...(detection.confidence ? { confidence: detection.confidence } : {}),
        ...(fireType ? { fireType } : {}),
        ...(includeWorkflowStatus
          ? { status: detection.status as "PENDING" | "LINKED" }
          : {}),
        ...(providerStatus.success
          ? { providerStatus: providerStatus.data }
          : {}),
        ...(detection.providerStatusChangedAt
          ? {
              providerStatusChangedAt:
                detection.providerStatusChangedAt.toISOString(),
            }
          : {}),
        ...(detection.satellite ? { satellite: detection.satellite } : {}),
        ...(detection.instrument ? { instrument: detection.instrument } : {}),
        ...(detection.fireRadiativePowerMw
          ? {
              fireRadiativePowerMw: Number(detection.fireRadiativePowerMw),
            }
          : {}),
        ...(area ? { footprintAreaHectares: area } : {}),
        footprintRadiusMeters:
          detection.source === "CIVIL_PROTECTION"
            ? Math.max(radius, 650)
            : radius,
        ...(municipalityName ? { municipalityName } : {}),
      },
    };
  });

  const healthBySource = new Map(
    healthRows.map((health) => [health.sourceKey, health]),
  );
  const sourceHealth: FireDataSourceHealth[] = configuredSources.map(
    (configured) => {
      const health = healthBySource.get(configured.sourceKey);
      if (!health) {
        return {
          ...configured,
          status: "pending" as const,
          received: 0,
          imported: 0,
          updated: 0,
          statusChanged: 0,
        };
      }
      const stale =
        !health.lastSuccessAt ||
        health.lastSuccessAt.getTime() < officialFreshnessCutoff.getTime();
      return {
        ...configured,
        status: stale
          ? ("stale" as const)
          : health.status === "HEALTHY"
            ? ("healthy" as const)
            : ("degraded" as const),
        lastAttemptAt: health.lastAttemptAt.toISOString(),
        ...(health.lastSuccessAt
          ? { lastSuccessAt: health.lastSuccessAt.toISOString() }
          : {}),
        received: health.received,
        imported: health.imported,
        updated: health.updated,
        statusChanged: health.statusChanged,
      };
    },
  );
  const overallStatus = sourceHealth.every(
    (source) => source.status === "pending",
  )
    ? "pending"
    : sourceHealth.some((source) => source.status === "stale")
      ? "stale"
      : sourceHealth.some((source) => source.status !== "healthy")
        ? "degraded"
        : "healthy";

  return {
    type: "FeatureCollection",
    features,
    sourceHealth,
    overallStatus,
    generatedAt: now.toISOString(),
    refreshAfterSeconds: 60,
  };
}

/**
 * Proyección cartográfica anónima y nacional. Solo contiene geometría,
 * procedencia, estado agregado y fecha; nunca expone rawJson, enlaces internos
 * ni información de recursos de intervención.
 */
export async function getPublicFireDetectionMap(
  input: FireDetectionMapInput = {},
) {
  return buildFireDetectionMap(normalizedMunicipalityId(input));
}

export async function getFireDetectionMap(input: FireDetectionMapInput = {}) {
  const coordinator = await assertCoordinator();
  const requestedMunicipalityId = normalizedMunicipalityId(input);
  const municipalityId =
    coordinator.role === "SUPER_ADMIN"
      ? requestedMunicipalityId
      : (coordinator.municipalityId ?? "__none__");

  return buildFireDetectionMap(municipalityId, true);
}
