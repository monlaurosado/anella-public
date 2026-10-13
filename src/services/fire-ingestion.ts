import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import {
  DetectionSource,
  ExternalDetectionStatus,
} from "@/generated/prisma/enums";
import {
  AUTOMATIC_FIRE_SOURCES,
  getAutomaticFireIngestionConfig,
  getEmergencyAutomationConfig,
} from "@/config/env";
import { prisma } from "@/lib/db";
import {
  detectionWithinBounds,
  geographicDistanceMeters,
  parseFirmsFootprintsKmz,
  readFirmsKmzResponse,
  type FirmsFootprintDetection,
} from "@/lib/firms-footprints";
import { isInSpainTerritory } from "@/lib/spain-geography";
import {
  fetchOfficialFireSource,
  type FireSourceResult,
  type NormalizedFireSignal,
  type OfficialFireMunicipality,
  type OfficialFireSourceId,
} from "@/services/fire-source-adapters";
import { planDetectionCandidates } from "@/services/detection-candidates";

const AUTOMATIC_SYNC_LOCK = "anella:automatic-fire-ingestion:v1";
const FIRMS_FOOTPRINT_BASE_URL =
  "https://firms.modaps.eosdis.nasa.gov/api/kml_fire_footprints/europe/24h";
const FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1_000;
const BATCH_SIZE = 500;

type AutomaticFireSource =
  (typeof AUTOMATIC_FIRE_SOURCES)[keyof typeof AUTOMATIC_FIRE_SOURCES];

type PersistedSourceResult = {
  imported: number;
  updated: number;
  statusChanged: number;
  assigned: number;
  unassigned: number;
};

export type AutomaticFireSyncResult = {
  ok: boolean;
  status: "completed" | "busy" | "upstream-unavailable";
  degraded: boolean;
  imported: number;
  updated: number;
  statusChanged: number;
  received: number;
  rejected: number;
  assigned: number;
  unassigned: number;
  generatedAt: string;
  sources: Array<{
    sourceKey: string;
    label: string;
    ok: boolean;
    received: number;
    rejected: number;
    imported: number;
    updated: number;
    statusChanged: number;
    durationMs: number;
    error?: string;
  }>;
};

type NamedLockValue = number | bigint | string | null;

type LocatedMunicipality = OfficialFireMunicipality;

type LocatedSignal = {
  signal: NormalizedFireSignal;
  municipalityId: string | null;
  assignmentDistanceMeters: number | null;
};

function json(value: Record<string, unknown>) {
  return value as Prisma.InputJsonObject;
}

function nasaExternalDetectionId(
  detection: FirmsFootprintDetection,
  product: string,
) {
  return `auto:${createHash("sha256")
    .update(
      [
        product,
        detection.satellite,
        detection.detectedAt.toISOString(),
        detection.latitude.toFixed(5),
        detection.longitude.toFixed(5),
      ].join(":"),
    )
    .digest("hex")}`;
}

function nearestMunicipality(
  detection: Pick<NormalizedFireSignal, "latitude" | "longitude">,
  municipalities: LocatedMunicipality[],
) {
  let nearest: { municipality: LocatedMunicipality; distance: number } | null =
    null;
  for (const municipality of municipalities) {
    const distance = geographicDistanceMeters(detection, municipality);
    if (
      Number.isFinite(distance) &&
      (nearest === null || distance < nearest.distance)
    ) {
      nearest = { municipality, distance };
    }
  }
  return nearest;
}

