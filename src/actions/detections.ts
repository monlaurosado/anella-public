"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import { getOperationalTimeZone } from "@/config/env";
import { Prisma } from "@/generated/prisma/client";
import {
  ExternalDetectionStatus,
  IncidentStatus,
  IncidentType,
  Priority,
  PublicLocationMode,
} from "@/generated/prisma/enums";
import { assertCoordinator, type CoordinatorContext } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { isRetryableTransactionError } from "@/lib/retryable-transaction-error";
import { signedFlashPath } from "@/lib/signed-flash";
import { syncNasaFirmsDetections } from "@/services/detections";
import { syncAutomaticFireDetections } from "@/services/fire-ingestion";

const incidentTypes = [
  "WILDFIRE",
  "FLOOD",
  "STORM",
  "EARTHQUAKE",
  "SNOW",
  "POWER_OUTAGE",
  "SEARCH_RESCUE",
  "HEALTH",
  "INDUSTRIAL",
  "OTHER",
] as const;
const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const FIRMS_SYNC_LOCK_NAME = "anella:nasa-firms:sync:v1";
const FIRMS_SYNC_COOLDOWN_MS = 60_000;
const FIRMS_SYNC_AUDIT_ACTIONS = [
  "external_detection.sync_completed",
  "external_detection.sync_failed",
] as const;
const identifierSchema = z.string().trim().min(1).max(191);
const reasonSchema = z.string().trim().min(8).max(500);
const optionalPublicText = (maximum: number) =>
  z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    return normalized || undefined;
  }, z.string().max(maximum).optional());
const createFromDetectionSchema = z.object({
  detectionId: identifierSchema,
  title: z.string().trim().min(5).max(191),
  type: z.enum(incidentTypes),
  priority: z.enum(priorities),
  publicSummary: optionalPublicText(2000),
  safetyNotice: optionalPublicText(1000),
  radiusMeters: z.coerce.number().int().min(100).max(100_000),
});

class DetectionActionError extends Error {}

type ReturnContext = {
  municipalityId?: string;
  returnScope?: "national";
  page?: string;
  pageSize?: string;
};

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function returnContext(formData: FormData): ReturnContext {
  return {
    municipalityId: formText(formData, "municipalityId") || undefined,
    returnScope:
      formText(formData, "returnScope") === "national" ? "national" : undefined,
    page: /^\d+$/.test(formText(formData, "page"))
      ? formText(formData, "page")
      : undefined,
    pageSize: ["10", "25", "50", "100"].includes(formText(formData, "pageSize"))
      ? formText(formData, "pageSize")
      : undefined,
  };
}

function detectionPath(
  kind: "notice" | "error",
  message: string,
  context: ReturnContext = {},
) {
  const query = new URLSearchParams();
  if (context.municipalityId && context.returnScope !== "national") {
    query.set("municipalityId", context.municipalityId);
  }
  if (context.page) query.set("page", context.page);
  if (context.pageSize) query.set("pageSize", context.pageSize);
  return signedFlashPath(
    `/coordinacion/detecciones?${query.toString()}`,
    kind,
    message,
  );
}

function incidentCreationPath(
  detectionId: string,
  kind: "notice" | "error",
  message: string,
) {
  const query = new URLSearchParams({ detectionId });
  return signedFlashPath(
    `/coordinacion/incidentes/nuevo?${query.toString()}`,
    kind,
    message,
  );
}

function fail(message: string): never {
  throw new DetectionActionError(message);
}

async function authorizedMunicipality(
  coordinator: CoordinatorContext,
  requestedMunicipalityId: string,
) {
  const municipalityId =
    coordinator.role === "SUPER_ADMIN"
      ? requestedMunicipalityId
      : (coordinator.municipalityId ?? "");

  if (!municipalityId) {
    fail("Selecciona un municipio antes de continuar.");
  }
  if (
    coordinator.role !== "SUPER_ADMIN" &&
    municipalityId !== coordinator.municipalityId
  ) {
    fail("No tienes acceso al municipio indicado.");
  }

  const municipality = await prisma.municipality.findUnique({
    where: { id: municipalityId },
    select: { id: true, name: true },
  });
  if (!municipality) fail("El municipio seleccionado no existe.");
  return municipality;
}

function actionErrorMessage(error: unknown) {
  if (error instanceof DetectionActionError) return error.message;
  if (isRetryableTransactionError(error)) {
    return "La señal ha cambiado mientras trabajabas. Revisa la cola e inténtalo de nuevo.";
  }
  console.error("Detection action failed", error);
  return "No se ha podido completar la operación.";
}

