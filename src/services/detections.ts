import "server-only";

import { getFirmsConfig } from "@/config/env";
import type { Prisma } from "@/generated/prisma/client";
import {
  DetectionSource,
  ExternalDetectionStatus,
} from "@/generated/prisma/enums";
import { requireCoordinator } from "@/lib/dal";
import { prisma } from "@/lib/db";
import {
  FIRMS_RESPONSE_LIMITS,
  FirmsPayloadFormatError,
  FirmsPayloadLimitError,
  firmsDetectionDate,
  firmsExternalId,
  parseFirmsCsv,
  readFirmsCsvResponse,
  type FirmsDetection,
} from "@/lib/firms";
import { isInSpainTerritory } from "@/lib/spain-geography";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [10, 25, 50, 100] as const;
const OFFICIAL_SPANISH_MUNICIPALITY_PREFIX = "es-";
const MUNICIPALITY_SUGGESTION_LIMIT = 12;

type DetectionQueueFilters = {
  municipalityId?: string;
  municipalityQuery?: string;
  page?: string | number;
  pageSize?: string | number;
};

function positiveInteger(value: string | number | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 999_999
    ? parsed
    : fallback;
}

function detectionPageSize(value: string | number | undefined) {
  const parsed = positiveInteger(value, DEFAULT_PAGE_SIZE);
  return PAGE_SIZES.includes(parsed as (typeof PAGE_SIZES)[number])
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

async function searchOfficialMunicipalities(query: string) {
  if (query.length < 2) return [];
  const officialScope = {
    id: { startsWith: OFFICIAL_SPANISH_MUNICIPALITY_PREFIX },
    country: "ES",
  } satisfies Prisma.MunicipalityWhereInput;
  const select = {
    id: true,
    name: true,
    province: true,
    region: true,
  } as const;
  const orderBy = [
    { name: "asc" as const },
    { province: "asc" as const },
    { id: "asc" as const },
  ];
  const [exact, startsWith, broad] = await Promise.all([
    prisma.municipality.findMany({
      where: { ...officialScope, name: query },
      select,
      orderBy,
      take: MUNICIPALITY_SUGGESTION_LIMIT,
    }),
    prisma.municipality.findMany({
      where: { ...officialScope, name: { startsWith: query } },
      select,
      orderBy,
      take: MUNICIPALITY_SUGGESTION_LIMIT,
    }),
    prisma.municipality.findMany({
      where: {
        ...officialScope,
        OR: [
          { name: { contains: query } },
          { province: { contains: query } },
          { region: { contains: query } },
        ],
      },
      select,
      orderBy,
      take: MUNICIPALITY_SUGGESTION_LIMIT,
    }),
  ]);
  const unique = new Map(
    [...exact, ...startsWith, ...broad].map((municipality) => [
      municipality.id,
      municipality,
    ]),
  );
  return [...unique.values()].slice(0, MUNICIPALITY_SUGGESTION_LIMIT);
}

function failedFirmsFetch(reason: string) {
  return {
    ok: false as const,
    reason,
    detections: [] as FirmsDetection[],
    rejected: [] as string[],
  };
}

function firmsPayloadErrorReason(error: unknown) {
  if (error instanceof FirmsPayloadLimitError) {
    return error.limit === "bytes"
      ? `La respuesta de NASA FIRMS supera el límite seguro de ${Math.floor(error.maximum / (1024 * 1024))} MiB. No se ha importado ninguna señal.`
      : `La respuesta de NASA FIRMS supera el límite seguro de ${error.maximum.toLocaleString("es-ES")} filas. No se ha importado ninguna señal.`;
  }
  if (error instanceof FirmsPayloadFormatError) {
    return "NASA FIRMS ha devuelto una respuesta de texto no válida. No se ha importado ninguna señal.";
  }
  return null;
}

async function municipalitiesForCoordinator() {
  const coordinator = await requireCoordinator();
  const municipalities =
    coordinator.role === "SUPER_ADMIN"
      ? await prisma.municipality.findMany({
          where: {
            id: { startsWith: OFFICIAL_SPANISH_MUNICIPALITY_PREFIX },
            country: "ES",
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : await prisma.municipality.findMany({
          where: { id: coordinator.municipalityId ?? "__none__" },
          select: { id: true, name: true },
        });

  return { coordinator, municipalities };
}

export async function fetchNasaFirmsDetections() {
  const { apiKey, source, bounds } = getFirmsConfig();

  if (!apiKey) {
    return failedFirmsFetch("NASA FIRMS no está configurado.");
  }

  const area = [bounds.west, bounds.south, bounds.east, bounds.north].join(",");
  const endpoint = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(
    apiKey,
  )}/${encodeURIComponent(source)}/${area}/1`;

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Anella/1.0 emergency-coordination" },
    });

    if (!response.ok) {
      return failedFirmsFetch(
        `NASA FIRMS ha respondido con HTTP ${response.status}.`,
      );
    }

    let csv: string;
    try {
      csv = await readFirmsCsvResponse(response, FIRMS_RESPONSE_LIMITS);
    } catch (error) {
      const reason = firmsPayloadErrorReason(error);
      if (reason) return failedFirmsFetch(reason);
      throw error;
    }

    if (/invalid map_key|error in processing/i.test(csv)) {
      return failedFirmsFetch(
        "NASA FIRMS ha rechazado la clave o los parámetros.",
      );
    }

    let parsed: ReturnType<typeof parseFirmsCsv>;
    try {
      parsed = parseFirmsCsv(csv, FIRMS_RESPONSE_LIMITS);
    } catch (error) {
      const reason = firmsPayloadErrorReason(error);
      return failedFirmsFetch(
        reason ??
          "NASA FIRMS ha devuelto un CSV no válido. No se ha importado ninguna señal.",
      );
    }
    const outsideSpain = parsed.detections.filter(
      (detection) => !isInSpainTerritory(detection),
    );
    return {
      ok: true as const,
      ...parsed,
      detections: parsed.detections.filter(isInSpainTerritory),
      rejected: [
        ...parsed.rejected,
        ...outsideSpain.map(
          (detection) =>
            `Señal fuera de España: ${detection.latitude.toFixed(4)}, ${detection.longitude.toFixed(4)}.`,
        ),
      ],
      source,
    };
  } catch (error) {
    console.error("FIRMS sync failed", error);
    return failedFirmsFetch("No se ha podido contactar con NASA FIRMS.");
  }
}

/**
 * Importa señales en un ámbito municipal decidido por una persona coordinadora.
 * No existe un valor por defecto ni se admiten señales globales.
 */
export async function syncNasaFirmsDetections(input: {
  municipalityId: string;
  actorId: string;
}) {
  const municipalityId = input.municipalityId.trim();
  const actorId = input.actorId.trim();
  if (!municipalityId || !actorId) {
    return {
      ok: false as const,
      reason:
        "Debes indicar el municipio y la cuenta responsable de la importación.",
      detections: [] as FirmsDetection[],
      rejected: [] as string[],
    };
  }

  const municipality = await prisma.municipality.findUnique({
    where: { id: municipalityId },
    select: { id: true, name: true },
  });
  if (!municipality) {
    return {
      ok: false as const,
      reason: "El municipio seleccionado no existe.",
      detections: [] as FirmsDetection[],
      rejected: [] as string[],
    };
  }

  const result = await fetchNasaFirmsDetections();

  if (!result.ok) {
    await prisma.auditLog.create({
      data: {
        actorId,
        municipalityId: municipality.id,
        action: "external_detection.sync_failed",
        entityType: "ExternalDetection",
        metadata: {
          municipality: municipality.name,
          reason: result.reason,
        },
      },
    });
    return result;
  }

  const observedAt = new Date();
  const data = result.detections.map((detection) => ({
    source: DetectionSource.NASA_FIRMS,
    provider: "NASA_FIRMS",
    // La identidad incluye el municipio: una misma lectura puede ser revisada
    // de forma independiente si dos municipios deciden importarla.
    externalId: `${municipality.id}:${firmsExternalId(detection, result.source)}`,
    sourceUrl: "https://firms.modaps.eosdis.nasa.gov/",
    latitude: detection.latitude,
    longitude: detection.longitude,
    detectedAt: firmsDetectionDate(detection),
    brightness: detection.bright_ti4,
    confidence: detection.confidence,
    satellite: detection.satellite,
    instrument: detection.instrument,
    fireRadiativePowerMw: detection.frp,
    lastSeenAt: observedAt,
    status: ExternalDetectionStatus.PENDING,
    municipalityId: municipality.id,
    rawJson: JSON.parse(JSON.stringify(detection)),
  }));

  const imported = await prisma.$transaction(async (transaction) => {
    // Los lotes evitan superar el tamaño de paquete de MySQL, pero se recorren
    // todas las filas dentro de la misma transacción: señal y auditoría se
    // confirman juntas y no existe un límite funcional oculto.
    let count = 0;
    for (let offset = 0; offset < data.length; offset += 500) {
      const batch = await transaction.externalDetection.createMany({
        data: data.slice(offset, offset + 500),
        skipDuplicates: true,
      });
      count += batch.count;
    }

    await transaction.auditLog.create({
      data: {
        actorId,
        municipalityId: municipality.id,
        action: "external_detection.sync_completed",
        entityType: "ExternalDetection",
        metadata: {
          municipality: municipality.name,
          rowsReceived: result.detections.length,
          rowsRejected: result.rejected.length,
          imported: count,
        },
      },
    });

    return count;
  });

  return { ...result, imported };
}

export async function getDetectionQueue(filters: DetectionQueueFilters = {}) {
  const coordinator = await requireCoordinator();
  const requestedMunicipalityId = String(filters.municipalityId ?? "").trim();
  const municipalityQuery = String(filters.municipalityQuery ?? "")
    .trim()
    .slice(0, 80);
  const canUseNationalScope = coordinator.role === "SUPER_ADMIN";
  const selectedMunicipality = canUseNationalScope
    ? requestedMunicipalityId
      ? await prisma.municipality.findUnique({
          where: { id: requestedMunicipalityId },
          select: {
            id: true,
            name: true,
            province: true,
            region: true,
          },
        })
      : null
    : coordinator.municipalityId
      ? await prisma.municipality.findUnique({
          where: { id: coordinator.municipalityId },
          select: {
            id: true,
            name: true,
            province: true,
            region: true,
          },
        })
      : null;
  const municipalityId = selectedMunicipality?.id ?? null;
  const municipalitySelectionInvalid =
    canUseNationalScope &&
    Boolean(requestedMunicipalityId) &&
    !selectedMunicipality;
  const municipalities = canUseNationalScope
    ? await searchOfficialMunicipalities(municipalityQuery)
    : selectedMunicipality
      ? [selectedMunicipality]
      : [];
  const pageSize = detectionPageSize(filters.pageSize);
  const requestedPage = positiveInteger(filters.page, 1);

  if (!canUseNationalScope && !municipalityId) {
    return {
      detections: [],
      incidents: [],
      municipalities,
      canUseNationalScope,
      isNationalScope: false,
      municipalitySelectionInvalid,
      municipalityQuery,
      municipalityId: null,
      municipalityName: null,
      selectionRequired: true,
      total: 0,
      page: 1,
      pageCount: 1,
      pageSize,
      pageSizes: PAGE_SIZES,
    };
  }

  const where = {
    status: ExternalDetectionStatus.PENDING,
    ...(municipalityId ? { municipalityId } : {}),
  } satisfies Prisma.ExternalDetectionWhereInput;
  const [total, incidents] = await Promise.all([
    prisma.externalDetection.count({ where }),
    municipalityId
      ? prisma.incident.findMany({
          where: {
            municipalityId,
            status: {
              in: ["DRAFT", "PENDING_VALIDATION", "ACTIVE", "MONITORING"],
            },
          },
          select: {
            id: true,
            title: true,
            publicCode: true,
            municipalityId: true,
          },
          orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const detections = await prisma.externalDetection.findMany({
    where,
    orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
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
      brightness: true,
      satellite: true,
      fireRadiativePowerMw: true,
      footprintAreaHectares: true,
      municipalityId: true,
      municipality: { select: { name: true } },
    },
  });

  return {
    detections: detections.map((detection) => ({
      id: detection.id,
      source: detection.source,
      provider: detection.provider,
      providerStatus: detection.providerStatus,
      providerStatusChangedAt:
        detection.providerStatusChangedAt?.toISOString() ?? null,
      latitude: Number(detection.latitude),
      longitude: Number(detection.longitude),
      detectedAt: detection.detectedAt.toISOString(),
      confidence: detection.confidence,
      brightness: detection.brightness ? Number(detection.brightness) : null,
      satellite: detection.satellite,
      fireRadiativePowerMw: detection.fireRadiativePowerMw
        ? Number(detection.fireRadiativePowerMw)
        : null,
      footprintAreaHectares: detection.footprintAreaHectares
        ? Number(detection.footprintAreaHectares)
        : null,
      municipalityId: detection.municipalityId,
      municipalityName: detection.municipality?.name ?? null,
    })),
    incidents,
    municipalities,
    canUseNationalScope,
    isNationalScope: canUseNationalScope && !municipalityId,
    municipalitySelectionInvalid,
    municipalityQuery,
    municipalityId,
    municipalityName: selectedMunicipality?.name ?? null,
    selectionRequired: false,
    total,
    page,
    pageCount,
    pageSize,
    pageSizes: PAGE_SIZES,
  };
}

export async function getIncidentCreationContext(detectionId?: string) {
  const { coordinator, municipalities } = await municipalitiesForCoordinator();
  const normalizedDetectionId = String(detectionId ?? "").trim();
  const detection = normalizedDetectionId
    ? await prisma.externalDetection.findFirst({
        where: {
          id: normalizedDetectionId,
          status: ExternalDetectionStatus.PENDING,
          municipalityId:
            coordinator.role === "SUPER_ADMIN"
              ? { not: null }
              : (coordinator.municipalityId ?? "__none__"),
        },
        select: {
          id: true,
          source: true,
          latitude: true,
          longitude: true,
          detectedAt: true,
          municipalityId: true,
          municipality: { select: { name: true } },
        },
      })
    : null;

  return {
    coordinator,
    municipalities,
    detection: detection
      ? {
          id: detection.id,
          source: detection.source,
          latitude: Number(detection.latitude),
          longitude: Number(detection.longitude),
          detectedAt: detection.detectedAt.toISOString(),
          municipalityId: detection.municipalityId as string,
          municipalityName: detection.municipality?.name ?? "Municipio",
        }
      : null,
  };
}