async function fetchNasaSource(
  source: AutomaticFireSource,
  config: ReturnType<typeof getAutomaticFireIngestionConfig>,
  now: Date,
): Promise<FireSourceResult> {
  const endpoint = `${FIRMS_FOOTPRINT_BASE_URL}/${source.footprintPath}`;
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "application/vnd.google-earth.kmz, application/zip",
        "User-Agent": "Anella/1.0 emergency-coordination",
      },
    });
    if (!response.ok) {
      return {
        sourceKey: source.product,
        label: source.label,
        source: DetectionSource.NASA_FIRMS,
        ok: false,
        received: 0,
        rejected: 0,
        detections: [],
        durationMs: Date.now() - startedAt,
        error: `NASA FIRMS ha respondido con HTTP ${response.status}.`,
      };
    }

    const kmz = await readFirmsKmzResponse(response);
    const parsed = parseFirmsFootprintsKmz(kmz);
    const earliest = now.getTime() - config.maximumAgeHours * 60 * 60 * 1_000;
    const latest = now.getTime() + FUTURE_CLOCK_SKEW_MS;
    const detections = parsed.detections.filter((detection) => {
      const timestamp = detection.detectedAt.getTime();
      return (
        detectionWithinBounds(detection, config.bounds) &&
        isInSpainTerritory(detection) &&
        timestamp >= earliest &&
        timestamp <= latest
      );
    });

    return {
      sourceKey: source.product,
      label: source.label,
      source: DetectionSource.NASA_FIRMS,
      ok: true,
      received: parsed.detections.length,
      rejected:
        parsed.rejected + (parsed.detections.length - detections.length),
      detections: detections.map((detection) => ({
        source: DetectionSource.NASA_FIRMS,
        provider: "NASA_FIRMS",
        externalId: nasaExternalDetectionId(detection, source.product),
        sourceUrl: "https://firms.modaps.eosdis.nasa.gov/",
        latitude: detection.latitude,
        longitude: detection.longitude,
        detectedAt: detection.detectedAt,
        brightness: detection.brightness,
        confidence: detection.confidence,
        satellite: detection.satellite,
        instrument: detection.instrument,
        fireRadiativePowerMw: detection.fireRadiativePowerMw,
        footprintAreaHectares: detection.footprintAreaHectares,
        footprint: detection.footprint,
        rawJson: {
          product: source.product,
          dayNight: detection.dayNight,
          scanKm: detection.scanKm,
          trackKm: detection.trackKm,
          footprintRadiusMeters: detection.footprintRadiusMeters,
          ingestion: "automatic-kmz-footprint-v2",
        },
        mutable: false,
      })),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error(`Automatic FIRMS source failed: ${source.product}`, error);
    return {
      sourceKey: source.product,
      label: source.label,
      source: DetectionSource.NASA_FIRMS,
      ok: false,
      received: 0,
      rejected: 0,
      detections: [],
      durationMs: Date.now() - startedAt,
      error: "No se ha podido obtener o validar la fuente satelital.",
    };
  }
}

function emptyPersistedResult(): PersistedSourceResult {
  return {
    imported: 0,
    updated: 0,
    statusChanged: 0,
    assigned: 0,
    unassigned: 0,
  };
}

function locateSignals(
  signals: NormalizedFireSignal[],
  municipalities: LocatedMunicipality[],
  maximumAssignmentDistance: number,
) {
  let assigned = 0;
  let unassigned = 0;
  const municipalitiesById = new Map(
    municipalities.map((municipality) => [municipality.id, municipality]),
  );
  const located: LocatedSignal[] = signals.map((signal) => {
    const hintedMunicipality = signal.municipalityIdHint
      ? municipalitiesById.get(signal.municipalityIdHint)
      : undefined;
    const nearest = hintedMunicipality
      ? { municipality: hintedMunicipality, distance: 0 }
      : nearestMunicipality(signal, municipalities);
    const municipalityId = hintedMunicipality
      ? hintedMunicipality.id
      : nearest && nearest.distance <= maximumAssignmentDistance
        ? nearest.municipality.id
        : null;
    if (municipalityId) assigned += 1;
    else unassigned += 1;
    return {
      signal,
      municipalityId,
      assignmentDistanceMeters: municipalityId
        ? Math.round(nearest?.distance ?? 0)
        : null,
    };
  });
  return { located, assigned, unassigned };
}

function detectionCreateData(located: LocatedSignal, now: Date) {
  const { signal, municipalityId, assignmentDistanceMeters } = located;
  return {
    source: signal.source,
    provider: signal.provider,
    externalId: signal.externalId,
    sourceUrl: signal.sourceUrl,
    latitude: signal.latitude,
    longitude: signal.longitude,
    detectedAt: signal.detectedAt,
    brightness: signal.brightness,
    confidence: signal.confidence,
    satellite: signal.satellite,
    instrument: signal.instrument,
    fireRadiativePowerMw: signal.fireRadiativePowerMw,
    footprintAreaHectares: signal.footprintAreaHectares,
    footprintJson: signal.footprint as Prisma.InputJsonObject | undefined,
    providerStatus: signal.providerStatus,
    providerStatusChangedAt: signal.providerStatus ? now : undefined,
    lastSeenAt: now,
    status: ExternalDetectionStatus.PENDING,
    municipalityId,
    rawJson: json({
      ...signal.rawJson,
      assignmentDistanceMeters,
    }),
  };
}