function jsonMetadata(value: Record<string, unknown>) {
  return value as Prisma.InputJsonObject;
}

type NamedLockValue = number | bigint | null;

async function auditFirmsRateLimit(
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string;
    municipality: { id: string; name: string };
    reason: "cooldown" | "overlap";
    retryAfterSeconds?: number;
  },
) {
  await transaction.auditLog.create({
    data: {
      actorId: input.actorId,
      municipalityId: input.municipality.id,
      action: "external_detection.sync_rate_limited",
      entityType: "ExternalDetection",
      metadata: jsonMetadata({
        municipality: input.municipality.name,
        reason: input.reason,
        ...(input.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: input.retryAfterSeconds }),
      }),
    },
  });
}

async function guardedFirmsSync(input: {
  actorId: string;
  municipality: { id: string; name: string };
}) {
  return prisma.$transaction(
    async (transaction) => {
      const lockRows = await transaction.$queryRaw<
        Array<{ acquired: NamedLockValue }>
      >`SELECT GET_LOCK(${FIRMS_SYNC_LOCK_NAME}, 0) AS acquired`;
      const acquiredValue = lockRows[0]?.acquired;
      if (acquiredValue === null || acquiredValue === undefined) {
        fail(
          "NASA FIRMS no está disponible temporalmente porque no se ha podido asegurar la sincronización.",
        );
      }
      const acquired = Number(acquiredValue) === 1;

      if (!acquired) {
        await auditFirmsRateLimit(transaction, {
          actorId: input.actorId,
          municipality: input.municipality,
          reason: "overlap",
        });
        return {
          ok: false as const,
          reason:
            "Ya hay una importación de NASA FIRMS en curso. Espera a que termine antes de volver a intentarlo.",
        };
      }

      try {
        const now = new Date();
        const latestAttempt = await transaction.auditLog.findFirst({
          where: {
            actorId: input.actorId,
            municipalityId: input.municipality.id,
            action: { in: [...FIRMS_SYNC_AUDIT_ACTIONS] },
            createdAt: {
              gte: new Date(now.getTime() - FIRMS_SYNC_COOLDOWN_MS),
            },
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });

        if (latestAttempt) {
          const retryAfterSeconds = Math.max(
            1,
            Math.min(
              FIRMS_SYNC_COOLDOWN_MS / 1_000,
              Math.ceil(
                (latestAttempt.createdAt.getTime() +
                  FIRMS_SYNC_COOLDOWN_MS -
                  now.getTime()) /
                  1_000,
              ),
            ),
          );
          await auditFirmsRateLimit(transaction, {
            actorId: input.actorId,
            municipality: input.municipality,
            reason: "cooldown",
            retryAfterSeconds,
          });
          return {
            ok: false as const,
            reason: `NASA FIRMS se ha sincronizado recientemente para esta cuenta y municipio. Vuelve a intentarlo dentro de ${retryAfterSeconds} segundos.`,
          };
        }

        try {
          return await syncNasaFirmsDetections({
            municipalityId: input.municipality.id,
            actorId: input.actorId,
          });
        } catch (error) {
          await transaction.auditLog.create({
            data: {
              actorId: input.actorId,
              municipalityId: input.municipality.id,
              action: "external_detection.sync_failed",
              entityType: "ExternalDetection",
              metadata: jsonMetadata({
                municipality: input.municipality.name,
                reason: "Fallo interno durante la importación.",
              }),
            },
          });
          throw error;
        }
      } finally {
        try {
          const releaseRows = await transaction.$queryRaw<
            Array<{ released: NamedLockValue }>
          >`SELECT RELEASE_LOCK(${FIRMS_SYNC_LOCK_NAME}) AS released`;
          if (Number(releaseRows[0]?.released ?? 0) !== 1) {
            console.error("FIRMS advisory lock was not released by its owner");
          }
        } catch (error) {
          console.error("FIRMS advisory lock release failed", error);
        }
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 120_000,
    },
  );
}

export async function syncFirms(formData: FormData) {
  const coordinator = await assertCoordinator();
  const context = returnContext(formData);

  let municipality: { id: string; name: string };
  try {
    municipality = await authorizedMunicipality(
      coordinator,
      context.municipalityId ?? "",
    );
  } catch (error) {
    redirect(detectionPath("error", actionErrorMessage(error), context));
  }

  let result: Awaited<ReturnType<typeof guardedFirmsSync>>;
  try {
    result = await guardedFirmsSync({
      municipality,
      actorId: coordinator.id,
    });
  } catch (error) {
    redirect(detectionPath("error", actionErrorMessage(error), context));
  }

  if (!result.ok) {
    redirect(detectionPath("error", result.reason, context));
  }

  revalidatePath("/coordinacion/detecciones");
  redirect(
    detectionPath(
      "notice",
      `${result.imported} señales nuevas importadas; ${result.rejected.length} filas descartadas. Todas quedan pendientes de revisión humana.`,
      { ...context, municipalityId: municipality.id, page: "1" },
    ),
  );
}

export async function syncAutomaticFireSources(formData: FormData) {
  const coordinator = await assertCoordinator();
  const context = returnContext(formData);

  if (coordinator.role !== "SUPER_ADMIN") {
    redirect(
      detectionPath(
        "error",
        "Solo la administración global puede forzar una sincronización nacional.",
        context,
      ),
    );
  }

  const latestSource = await prisma.externalSourceSync.findFirst({
    orderBy: { lastAttemptAt: "desc" },
    select: { lastAttemptAt: true },
  });
  const elapsed = latestSource
    ? Date.now() - latestSource.lastAttemptAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (elapsed < FIRMS_SYNC_COOLDOWN_MS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((FIRMS_SYNC_COOLDOWN_MS - elapsed) / 1_000),
    );
    redirect(
      detectionPath(
        "notice",
        `Las fuentes ya se han actualizado recientemente. La siguiente actualización manual estará disponible en ${retryAfterSeconds} segundos.`,
        context,
      ),
    );
  }

  let result: Awaited<ReturnType<typeof syncAutomaticFireDetections>>;
  try {
    result = await syncAutomaticFireDetections({ actorId: coordinator.id });
  } catch (error) {
    redirect(detectionPath("error", actionErrorMessage(error), context));
  }

  if (result.status === "busy") {
    redirect(
      detectionPath(
        "notice",
        "Ya hay una actualización automática en curso.",
        context,
      ),
    );
  }
  if (!result.ok) {
    redirect(
      detectionPath(
        "error",
        "Ninguna fuente de incendios ha respondido correctamente.",
        context,
      ),
    );
  }

  revalidatePath("/coordinacion/detecciones");
  redirect(
    detectionPath(
      "notice",
      `${result.imported} señales nuevas, ${result.updated} actualizadas y ${result.assigned} asignadas a municipio.${result.degraded ? " Alguna fuente no respondió; las demás se actualizaron correctamente." : ""}`,
      { ...context, page: "1" },
    ),
  );
}

export async function dismissDetection(formData: FormData) {
  const coordinator = await assertCoordinator();
  const context = returnContext(formData);
  const detectionId = identifierSchema.safeParse(
    formText(formData, "detectionId"),
  );
  const reason = reasonSchema.safeParse(formText(formData, "reason"));
  const confirmed = formData.get("confirmed") === "true";

  if (!detectionId.success || !reason.success || !confirmed) {
    redirect(
      detectionPath(
        "error",
        !confirmed
          ? "Confirma el descarte de la señal."
          : "Explica el motivo del descarte con entre 8 y 500 caracteres.",
        context,
      ),
    );
  }

  try {
    const municipality = await authorizedMunicipality(
      coordinator,
      context.municipalityId ?? "",
    );
    await prisma.$transaction(
      async (transaction) => {
        const detection = await transaction.externalDetection.findFirst({
          where: { id: detectionId.data, municipalityId: municipality.id },
          select: {
            id: true,
            status: true,
            linkedIncidentId: true,
            source: true,
          },
        });
        if (!detection) fail("Señal no encontrada en este municipio.");
        if (detection.status !== ExternalDetectionStatus.PENDING) {
          fail("La señal ya ha sido revisada por otra persona.");
        }

        const updated = await transaction.externalDetection.updateMany({
          where: {
            id: detection.id,
            municipalityId: municipality.id,
            status: ExternalDetectionStatus.PENDING,
          },
          data: { status: ExternalDetectionStatus.DISMISSED },
        });
        if (updated.count !== 1) {
          fail("La señal ya ha sido revisada por otra persona.");
        }

        await transaction.auditLog.create({
          data: {
            actorId: coordinator.id,
            municipalityId: municipality.id,
            action: "external_detection.dismissed",
            entityType: "ExternalDetection",
            entityId: detection.id,
            metadata: jsonMetadata({
              before: {
                status: detection.status,
                linkedIncidentId: detection.linkedIncidentId,
              },
              after: {
                status: ExternalDetectionStatus.DISMISSED,
                linkedIncidentId: null,
              },
              source: detection.source,
              reason: reason.data,
            }),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirect(detectionPath("error", actionErrorMessage(error), context));
  }

  revalidatePath("/coordinacion/detecciones");
  redirect(detectionPath("notice", "Señal descartada y auditada.", context));
}

export async function linkDetection(formData: FormData) {
  const coordinator = await assertCoordinator();
  const context = returnContext(formData);
  const detectionId = identifierSchema.safeParse(
    formText(formData, "detectionId"),
  );
  const incidentId = identifierSchema.safeParse(
    formText(formData, "incidentId"),
  );

  if (!detectionId.success || !incidentId.success) {
    redirect(
      detectionPath(
        "error",
        "Selecciona una señal y un incidente válidos.",
        context,
      ),
    );
  }

  let linkedIncidentId = "";
  try {
    const municipality = await authorizedMunicipality(
      coordinator,
      context.municipalityId ?? "",
    );
    await prisma.$transaction(
      async (transaction) => {
        const [detection, incident] = await Promise.all([
          transaction.externalDetection.findFirst({
            where: { id: detectionId.data, municipalityId: municipality.id },
            select: {
              id: true,
              status: true,
              linkedIncidentId: true,
              source: true,
            },
          }),
          transaction.incident.findFirst({
            where: {
              id: incidentId.data,
              municipalityId: municipality.id,
              status: {
                in: [
                  IncidentStatus.DRAFT,
                  IncidentStatus.PENDING_VALIDATION,
                  IncidentStatus.ACTIVE,
                  IncidentStatus.MONITORING,
                ],
              },
            },
            select: { id: true, publicCode: true },
          }),
        ]);

        if (!detection) fail("Señal no encontrada en este municipio.");
        if (detection.status !== ExternalDetectionStatus.PENDING) {
          fail("La señal ya ha sido revisada por otra persona.");
        }
        if (!incident) {
          fail(
            "El incidente no pertenece al mismo municipio o ya está cerrado.",
          );
        }

        const updated = await transaction.externalDetection.updateMany({
          where: {
            id: detection.id,
            municipalityId: municipality.id,
            status: ExternalDetectionStatus.PENDING,
          },
          data: {
            status: ExternalDetectionStatus.LINKED,
            linkedIncidentId: incident.id,
          },
        });
        if (updated.count !== 1) {
          fail("La señal ya ha sido revisada por otra persona.");
        }

        const now = new Date();
        await Promise.all([
          transaction.incident.update({
            where: { id: incident.id },
            data: { lastActivityAt: now },
          }),
          transaction.auditLog.create({
            data: {
              actorId: coordinator.id,
              incidentId: incident.id,
              municipalityId: municipality.id,
              action: "external_detection.linked",
              entityType: "ExternalDetection",
              entityId: detection.id,
              metadata: jsonMetadata({
                before: {
                  status: detection.status,
                  linkedIncidentId: detection.linkedIncidentId,
                },
                after: {
                  status: ExternalDetectionStatus.LINKED,
                  linkedIncidentId: incident.id,
                },
                incidentPublicCode: incident.publicCode,
                source: detection.source,
              }),
            },
          }),
        ]);
        linkedIncidentId = incident.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirect(detectionPath("error", actionErrorMessage(error), context));
  }

  revalidatePath("/coordinacion/detecciones");
  revalidatePath("/coordinacion/incidentes");
  if (linkedIncidentId) {
    updateTag(PUBLIC_INCIDENTS_CACHE_TAG);
    revalidatePath(`/coordinacion/incidentes/${linkedIncidentId}`);
  }
  redirect(
    detectionPath(
      "notice",
      "Señal vinculada al incidente para revisión interna. No se ha publicado información.",
      context,
    ),
  );
}

export async function createIncidentFromDetection(formData: FormData) {
  const coordinator = await assertCoordinator();
  const parsed = createFromDetectionSchema.safeParse({
    detectionId: formData.get("detectionId"),
    title: formData.get("title"),
    type: formData.get("type") || "WILDFIRE",
    priority: formData.get("priority"),
    publicSummary: formData.get("publicSummary"),
    safetyNotice: formData.get("safetyNotice"),
    radiusMeters:
      formData.get("selectedRadiusMeters") ?? formData.get("radiusMeters"),
  });
  const rawDetectionId = formText(formData, "detectionId");

  if (!parsed.success) {
    redirect(
      incidentCreationPath(
        rawDetectionId,
        "error",
        "Revisa los campos del incidente antes de guardarlo.",
      ),
    );
  }

  let incidentId = "";
  try {
    const municipality = await authorizedMunicipality(
      coordinator,
      formText(formData, "municipalityId"),
    );
    const publicCode = `INC-${new Date().getFullYear()}-${randomBytes(8)
      .toString("hex")
      .toUpperCase()}`;

    await prisma.$transaction(
      async (transaction) => {
        const detection = await transaction.externalDetection.findFirst({
          where: {
            id: parsed.data.detectionId,
            municipalityId: municipality.id,
          },
          select: {
            id: true,
            status: true,
            source: true,
            latitude: true,
            longitude: true,
            detectedAt: true,
            linkedIncidentId: true,
          },
        });
        if (!detection) fail("Señal no encontrada en este municipio.");
        if (detection.status !== ExternalDetectionStatus.PENDING) {
          fail("La señal ya ha sido revisada por otra persona.");
        }

        const incident = await transaction.incident.create({
          data: {
            publicCode,
            title: parsed.data.title,
            type: parsed.data.type as IncidentType,
            status: IncidentStatus.DRAFT,
            priority: parsed.data.priority as Priority,
            publicSummary: parsed.data.publicSummary ?? null,
            safetyNotice: parsed.data.safetyNotice ?? null,
            operationalLatitude: detection.latitude,
            operationalLongitude: detection.longitude,
            radiusMeters: parsed.data.radiusMeters,
            publicLocationMode: PublicLocationMode.MUNICIPALITY_ONLY,
            publicLocationLabel: municipality.name,
            timeZone: getOperationalTimeZone(),
            municipalityId: municipality.id,
            organizationId:
              coordinator.municipalityId === municipality.id
                ? coordinator.organizationId
                : null,
            responsibleOrgName:
              coordinator.municipalityId === municipality.id
                ? (coordinator.organizationName ?? municipality.name)
                : municipality.name,
            createdById: coordinator.id,
          },
        });

        const claimed = await transaction.externalDetection.updateMany({
          where: {
            id: detection.id,
            municipalityId: municipality.id,
            status: ExternalDetectionStatus.PENDING,
          },
          data: {
            status: ExternalDetectionStatus.LINKED,
            linkedIncidentId: incident.id,
          },
        });
        if (claimed.count !== 1) {
          fail("La señal ya ha sido revisada por otra persona.");
        }

        await Promise.all([
          transaction.auditLog.create({
            data: {
              actorId: coordinator.id,
              incidentId: incident.id,
              municipalityId: municipality.id,
              action: "incident.created_from_detection",
              entityType: "Incident",
              entityId: incident.id,
              metadata: jsonMetadata({
                publicCode,
                status: IncidentStatus.DRAFT,
                detectionId: detection.id,
                detectionSource: detection.source,
                detectedAt: detection.detectedAt.toISOString(),
                publicLocationMode: PublicLocationMode.MUNICIPALITY_ONLY,
              }),
            },
          }),
          transaction.auditLog.create({
            data: {
              actorId: coordinator.id,
              incidentId: incident.id,
              municipalityId: municipality.id,
              action: "external_detection.linked",
              entityType: "ExternalDetection",
              entityId: detection.id,
              metadata: jsonMetadata({
                before: {
                  status: detection.status,
                  linkedIncidentId: detection.linkedIncidentId,
                },
                after: {
                  status: ExternalDetectionStatus.LINKED,
                  linkedIncidentId: incident.id,
                },
                reason: "Incidente creado desde la señal por revisión humana",
              }),
            },
          }),
        ]);
        incidentId = incident.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirect(
      incidentCreationPath(
        parsed.data.detectionId,
        "error",
        actionErrorMessage(error),
      ),
    );
  }

  revalidatePath("/coordinacion/detecciones");
  revalidatePath("/coordinacion/incidentes");
  redirect(
    signedFlashPath(
      `/coordinacion/incidentes/${incidentId}`,
      "notice",
      "Incidente guardado como borrador y señal vinculada. Revisa la vista pública antes de validarlo.",
    ),
  );
}