async function existingDetections(
  transaction: Prisma.TransactionClient,
  externalIds: string[],
) {
  const rows: Array<{
    externalId: string | null;
    providerStatus: string | null;
    municipalityId: string | null;
  }> = [];
  for (let offset = 0; offset < externalIds.length; offset += BATCH_SIZE) {
    rows.push(
      ...(await transaction.externalDetection.findMany({
        where: {
          externalId: { in: externalIds.slice(offset, offset + BATCH_SIZE) },
        },
        select: {
          externalId: true,
          providerStatus: true,
          municipalityId: true,
        },
      })),
    );
  }
  return new Map(
    rows
      .filter(
        (
          row,
        ): row is {
          externalId: string;
          providerStatus: string | null;
          municipalityId: string | null;
        } => Boolean(row.externalId),
      )
      .map((row) => [
        row.externalId,
        {
          providerStatus: row.providerStatus,
          municipalityId: row.municipalityId,
        },
      ]),
  );
}

async function persistSourceDetections(
  transaction: Prisma.TransactionClient,
  result: FireSourceResult,
  municipalities: LocatedMunicipality[],
  maximumAssignmentDistance: number,
  now: Date,
): Promise<PersistedSourceResult> {
  if (!result.ok || result.detections.length === 0) {
    return emptyPersistedResult();
  }

  const { located, assigned, unassigned } = locateSignals(
    result.detections,
    municipalities,
    maximumAssignmentDistance,
  );
  if (!result.detections.some((detection) => detection.mutable)) {
    const existing = await existingDetections(
      transaction,
      located.map(({ signal }) => signal.externalId),
    );
    let imported = 0;
    const rows = located
      .filter(({ signal }) => !existing.has(signal.externalId))
      .map((signal) => detectionCreateData(signal, now));
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = await transaction.externalDetection.createMany({
        data: rows.slice(offset, offset + BATCH_SIZE),
        skipDuplicates: true,
      });
      imported += batch.count;
    }
    let updated = 0;
    for (const locatedSignal of located) {
      const existingDetection = existing.get(locatedSignal.signal.externalId);
      if (
        !existingDetection ||
        existingDetection.municipalityId ||
        !locatedSignal.municipalityId
      ) {
        continue;
      }
      const assigned = await transaction.externalDetection.updateMany({
        where: {
          externalId: locatedSignal.signal.externalId,
          municipalityId: null,
        },
        data: {
          municipalityId: locatedSignal.municipalityId,
          rawJson: json({
            ...locatedSignal.signal.rawJson,
            assignmentDistanceMeters: locatedSignal.assignmentDistanceMeters,
          }),
        },
      });
      updated += assigned.count;
    }
    return {
      imported,
      updated,
      statusChanged: 0,
      assigned,
      unassigned,
    };
  }

  const existing = await existingDetections(
    transaction,
    located.map(({ signal }) => signal.externalId),
  );
  const additions = located.filter(
    ({ signal }) => !existing.has(signal.externalId),
  );
  let imported = 0;
  const newRows = additions.map((signal) => detectionCreateData(signal, now));
  for (let offset = 0; offset < newRows.length; offset += BATCH_SIZE) {
    const batch = await transaction.externalDetection.createMany({
      data: newRows.slice(offset, offset + BATCH_SIZE),
      skipDuplicates: true,
    });
    imported += batch.count;
  }

  let statusChanged = 0;
  let updated = 0;
  for (const locatedSignal of located) {
    const { signal, municipalityId, assignmentDistanceMeters } = locatedSignal;
    const existingDetection = existing.get(signal.externalId);
    if (!existingDetection) continue;
    const previousStatus = existingDetection.providerStatus;
    const changed = previousStatus !== (signal.providerStatus ?? null);
    if (changed) statusChanged += 1;
    await transaction.externalDetection.update({
      where: { externalId: signal.externalId },
      data: {
        source: signal.source,
        provider: signal.provider,
        sourceUrl: signal.sourceUrl,
        latitude: signal.latitude,
        longitude: signal.longitude,
        detectedAt: signal.detectedAt,
        brightness: signal.brightness ?? null,
        confidence: signal.confidence ?? null,
        satellite: signal.satellite ?? null,
        instrument: signal.instrument ?? null,
        fireRadiativePowerMw: signal.fireRadiativePowerMw ?? null,
        footprintAreaHectares: signal.footprintAreaHectares ?? null,
        ...(signal.footprint
          ? { footprintJson: signal.footprint as Prisma.InputJsonObject }
          : {}),
        providerStatus: signal.providerStatus ?? null,
        ...(changed ? { providerStatusChangedAt: now } : {}),
        lastSeenAt: now,
        municipalityId: existingDetection.municipalityId ?? municipalityId,
        rawJson: json({
          ...signal.rawJson,
          assignmentDistanceMeters,
        }),
      },
    });
    updated += 1;
  }

  return { imported, updated, statusChanged, assigned, unassigned };
}

async function updateSourceHealth(
  transaction: Prisma.TransactionClient,
  result: FireSourceResult,
  persisted: PersistedSourceResult,
  now: Date,
) {
  const status = result.ok ? "HEALTHY" : "FAILED";
  await transaction.externalSourceSync.upsert({
    where: { sourceKey: result.sourceKey },
    create: {
      sourceKey: result.sourceKey,
      source: result.source,
      label: result.label,
      status,
      lastAttemptAt: now,
      lastSuccessAt: result.ok ? now : null,
      lastFailureAt: result.ok ? null : now,
      received: result.received,
      rejected: result.rejected,
      imported: persisted.imported,
      updated: persisted.updated,
      statusChanged: persisted.statusChanged,
      durationMs: result.durationMs,
      error: result.error ?? null,
    },
    update: {
      source: result.source,
      label: result.label,
      status,
      lastAttemptAt: now,
      ...(result.ok ? { lastSuccessAt: now } : { lastFailureAt: now }),
      received: result.received,
      rejected: result.rejected,
      imported: persisted.imported,
      updated: persisted.updated,
      statusChanged: persisted.statusChanged,
      durationMs: result.durationMs,
      error: result.error ?? null,
    },
  });
}

function publicSourceResult(
  result: FireSourceResult,
  persisted: PersistedSourceResult,
) {
  return {
    sourceKey: result.sourceKey,
    label: result.label,
    ok: result.ok,
    received: result.received,
    rejected: result.rejected,
    imported: persisted.imported,
    updated: persisted.updated,
    statusChanged: persisted.statusChanged,
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {}),
  };
}

export async function syncAutomaticFireDetections(
  options: { now?: Date; actorId?: string } = {},
): Promise<AutomaticFireSyncResult> {
  const config = getAutomaticFireIngestionConfig();
  if (!config.enabled) {
    throw new Error("AUTOMATIC_FIRE_INGESTION_DISABLED");
  }
  const now = options.now ?? new Date();
  const actorId = options.actorId?.trim() || undefined;

  const result: AutomaticFireSyncResult = await prisma.$transaction(
    async (transaction) => {
      const lockRows = await transaction.$queryRaw<
        Array<{ acquired: NamedLockValue }>
      >`SELECT GET_LOCK(${AUTOMATIC_SYNC_LOCK}, 0) AS acquired`;
      const lockValue = lockRows[0]?.acquired;
      if (lockValue === null || lockValue === undefined) {
        throw new Error("AUTOMATIC_FIRE_LOCK_UNAVAILABLE");
      }
      if (Number(lockValue) !== 1) {
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "external_detection.automatic_sync_skipped",
            entityType: "ExternalDetection",
            metadata: json({ reason: "overlap" }),
          },
        });
        return {
          ok: false,
          status: "busy",
          degraded: false,
          imported: 0,
          updated: 0,
          statusChanged: 0,
          received: 0,
          rejected: 0,
          assigned: 0,
          unassigned: 0,
          generatedAt: now.toISOString(),
          sources: [],
        };
      }

      try {
        const municipalityRows = await transaction.municipality.findMany({
          where: {
            id: { startsWith: "es-" },
            country: "ES",
            latitude: { not: null },
            longitude: { not: null },
          },
          select: {
            id: true,
            name: true,
            province: true,
            region: true,
            latitude: true,
            longitude: true,
          },
        });
        const municipalities = municipalityRows.map((municipality) => ({
          id: municipality.id,
          name: municipality.name,
          province: municipality.province,
          region: municipality.region,
          latitude: Number(municipality.latitude),
          longitude: Number(municipality.longitude),
        }));
        const sourceResults = await Promise.all([
          ...config.sources.map((source) =>
            fetchNasaSource(source, config, now),
          ),
          ...config.officialSources.map((source) =>
            fetchOfficialFireSource(
              source.sourceKey as OfficialFireSourceId,
              now,
              municipalities,
            ),
          ),
        ]);
        const earliest =
          now.getTime() - config.maximumAgeHours * 60 * 60 * 1_000;
        const latest = now.getTime() + FUTURE_CLOCK_SKEW_MS;
        for (const result of sourceResults) {
          if (!result.ok) continue;
          const accepted = result.detections.filter((detection) => {
            const timestamp = detection.detectedAt.getTime();
            return (
              detectionWithinBounds(detection, config.bounds) &&
              isInSpainTerritory(detection) &&
              timestamp <= latest &&
              (detection.mutable || timestamp >= earliest)
            );
          });
          result.rejected += result.detections.length - accepted.length;
          result.detections = accepted;
        }

        const received = sourceResults.reduce(
          (sum, result) => sum + result.received,
          0,
        );
        const rejected = sourceResults.reduce(
          (sum, result) => sum + result.rejected,
          0,
        );
        const maximumAssignmentDistance = config.assignmentRadiusKm * 1_000;
        const persistedResults = new Map<string, PersistedSourceResult>();
        for (const result of sourceResults) {
          const persisted = await persistSourceDetections(
            transaction,
            result,
            municipalities,
            maximumAssignmentDistance,
            now,
          );
          persistedResults.set(result.sourceKey, persisted);
          await updateSourceHealth(transaction, result, persisted, now);
        }
        const sources = sourceResults.map((result) =>
          publicSourceResult(
            result,
            persistedResults.get(result.sourceKey) ?? emptyPersistedResult(),
          ),
        );

        if (!sourceResults.some((result) => result.ok)) {
          await transaction.auditLog.create({
            data: {
              actorId,
              action: "external_detection.automatic_sync_failed",
              entityType: "ExternalDetection",
              metadata: json({ sources }),
            },
          });
          return {
            ok: false,
            status: "upstream-unavailable",
            degraded: true,
            imported: 0,
            updated: 0,
            statusChanged: 0,
            received,
            rejected,
            assigned: 0,
            unassigned: 0,
            generatedAt: now.toISOString(),
            sources,
          };
        }

        const totals = [...persistedResults.values()].reduce(
          (total, result) => ({
            imported: total.imported + result.imported,
            updated: total.updated + result.updated,
            statusChanged: total.statusChanged + result.statusChanged,
            assigned: total.assigned + result.assigned,
            unassigned: total.unassigned + result.unassigned,
          }),
          emptyPersistedResult(),
        );
        const degraded = sourceResults.some((result) => !result.ok);
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "external_detection.automatic_sync_completed",
            entityType: "ExternalDetection",
            metadata: json({
              received,
              rejected,
              imported: totals.imported,
              updated: totals.updated,
              statusChanged: totals.statusChanged,
              assigned: totals.assigned,
              unassigned: totals.unassigned,
              degraded,
              sources,
            }),
          },
        });

        return {
          ok: true,
          status: "completed",
          degraded,
          imported: totals.imported,
          updated: totals.updated,
          statusChanged: totals.statusChanged,
          received,
          rejected,
          assigned: totals.assigned,
          unassigned: totals.unassigned,
          generatedAt: now.toISOString(),
          sources,
        };
      } finally {
        try {
          const releaseRows = await transaction.$queryRaw<
            Array<{ released: NamedLockValue }>
          >`SELECT RELEASE_LOCK(${AUTOMATIC_SYNC_LOCK}) AS released`;
          if (Number(releaseRows[0]?.released ?? 0) !== 1) {
            console.error(
              "Automatic fire ingestion lock was not released by its owner",
            );
          }
        } catch (error) {
          console.error("Automatic fire ingestion lock release failed", error);
        }
      }
    },
    {
      isolationLevel: "ReadCommitted",
      maxWait: 5_000,
      timeout: 120_000,
    },
  );

  const automation = getEmergencyAutomationConfig();
  if (
    result.ok &&
    (automation.candidateAutomationEnabled ||
      automation.notificationOutboxEnabled)
  ) {
    try {
      await planDetectionCandidates({ now, actorId });
    } catch (error) {
      console.error(
        "Detection candidate planning failed after ingestion",
        error,
      );
      await prisma.auditLog.create({
        data: {
          actorId,
          action: "external_detection.candidate_planning_failed",
          entityType: "ExternalDetection",
          metadata: json({ reason: "planner-error" }),
        },
      });
    }
  }

  return result;
}
