"use server";

import { createHmac, randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getIdempotencySecret, getOperationalTimeZone } from "@/config/env";
import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import { Prisma } from "@/generated/prisma/client";
import {
  ContributionStatus,
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  Priority,
  PublicLocationMode,
} from "@/generated/prisma/enums";
import {
  assertCoordinator,
  incidentScopeWhere,
  type CoordinatorContext,
} from "@/lib/dal";
import { prisma } from "@/lib/db";
import { isRetryableTransactionError } from "@/lib/retryable-transaction-error";
import { logServerError } from "@/lib/safe-error";
import { signedFlashPath } from "@/lib/signed-flash";
import { TimeZoneError, zonedDateTimeLocalToUtc } from "@/lib/time-zone";

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
const needTypes = [
  "WATER",
  "FOOD",
  "ICE",
  "MEDICAL_SUPPLIES",
  "TRANSPORT",
  "POWER",
  "TOOLS",
  "SHELTER",
  "VOLUNTEERS",
  "OTHER",
] as const;
const publicLocationModes = [
  "MUNICIPALITY_ONLY",
  "GENERALIZED_AREA",
  "SAFE_POINTS_ONLY",
] as const;

const publishedIncidentStatuses: IncidentStatus[] = [
  IncidentStatus.ACTIVE,
  IncidentStatus.MONITORING,
];
const outstandingContributionStatuses: ContributionStatus[] = [
  ContributionStatus.PLEDGED,
  ContributionStatus.EN_ROUTE,
  ContributionStatus.PARTIALLY_DELIVERED,
];
const terminalNeedStatuses: NeedStatus[] = [
  NeedStatus.COVERED,
  NeedStatus.CANCELLED,
  NeedStatus.EXPIRED,
];
const editableIncidentStatuses: IncidentStatus[] = [
  IncidentStatus.DRAFT,
  IncidentStatus.PENDING_VALIDATION,
  IncidentStatus.ACTIVE,
  IncidentStatus.MONITORING,
];

const incidentTransitions: Record<IncidentStatus, IncidentStatus[]> = {
  DRAFT: [IncidentStatus.PENDING_VALIDATION, IncidentStatus.CANCELLED],
  PENDING_VALIDATION: [
    IncidentStatus.DRAFT,
    IncidentStatus.ACTIVE,
    IncidentStatus.CANCELLED,
  ],
  ACTIVE: [
    IncidentStatus.MONITORING,
    IncidentStatus.RESOLVED,
    IncidentStatus.CANCELLED,
  ],
  MONITORING: [
    IncidentStatus.ACTIVE,
    IncidentStatus.RESOLVED,
    IncidentStatus.CANCELLED,
  ],
  RESOLVED: [IncidentStatus.PENDING_VALIDATION],
  CANCELLED: [],
};

const needTransitions: Record<NeedStatus, NeedStatus[]> = {
  DRAFT: [NeedStatus.ACTIVE, NeedStatus.CANCELLED],
  ACTIVE: [NeedStatus.COVERED, NeedStatus.CANCELLED, NeedStatus.EXPIRED],
  COVERED: [NeedStatus.ACTIVE],
  CANCELLED: [],
  EXPIRED: [],
};

const contributionTransitions: Record<
  ContributionStatus,
  ContributionStatus[]
> = {
  PLEDGED: [
    ContributionStatus.EN_ROUTE,
    ContributionStatus.PARTIALLY_DELIVERED,
    ContributionStatus.DELIVERED,
    ContributionStatus.CANCELLED,
    ContributionStatus.NO_SHOW,
  ],
  EN_ROUTE: [
    ContributionStatus.PARTIALLY_DELIVERED,
    ContributionStatus.DELIVERED,
    ContributionStatus.CANCELLED,
    ContributionStatus.NO_SHOW,
  ],
  PARTIALLY_DELIVERED: [
    ContributionStatus.PARTIALLY_DELIVERED,
    ContributionStatus.DELIVERED,
    ContributionStatus.CANCELLED,
    ContributionStatus.NO_SHOW,
  ],
  DELIVERED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const reasonSchema = z
  .string()
  .trim()
  .min(8, "Explica el motivo con al menos 8 caracteres.")
  .max(500, "El motivo no puede superar 500 caracteres.");

function requiredNumber(schema: z.ZodType<number, unknown>) {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string" && value.trim() === "") return undefined;
    return value;
  }, schema);
}

function optionalText(maximum: number) {
  return z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    return normalized || undefined;
  }, z.string().max(maximum).optional());
}

const createIncidentSchema = z.object({
  title: z.string().trim().min(5).max(191),
  type: z.enum(incidentTypes),
  priority: z.enum(priorities),
  publicSummary: optionalText(2000),
  safetyNotice: optionalText(1000),
  latitude: requiredNumber(z.coerce.number().min(-90).max(90)),
  longitude: requiredNumber(z.coerce.number().min(-180).max(180)),
  radiusMeters: requiredNumber(
    z.coerce.number().int().min(100).max(100_000),
  ),
});

const safePointSchema = z.object({
  incidentId: z.string().min(1),
  name: z.string().trim().min(3).max(191),
  address: optionalText(255),
  instructions: optionalText(2000),
  latitude: requiredNumber(z.coerce.number().min(-90).max(90)),
  longitude: requiredNumber(z.coerce.number().min(-180).max(180)),
  radiusMeters: requiredNumber(z.coerce.number().int().min(10).max(200)),
  capacityNote: z.string().trim().max(191).optional(),
  pointType: z
    .enum(["DROP_OFF", "LOGISTICS", "COLLECTION"])
    .default("DROP_OFF"),
});

const needSchema = z.object({
  incidentId: z.string().min(1),
  safePointId: z.string().min(1),
  type: z.enum(needTypes),
  title: z.string().trim().min(3).max(191),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(priorities),
  quantityNeeded: z.coerce.number().int().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(32),
  publish: z.boolean().default(false),
});

const publicLocationSchema = z.object({
  incidentId: z.string().min(1),
  mode: z.enum(publicLocationModes),
  label: z.string().trim().min(3).max(191),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().int().min(1_500).max(100_000).optional(),
  confirmed: z.literal(true),
});
const idempotencyKeySchema = z.uuid(
  "El envío ya no es válido; recarga la página.",
);

class OperationalRuleError extends Error {}
class ConcurrentMutationError extends Error {}

function idempotentEntityId(
  prefix: "incident" | "safe_point" | "need",
  coordinatorId: string,
  scopeId: string,
  key: string,
) {
  const digest = createHmac("sha256", getIdempotencySecret())
    .update(`${prefix}:${coordinatorId}:${scopeId}:${key}`)
    .digest("hex")
    .slice(0, 40);
  return `${prefix}_${digest}`;
}

function idempotencyFingerprint(
  kind: string,
  normalizedPayload: Record<string, unknown>,
) {
  return createHmac("sha256", getIdempotencySecret())
    .update(`${kind}:${JSON.stringify(normalizedPayload)}`)
    .digest("hex");
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function isMatchingIdempotentReplay(
  entityType: "Incident" | "SafePoint" | "Need",
  entityId: string,
  action: string,
  fingerprint: string,
) {
  const audit = await prisma.auditLog.findFirst({
    where: { entityType, entityId, action },
    select: { metadata: true },
  });
  const metadata = audit?.metadata;
  return Boolean(
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).idempotencyFingerprint ===
      fingerprint,
  );
}

function managementPath(incidentId: string, tab?: string, formData?: FormData) {
  const base = `/coordinacion/incidentes/${incidentId}`;
  if (!tab) return base;

  const query = new URLSearchParams({ tab });
  if (formData) {
    const returnPage = String(formData.get("returnPage") ?? "");
    const returnPageSize = String(formData.get("returnPageSize") ?? "");
    if (/^[1-9]\d{0,5}$/.test(returnPage)) {
      query.set("page", returnPage);
    }
    if (["10", "25", "50", "100"].includes(returnPageSize)) {
      query.set("pageSize", returnPageSize);
    }
  }
  return `${base}?${query.toString()}`;
}

function redirectWithMessage(
  path: string,
  kind: "notice" | "error",
  message: string,
): never {
  redirect(signedFlashPath(path, kind, message));
}

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Revisa los datos del formulario.";
}

function fail(message: string): never {
  throw new OperationalRuleError(message);
}

function requiredReason(value: FormDataEntryValue | null) {
  const parsed = reasonSchema.safeParse(value);
  if (!parsed.success) fail(firstIssue(parsed.error));
  return parsed.data;
}

function optionalReason(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return undefined;
  const parsed = reasonSchema.safeParse(normalized);
  if (!parsed.success) fail(firstIssue(parsed.error));
  return parsed.data;
}

function parseDeadline(
  value: FormDataEntryValue | null,
  timeZone: string,
  options: {
    allowEmpty?: boolean;
    requireFuture?: boolean;
    disambiguation?: "reject" | "earlier" | "later";
  } = {},
) {
  const normalized = String(value ?? "").trim();
  if (!normalized && options.allowEmpty !== false) return null;
  if (!normalized) fail("Indica una fecha límite.");

  try {
    const deadline = zonedDateTimeLocalToUtc(normalized, timeZone, {
      disambiguation: options.disambiguation,
    });
    if (options.requireFuture !== false && deadline.getTime() <= Date.now()) {
      fail("La fecha límite debe ser futura.");
    }
    return deadline;
  } catch (error) {
    if (error instanceof OperationalRuleError) throw error;
    if (error instanceof TimeZoneError) fail(error.message);
    throw error;
  }
}

function deadlineDisambiguation(value: FormDataEntryValue | null) {
  const parsed = z.enum(["reject", "earlier", "later"]).safeParse(value);
  return parsed.success ? parsed.data : "reject";
}

function roundGeneralizedCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function auditMetadata(value: Record<string, unknown>) {
  return value as Prisma.InputJsonObject;
}

async function writeAudit(
  transaction: Prisma.TransactionClient,
  input: {
    coordinator: CoordinatorContext;
    incidentId: string;
    municipalityId: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await transaction.auditLog.create({
    data: {
      actorId: input.coordinator.id,
      incidentId: input.incidentId,
      municipalityId: input.municipalityId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ? auditMetadata(input.metadata) : undefined,
    },
  });
}

async function touchIncident(
  transaction: Prisma.TransactionClient,
  incidentId: string,
  at = new Date(),
) {
  await transaction.incident.update({
    where: { id: incidentId },
    data: { lastActivityAt: at },
  });
}

function revalidateIncident(incidentId: string) {
  updateTag(PUBLIC_INCIDENTS_CACHE_TAG);
  revalidatePath("/");
  revalidatePath(`/incidentes/${incidentId}`);
  revalidatePath("/coordinacion/incidentes");
  revalidatePath("/coordinacion/aportaciones");
  revalidatePath(managementPath(incidentId));
}

function operationalErrorMessage(error: unknown, fallback: string) {
  if (error instanceof OperationalRuleError) return error.message;
  if (error instanceof ConcurrentMutationError) {
    return "Los datos han cambiado mientras trabajabas. Revisa la ficha y vuelve a intentarlo.";
  }
  if (isRetryableTransactionError(error)) {
    return "Otra persona ha modificado estos datos al mismo tiempo. Revisa la ficha y vuelve a intentarlo.";
  }
  logServerError(fallback, error);
  return fallback;
}

export async function createIncident(formData: FormData) {
  const coordinator = await assertCoordinator();
  const idempotencyKey = idempotencyKeySchema.safeParse(
    formData.get("idempotencyKey"),
  );
  if (!idempotencyKey.success) {
    redirectWithMessage(
      "/coordinacion/incidentes/nuevo",
      "error",
      firstIssue(idempotencyKey.error),
    );
  }
  const parsed = createIncidentSchema.safeParse({
    title: formData.get("title"),
    type: formData.get("type") || "WILDFIRE",
    priority: formData.get("priority"),
    publicSummary: formData.get("publicSummary"),
    safetyNotice: formData.get("safetyNotice"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    radiusMeters: formData.get("radiusMeters"),
  });

  if (!parsed.success) {
    redirectWithMessage(
      "/coordinacion/incidentes/nuevo",
      "error",
      firstIssue(parsed.error),
    );
  }

  const requestedMunicipalityId =
    coordinator.role === "SUPER_ADMIN"
      ? String(formData.get("municipalityId") ?? "").trim()
      : (coordinator.municipalityId ?? "");

  if (!requestedMunicipalityId) {
    redirectWithMessage(
      "/coordinacion/incidentes/nuevo",
      "error",
      "Selecciona un municipio responsable antes de crear el incidente.",
    );
  }

  const municipality = await prisma.municipality.findUnique({
    where: { id: requestedMunicipalityId },
    select: { id: true, name: true },
  });
  if (!municipality) {
    redirectWithMessage(
      "/coordinacion/incidentes/nuevo",
      "error",
      "El municipio seleccionado no existe.",
    );
  }

  const publicCode = `INC-${new Date().getFullYear()}-${randomBytes(8)
    .toString("hex")
    .toUpperCase()}`;
  const entityId = idempotentEntityId(
    "incident",
    coordinator.id,
    municipality.id,
    idempotencyKey.data,
  );
  const replayFingerprint = idempotencyFingerprint("incident.create", {
    municipalityId: municipality.id,
    ...parsed.data,
  });

  try {
    await prisma.$transaction(async (transaction) => {
      const created = await transaction.incident.create({
        data: {
          id: entityId,
          publicCode,
          title: parsed.data.title,
          type: parsed.data.type as IncidentType,
          status: IncidentStatus.DRAFT,
          priority: parsed.data.priority as Priority,
          publicSummary: parsed.data.publicSummary ?? null,
          safetyNotice: parsed.data.safetyNotice ?? null,
          operationalLatitude: parsed.data.latitude,
          operationalLongitude: parsed.data.longitude,
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
      await writeAudit(transaction, {
        coordinator,
        incidentId: created.id,
        municipalityId: created.municipalityId,
        action: "incident.created",
        entityType: "Incident",
        entityId: created.id,
        metadata: {
          publicCode,
          status: IncidentStatus.DRAFT,
          idempotencyFingerprint: replayFingerprint,
        },
      });
    });
  } catch (error) {
    if (
      isUniqueConstraintError(error) &&
      (await isMatchingIdempotentReplay(
        "Incident",
        entityId,
        "incident.created",
        replayFingerprint,
      ))
    ) {
      redirectWithMessage(
        managementPath(entityId),
        "notice",
        "El incidente ya estaba creado; se ha recuperado el primer envío.",
      );
    }
    redirectWithMessage(
      "/coordinacion/incidentes/nuevo",
      "error",
      isUniqueConstraintError(error)
        ? "Este envío ya se utilizó con otros datos. Recarga el formulario."
        : operationalErrorMessage(error, "No se ha podido crear el incidente."),
    );
  }

  revalidatePath("/coordinacion/incidentes");
  redirectWithMessage(
    managementPath(entityId),
    "notice",
    "Incidente creado como borrador. Revisa la vista pública antes de validarlo.",
  );
}

export async function updateIncidentDetails(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const parsed = createIncidentSchema.safeParse({
    title: formData.get("title"),
    type: formData.get("type") || "WILDFIRE",
    priority: formData.get("priority"),
    publicSummary: formData.get("publicSummary"),
    safetyNotice: formData.get("safetyNotice"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    radiusMeters: formData.get("radiusMeters"),
  });

  if (!parsed.success) {
    redirectWithMessage(
      managementPath(incidentId),
      "error",
      firstIssue(parsed.error),
    );
  }
  const reason = reasonSchema.safeParse(formData.get("reason"));
  const expectedUpdatedAt = z.iso
    .datetime()
    .safeParse(formData.get("expectedUpdatedAt"));
  if (!reason.success || !expectedUpdatedAt.success) {
    redirectWithMessage(
      managementPath(incidentId),
      "error",
      reason.success
        ? "La ficha está desactualizada; recarga la página."
        : firstIssue(reason.error),
    );
  }

  try {
    await prisma.$transaction(
      async (transaction) => {
        const incident = await transaction.incident.findFirst({
          where: { id: incidentId, ...incidentScopeWhere(coordinator) },
        });
        if (!incident) fail("Incidente no encontrado.");
        if (!editableIncidentStatuses.includes(incident.status)) {
          fail("Reabre el incidente antes de modificar su ficha.");
        }
        const now = new Date();
        const updated = await transaction.incident.updateMany({
          where: {
            id: incident.id,
            updatedAt: new Date(expectedUpdatedAt.data),
          },
          data: {
            title: parsed.data.title,
            type: parsed.data.type as IncidentType,
            priority: parsed.data.priority as Priority,
            publicSummary: parsed.data.publicSummary ?? null,
            safetyNotice: parsed.data.safetyNotice ?? null,
            operationalLatitude: parsed.data.latitude,
            operationalLongitude: parsed.data.longitude,
            radiusMeters: parsed.data.radiusMeters,
            verifiedById: coordinator.id,
            verifiedAt: now,
            lastActivityAt: now,
          },
        });
        if (updated.count !== 1) throw new ConcurrentMutationError();
        await writeAudit(transaction, {
          coordinator,
          incidentId: incident.id,
          municipalityId: incident.municipalityId,
          action: "incident.updated",
          entityType: "Incident",
          entityId: incident.id,
          metadata: {
            before: {
              title: incident.title,
              type: incident.type,
              priority: incident.priority,
              publicSummary: incident.publicSummary,
              safetyNotice: incident.safetyNotice,
              operationalLatitude: Number(incident.operationalLatitude),
              operationalLongitude: Number(incident.operationalLongitude),
              radiusMeters: incident.radiusMeters,
            },
            after: {
              title: parsed.data.title,
              type: parsed.data.type,
              priority: parsed.data.priority,
              publicSummary: parsed.data.publicSummary,
              safetyNotice: parsed.data.safetyNotice,
              operationalLatitude: parsed.data.latitude,
              operationalLongitude: parsed.data.longitude,
              radiusMeters: parsed.data.radiusMeters,
            },
            humanVerification: {
              before: {
                actorId: incident.verifiedById,
                verifiedAt: incident.verifiedAt?.toISOString() ?? null,
              },
              after: {
                actorId: coordinator.id,
                verifiedAt: now.toISOString(),
              },
            },
            reason: reason.data,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirectWithMessage(
      managementPath(incidentId),
      "error",
      operationalErrorMessage(
        error,
        "No se ha podido actualizar el incidente.",
      ),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    managementPath(incidentId),
    "notice",
    "Datos operativos y públicos actualizados.",
  );
}

export async function updatePublicLocation(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const emptyToUndefined = (value: FormDataEntryValue | null) =>
    String(value ?? "").trim() || undefined;
  const parsed = publicLocationSchema.safeParse({
    incidentId,
    mode: formData.get("mode"),
    label: formData.get("label"),
    latitude: emptyToUndefined(formData.get("latitude")),
    longitude: emptyToUndefined(formData.get("longitude")),
    radiusMeters: emptyToUndefined(formData.get("radiusMeters")),
    confirmed: formData.get("confirmPublicSafety") === "on",
  });

  if (!parsed.success) {
    redirectWithMessage(
      managementPath(incidentId, "summary"),
      "error",
      firstIssue(parsed.error),
    );
  }
  if (
    parsed.data.mode === PublicLocationMode.GENERALIZED_AREA &&
    (parsed.data.latitude === undefined ||
      parsed.data.longitude === undefined ||
      parsed.data.radiusMeters === undefined)
  ) {
    redirectWithMessage(
      managementPath(incidentId, "summary"),
      "error",
      "El área generalizada necesita coordenadas y un radio mínimo de 1.500 m.",
    );
  }
  const reason = reasonSchema.safeParse(formData.get("reason"));
  const expectedUpdatedAt = z.iso
    .datetime()
    .safeParse(formData.get("expectedUpdatedAt"));
  if (!reason.success || !expectedUpdatedAt.success) {
    redirectWithMessage(
      managementPath(incidentId, "summary"),
      "error",
      reason.success
        ? "La ficha está desactualizada; recarga la página."
        : firstIssue(reason.error),
    );
  }

  const generalized = parsed.data.mode === PublicLocationMode.GENERALIZED_AREA;
  const publicLatitude = generalized
    ? roundGeneralizedCoordinate(parsed.data.latitude!)
    : null;
  const publicLongitude = generalized
    ? roundGeneralizedCoordinate(parsed.data.longitude!)
    : null;
  const publicRadiusMeters = generalized ? parsed.data.radiusMeters! : null;
  try {
    await prisma.$transaction(
      async (transaction) => {
        const incident = await transaction.incident.findFirst({
          where: { id: incidentId, ...incidentScopeWhere(coordinator) },
        });
        if (!incident) fail("Incidente no encontrado.");
        if (!editableIncidentStatuses.includes(incident.status)) {
          fail("Reabre el incidente antes de cambiar su ubicación pública.");
        }
        const approvedAt = new Date();
        const updated = await transaction.incident.updateMany({
          where: {
            id: incident.id,
            updatedAt: new Date(expectedUpdatedAt.data),
          },
          data: {
            publicLocationMode: parsed.data.mode as PublicLocationMode,
            publicLocationLabel: parsed.data.label,
            publicLatitude,
            publicLongitude,
            publicRadiusMeters,
            publicLocationApprovedById: coordinator.id,
            publicLocationApprovedAt: approvedAt,
            lastActivityAt: approvedAt,
          },
        });
        if (updated.count !== 1) throw new ConcurrentMutationError();
        await writeAudit(transaction, {
          coordinator,
          incidentId: incident.id,
          municipalityId: incident.municipalityId,
          action: "incident.public_location_approved",
          entityType: "Incident",
          entityId: incident.id,
          metadata: {
            from: {
              mode: incident.publicLocationMode,
              label: incident.publicLocationLabel,
              publicLatitude: incident.publicLatitude?.toString() ?? null,
              publicLongitude: incident.publicLongitude?.toString() ?? null,
              publicRadiusMeters: incident.publicRadiusMeters,
              approvedAt: incident.publicLocationApprovedAt?.toISOString(),
            },
            to: {
              mode: parsed.data.mode,
              label: parsed.data.label,
              publicLatitude,
              publicLongitude,
              publicRadiusMeters,
              approvedAt: approvedAt.toISOString(),
            },
            reason: reason.data,
            safetyConfirmation: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirectWithMessage(
      managementPath(incidentId, "summary"),
      "error",
      operationalErrorMessage(
        error,
        "No se ha podido aprobar la ubicación pública.",
      ),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    managementPath(incidentId, "summary"),
    "notice",
    "Ubicación pública revisada y aprobada por una persona.",
  );
}

export async function updateIncidentStatus(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const parsedStatus = z
    .enum([
      "DRAFT",
      "PENDING_VALIDATION",
      "ACTIVE",
      "MONITORING",
      "RESOLVED",
      "CANCELLED",
    ])
    .safeParse(formData.get("status"));
  if (!parsedStatus.success) {
    redirectWithMessage(
      managementPath(incidentId),
      "error",
      "Estado de incidente no válido.",
    );
  }
  const status = parsedStatus.data as IncidentStatus;

  try {
    await prisma.$transaction(
      async (transaction) => {
        const incident = await transaction.incident.findFirst({
          where: { id: incidentId, ...incidentScopeWhere(coordinator) },
        });
        if (!incident) fail("Incidente no encontrado.");
        if (!incidentTransitions[incident.status].includes(status)) {
          fail("Ese cambio de estado no está permitido.");
        }

        const requiresReason =
          status === IncidentStatus.RESOLVED ||
          status === IncidentStatus.CANCELLED ||
          incident.status === IncidentStatus.RESOLVED;
        const reason = requiresReason
          ? requiredReason(formData.get("reason"))
          : optionalReason(formData.get("reason"));
        if (requiresReason && formData.get("confirmStatusChange") !== "on") {
          fail("Confirma que has revisado el impacto operativo y público.");
        }
        const now = new Date();

        if (status === IncidentStatus.ACTIVE) {
          const [activeSafePoint, dueNeed] = await Promise.all([
            transaction.safePoint.findFirst({
              where: {
                incidentId: incident.id,
                isActive: true,
                pointStatus: "ACTIVE",
                publishedAt: { not: null },
                validatedAt: { not: null },
                validatedById: { not: null },
              },
              select: { id: true },
            }),
            transaction.need.findFirst({
              where: {
                incidentId: incident.id,
                status: NeedStatus.ACTIVE,
                deadline: { lte: now },
              },
              select: { id: true },
            }),
          ]);
          if (!activeSafePoint) {
            fail(
              "Crea o habilita al menos un punto de entrega antes de publicar.",
            );
          }
          if (
            !incident.publicLocationApprovedAt ||
            !incident.publicLocationApprovedById
          ) {
            fail(
              "Revisa y aprueba primero la ubicación que verá la ciudadanía.",
            );
          }
          if (dueNeed) {
            fail("Hay necesidades activas con la fecha límite vencida.");
          }
        }

        if (
          status === IncidentStatus.RESOLVED ||
          status === IncidentStatus.CANCELLED
        ) {
          const [pendingDeliveries, unfinishedNeeds] = await Promise.all([
            transaction.contribution.count({
              where: {
                incidentId: incident.id,
                status: { in: outstandingContributionStatuses },
              },
            }),
            transaction.need.count({
              where: {
                incidentId: incident.id,
                status: { notIn: terminalNeedStatuses },
              },
            }),
          ]);
          if (pendingDeliveries > 0) {
            fail(
              `No se puede cerrar: quedan ${pendingDeliveries} entregas pendientes. Cancélalas, reasígnalas o complétalas primero.`,
            );
          }
          if (unfinishedNeeds > 0) {
            fail(
              `No se puede cerrar: quedan ${unfinishedNeeds} necesidades sin estado final.`,
            );
          }
        }

        await transaction.incident.update({
          where: { id: incident.id },
          data: {
            status,
            verifiedAt:
              incident.status === IncidentStatus.RESOLVED
                ? null
                : status === IncidentStatus.ACTIVE
                  ? (incident.verifiedAt ?? now)
                  : incident.verifiedAt,
            verifiedById:
              incident.status === IncidentStatus.RESOLVED
                ? null
                : status === IncidentStatus.ACTIVE
                  ? (incident.verifiedById ?? coordinator.id)
                  : incident.verifiedById,
            publicLocationApprovedAt:
              incident.status === IncidentStatus.RESOLVED
                ? null
                : incident.publicLocationApprovedAt,
            publicLocationApprovedById:
              incident.status === IncidentStatus.RESOLVED
                ? null
                : incident.publicLocationApprovedById,
            closedAt:
              status === IncidentStatus.RESOLVED ||
              status === IncidentStatus.CANCELLED
                ? now
                : incident.status === IncidentStatus.RESOLVED
                  ? null
                  : incident.closedAt,
            closedReason:
              status === IncidentStatus.RESOLVED ||
              status === IncidentStatus.CANCELLED
                ? reason
                : incident.status === IncidentStatus.RESOLVED
                  ? null
                  : incident.closedReason,
            organizationId:
              status === IncidentStatus.ACTIVE
                ? (incident.organizationId ?? coordinator.organizationId)
                : incident.organizationId,
            responsibleOrgName:
              status === IncidentStatus.ACTIVE
                ? (incident.responsibleOrgName ??
                  coordinator.organizationName ??
                  coordinator.municipalityName)
                : incident.responsibleOrgName,
            lastActivityAt: now,
          },
        });
        await writeAudit(transaction, {
          coordinator,
          incidentId: incident.id,
          municipalityId: incident.municipalityId,
          action: "incident.status_changed",
          entityType: "Incident",
          entityId: incident.id,
          metadata: { from: incident.status, to: status, reason },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirectWithMessage(
      managementPath(incidentId),
      "error",
      operationalErrorMessage(error, "No se ha podido cambiar el estado."),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    managementPath(incidentId),
    "notice",
    "Estado del incidente actualizado.",
  );
}

export async function createSafePoint(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const returnPath = managementPath(incidentId, "safe-points", formData);
  const idempotencyKey = idempotencyKeySchema.safeParse(
    formData.get("idempotencyKey"),
  );
  if (!idempotencyKey.success) {
    redirectWithMessage(returnPath, "error", firstIssue(idempotencyKey.error));
  }
  const parsed = safePointSchema.safeParse({
    incidentId,
    name: formData.get("name"),
    address: formData.get("address"),
    instructions: formData.get("instructions"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    radiusMeters: formData.get("radiusMeters"),
    capacityNote:
      String(formData.get("capacityNote") ?? "").trim() || undefined,
    pointType: formData.get("pointType") || "DROP_OFF",
  });
  if (!parsed.success) {
    redirectWithMessage(returnPath, "error", firstIssue(parsed.error));
  }
  if (formData.get("confirmSafePointSafety") !== "on") {
    redirectWithMessage(
      returnPath,
      "error",
      "Confirma que una persona responsable ha verificado la seguridad del punto.",
    );
  }
  const entityId = idempotentEntityId(
    "safe_point",
    coordinator.id,
    incidentId,
    idempotencyKey.data,
  );
  const replayFingerprint = idempotencyFingerprint("safe_point.create", {
    ...parsed.data,
    humanSafetyConfirmed: true,
  });

  try {
    await prisma.$transaction(
      async (transaction) => {
        const incident = await transaction.incident.findFirst({
          where: { id: incidentId, ...incidentScopeWhere(coordinator) },
        });
        if (!incident) fail("Incidente no encontrado.");
        if (!editableIncidentStatuses.includes(incident.status)) {
          fail("No se pueden crear puntos dentro de un incidente cerrado.");
        }

        const now = new Date();
        const point = await transaction.safePoint.create({
          data: {
            id: entityId,
            incidentId: incident.id,
            municipalityId: incident.municipalityId,
            organizationId:
              incident.organizationId ?? coordinator.organizationId,
            pointType: parsed.data.pointType,
            pointStatus: "ACTIVE",
            name: parsed.data.name,
            address: parsed.data.address ?? null,
            instructions: parsed.data.instructions ?? null,
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
            radiusMeters: parsed.data.radiusMeters,
            capacityNote: parsed.data.capacityNote ?? null,
            qrToken: randomBytes(18).toString("base64url"),
            validatedById: coordinator.id,
            validatedAt: now,
            publishedAt: now,
          },
        });
        await touchIncident(transaction, incident.id, now);
        await writeAudit(transaction, {
          coordinator,
          incidentId: incident.id,
          municipalityId: incident.municipalityId,
          action: "safe_point.created_and_validated",
          entityType: "SafePoint",
          entityId: point.id,
          metadata: {
            name: point.name,
            address: point.address,
            radiusMeters: point.radiusMeters,
            humanSafetyConfirmed: true,
            validatedAt: now.toISOString(),
            idempotencyFingerprint: replayFingerprint,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      isUniqueConstraintError(error) &&
      (await isMatchingIdempotentReplay(
        "SafePoint",
        entityId,
        "safe_point.created_and_validated",
        replayFingerprint,
      ))
    ) {
      redirectWithMessage(
        returnPath,
        "notice",
        "El punto de entrega ya estaba creado; se ha recuperado el primer envío.",
      );
    }
    redirectWithMessage(
      returnPath,
      "error",
      isUniqueConstraintError(error)
        ? "Este envío ya se utilizó con otros datos. Recarga el formulario."
        : operationalErrorMessage(
            error,
            "No se ha podido crear el punto de entrega.",
          ),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    returnPath,
    "notice",
    "Punto de entrega creado y habilitado.",
  );
}

export async function toggleSafePoint(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const returnPath = managementPath(incidentId, "safe-points", formData);
  const safePointId = String(formData.get("safePointId") ?? "");
  const parsedAction = z
    .enum(["approve", "deactivate", "reactivate"])
    .safeParse(formData.get("safePointAction"));
  if (!parsedAction.success) {
    redirectWithMessage(
      returnPath,
      "error",
      "Acción de punto de entrega no válida.",
    );
  }

  try {
    await prisma.$transaction(
      async (transaction) => {
        const point = await transaction.safePoint.findFirst({
          where: {
            id: safePointId,
            incidentId,
            incident: incidentScopeWhere(coordinator),
          },
          include: { incident: true },
        });
        if (!point) fail("Punto de entrega no encontrado.");
        const reason = requiredReason(formData.get("reason"));
        if (formData.get("confirmSafePointChange") !== "on") {
          fail("Confirma la revisión de seguridad y del impacto ciudadano.");
        }

        const action = parsedAction.data;
        if (
          (action === "approve" || action === "reactivate") &&
          !editableIncidentStatuses.includes(point.incident.status)
        ) {
          fail("No se puede publicar un punto dentro de un incidente cerrado.");
        }
        if (action === "approve" && (!point.isActive || point.validatedAt)) {
          fail("El punto no está pendiente de aprobación.");
        }
        if (action === "reactivate" && point.isActive) {
          fail("El punto ya está activo.");
        }
        if (action === "deactivate" && !point.isActive) {
          fail("El punto ya está inactivo.");
        }

        if (action === "deactivate") {
          const [activeNeeds, pendingDeliveries] = await Promise.all([
            transaction.need.count({
              where: { safePointId: point.id, status: NeedStatus.ACTIVE },
            }),
            transaction.contribution.count({
              where: {
                status: { in: outstandingContributionStatuses },
                OR: [
                  { safePointId: point.id },
                  { need: { safePointId: point.id } },
                ],
              },
            }),
          ]);
          if (activeNeeds > 0 || pendingDeliveries > 0) {
            fail(
              `No se puede desactivar: ${activeNeeds} necesidades activas y ${pendingDeliveries} entregas pendientes dependen del punto.`,
            );
          }
        }

        const now = new Date();
        await transaction.safePoint.update({
          where: { id: point.id },
          data:
            action === "deactivate"
              ? {
                  isActive: false,
                  pointStatus: "CLOSED",
                  closedAt: now,
                  deactivatedAt: now,
                  deactivationReason: reason,
                  validatedAt: null,
                  validatedById: null,
                }
              : action === "reactivate"
                ? {
                    isActive: true,
                    pointStatus: "ACTIVE",
                    publishedAt: now,
                    closedAt: null,
                    deactivatedAt: null,
                    deactivationReason: null,
                    validatedAt: now,
                    validatedById: coordinator.id,
                  }
                : {
                    validatedAt: now,
                    validatedById: coordinator.id,
                    pointStatus: "ACTIVE",
                    publishedAt: now,
                    closedAt: null,
                  },
        });
        await touchIncident(transaction, point.incidentId, now);
        await writeAudit(transaction, {
          coordinator,
          incidentId: point.incidentId,
          municipalityId: point.incident.municipalityId,
          action:
            action === "deactivate"
              ? "safe_point.deactivated"
              : action === "reactivate"
                ? "safe_point.reactivated_and_validated"
                : "safe_point.validated",
          entityType: "SafePoint",
          entityId: point.id,
          metadata: {
            reason,
            humanSafetyConfirmed: action !== "deactivate",
            validatedAt: action === "deactivate" ? null : now.toISOString(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirectWithMessage(
      returnPath,
      "error",
      operationalErrorMessage(
        error,
        "No se ha podido cambiar el punto de entrega.",
      ),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    returnPath,
    "notice",
    "Estado del punto de entrega actualizado.",
  );
}

export async function updateSafePoint(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const returnPath = managementPath(incidentId, "safe-points", formData);
  const safePointId = String(formData.get("safePointId") ?? "");
  const parsed = safePointSchema.safeParse({
    incidentId,
    name: formData.get("name"),
    address: formData.get("address"),
    instructions: formData.get("instructions"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    radiusMeters: formData.get("radiusMeters") || "30",
    capacityNote:
      String(formData.get("capacityNote") ?? "").trim() || undefined,
    pointType: formData.get("pointType") || "DROP_OFF",
  });
  const expectedUpdatedAt = z.iso
    .datetime()
    .safeParse(formData.get("expectedUpdatedAt"));
  if (!parsed.success || !expectedUpdatedAt.success) {
    redirectWithMessage(
      returnPath,
      "error",
      parsed.success
        ? "La ficha está desactualizada; recarga la página."
        : firstIssue(parsed.error),
    );
  }

  try {
    await prisma.$transaction(
      async (transaction) => {
        const point = await transaction.safePoint.findFirst({
          where: {
            id: safePointId,
            incidentId,
            incident: incidentScopeWhere(coordinator),
          },
          include: { incident: true },
        });
        if (!point) fail("Punto de entrega no encontrado.");
        if (!editableIncidentStatuses.includes(point.incident.status)) {
          fail(
            "No se puede modificar un punto dentro de un incidente cerrado.",
          );
        }
        const reason = requiredReason(formData.get("reason"));
        if (formData.get("confirmSafePointUpdate") !== "on") {
          fail("Confirma la revisión del impacto y la seguridad del punto.");
        }

        const [activeNeeds, pendingDeliveries] = await Promise.all([
          transaction.need.count({
            where: { safePointId: point.id, status: NeedStatus.ACTIVE },
          }),
          transaction.contribution.count({
            where: {
              status: { in: outstandingContributionStatuses },
              OR: [
                { safePointId: point.id },
                { need: { safePointId: point.id } },
              ],
            },
          }),
        ]);
        const destinationChanged =
          point.name !== parsed.data.name ||
          (point.address ?? "") !== (parsed.data.address ?? "") ||
          (point.instructions ?? "") !== (parsed.data.instructions ?? "") ||
          Number(point.latitude) !== parsed.data.latitude ||
          Number(point.longitude) !== parsed.data.longitude ||
          point.radiusMeters !== parsed.data.radiusMeters;
        if (pendingDeliveries > 0 && destinationChanged) {
          fail(
            "No se puede cambiar el destino mientras haya entregas pendientes. Resuélvelas o cancélalas antes de modificar nombre, dirección, instrucciones, coordenadas o radio.",
          );
        }
        const now = new Date();
        const updated = await transaction.safePoint.updateMany({
          where: {
            id: point.id,
            updatedAt: new Date(expectedUpdatedAt.data),
          },
          data: {
            name: parsed.data.name,
            address: parsed.data.address ?? null,
            instructions: parsed.data.instructions ?? null,
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
            radiusMeters: parsed.data.radiusMeters,
            capacityNote: parsed.data.capacityNote ?? null,
            pointType: parsed.data.pointType,
            validatedAt: point.isActive ? now : null,
            validatedById: point.isActive ? coordinator.id : null,
            publishedAt: point.isActive ? now : point.publishedAt,
          },
        });
        if (updated.count !== 1) throw new ConcurrentMutationError();

        await touchIncident(transaction, point.incidentId, now);
        await writeAudit(transaction, {
          coordinator,
          incidentId: point.incidentId,
          municipalityId: point.incident.municipalityId,
          action: "safe_point.updated_and_revalidated",
          entityType: "SafePoint",
          entityId: point.id,
          metadata: {
            before: {
              name: point.name,
              address: point.address,
              instructions: point.instructions,
              latitude: point.latitude.toString(),
              longitude: point.longitude.toString(),
              radiusMeters: point.radiusMeters,
              capacityNote: point.capacityNote,
            },
            after: {
              name: parsed.data.name,
              address: parsed.data.address ?? null,
              instructions: parsed.data.instructions ?? null,
              latitude: parsed.data.latitude,
              longitude: parsed.data.longitude,
              radiusMeters: parsed.data.radiusMeters,
              capacityNote: parsed.data.capacityNote ?? null,
            },
            impact: { activeNeeds, pendingDeliveries },
            reason,
            humanSafetyConfirmed: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirectWithMessage(
      returnPath,
      "error",
      operationalErrorMessage(
        error,
        "No se ha podido actualizar el punto de entrega.",
      ),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    returnPath,
    "notice",
    "Punto de entrega actualizado, revalidado y auditado.",
  );
}

export async function createNeed(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const returnPath = managementPath(incidentId, "needs", formData);
  const idempotencyKey = idempotencyKeySchema.safeParse(
    formData.get("idempotencyKey"),
  );
  if (!idempotencyKey.success) {
    redirectWithMessage(returnPath, "error", firstIssue(idempotencyKey.error));
  }
  const parsed = needSchema.safeParse({
    incidentId,
    safePointId: formData.get("safePointId"),
    type: formData.get("type"),
    title: formData.get("title"),
    description: String(formData.get("description") ?? "").trim() || undefined,
    priority: formData.get("priority"),
    quantityNeeded: formData.get("quantityNeeded"),
    unit: formData.get("unit"),
    publish: formData.get("publish") === "on",
  });
  if (!parsed.success) {
    redirectWithMessage(returnPath, "error", firstIssue(parsed.error));
  }
  const entityId = idempotentEntityId(
    "need",
    coordinator.id,
    incidentId,
    idempotencyKey.data,
  );
  const replayFingerprint = idempotencyFingerprint("need.create", {
    ...parsed.data,
    deadline: String(formData.get("deadline") ?? ""),
    deadlineOccurrence: String(formData.get("deadlineOccurrence") ?? "reject"),
  });

  try {
    await prisma.$transaction(
      async (transaction) => {
        const incident = await transaction.incident.findFirst({
          where: { id: incidentId, ...incidentScopeWhere(coordinator) },
        });
        if (!incident) fail("Incidente no encontrado.");
        if (!editableIncidentStatuses.includes(incident.status)) {
          fail(
            "No se pueden crear necesidades dentro de un incidente cerrado.",
          );
        }
        const point = await transaction.safePoint.findFirst({
          where: {
            id: parsed.data.safePointId,
            incidentId: incident.id,
            isActive: true,
            validatedAt: { not: null },
            validatedById: { not: null },
          },
        });
        if (!point) fail("Selecciona un punto de entrega activo y validado.");

        const requestingOrganization =
          coordinator.organizationId && incident.municipalityId
            ? await transaction.organization.findFirst({
                where: {
                  id: coordinator.organizationId,
                  municipalityId: incident.municipalityId,
                },
                select: { id: true },
              })
            : null;

        const deadline = parseDeadline(
          formData.get("deadline"),
          incident.timeZone,
          {
            allowEmpty: true,
            requireFuture: true,
            disambiguation: deadlineDisambiguation(
              formData.get("deadlineOccurrence"),
            ),
          },
        );
        if (
          parsed.data.publish &&
          (!incident.verifiedAt ||
            !incident.verifiedById ||
            !incident.publicLocationApprovedAt ||
            !incident.publicLocationApprovedById ||
            !publishedIncidentStatuses.includes(incident.status))
        ) {
          fail(
            "No se puede publicar todavía: el incidente necesita validación humana y estado activo.",
          );
        }

        const now = new Date();
        const need = await transaction.need.create({
          data: {
            id: entityId,
            incidentId: incident.id,
            safePointId: point.id,
            type: parsed.data.type as NeedType,
            title: parsed.data.title,
            description: parsed.data.description ?? null,
            priority: parsed.data.priority as Priority,
            quantityNeeded: parsed.data.quantityNeeded,
            unit: parsed.data.unit,
            deadline,
            status: parsed.data.publish ? NeedStatus.ACTIVE : NeedStatus.DRAFT,
            requestingOrganizationId: requestingOrganization?.id ?? null,
            requestedById: coordinator.id,
            validatedById: parsed.data.publish ? coordinator.id : null,
            validatedAt: parsed.data.publish ? now : null,
            publishedAt: parsed.data.publish ? now : null,
          },
        });
        await touchIncident(transaction, incident.id, now);
        await writeAudit(transaction, {
          coordinator,
          incidentId: incident.id,
          municipalityId: incident.municipalityId,
          action: "need.created",
          entityType: "Need",
          entityId: need.id,
          metadata: {
            published: parsed.data.publish,
            quantityNeeded: need.quantityNeeded,
            unit: need.unit,
            deadline: deadline?.toISOString(),
            safePointId: point.id,
            idempotencyFingerprint: replayFingerprint,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      isUniqueConstraintError(error) &&
      (await isMatchingIdempotentReplay(
        "Need",
        entityId,
        "need.created",
        replayFingerprint,
      ))
    ) {
      redirectWithMessage(
        returnPath,
        "notice",
        "La necesidad ya estaba creada; se ha recuperado el primer envío.",
      );
    }
    redirectWithMessage(
      returnPath,
      "error",
      isUniqueConstraintError(error)
        ? "Este envío ya se utilizó con otros datos. Recarga el formulario."
        : operationalErrorMessage(error, "No se ha podido crear la necesidad."),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    returnPath,
    "notice",
    parsed.data.publish
      ? "Necesidad validada y publicada."
      : "Necesidad guardada como borrador.",
  );
}

export async function updateNeed(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const returnPath = managementPath(incidentId, "needs", formData);
  const needId = String(formData.get("needId") ?? "");
  const quantity = z.coerce
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .safeParse(formData.get("quantityNeeded"));
  if (!quantity.success) {
    redirectWithMessage(
      returnPath,
      "error",
      "Indica una cantidad total válida.",
    );
  }

  try {
    await prisma.$transaction(
      async (transaction) => {
        const need = await transaction.need.findFirst({
          where: {
            id: needId,
            incidentId,
            incident: incidentScopeWhere(coordinator),
          },
          include: { incident: true, safePoint: true },
        });
        if (!need) fail("Necesidad no encontrada.");
        if (
          need.status === NeedStatus.CANCELLED ||
          need.status === NeedStatus.EXPIRED
        ) {
          fail("Una necesidad cancelada o caducada no se puede editar.");
        }
        const reason = requiredReason(formData.get("reason"));
        if (formData.get("confirmNeedUpdate") !== "on") {
          fail(
            "Confirma que has revisado el impacto sobre las entregas pendientes.",
          );
        }
        const deadline = parseDeadline(
          formData.get("deadline"),
          need.incident.timeZone,
          {
            allowEmpty: true,
            requireFuture: true,
            disambiguation: deadlineDisambiguation(
              formData.get("deadlineOccurrence"),
            ),
          },
        );
        const [commitments, incompatibleEta] = await Promise.all([
          transaction.contribution.aggregate({
            where: {
              needId: need.id,
              status: { in: outstandingContributionStatuses },
            },
            _sum: { quantity: true, deliveredQuantity: true },
          }),
          deadline
            ? transaction.contribution.findFirst({
                where: {
                  needId: need.id,
                  status: { in: outstandingContributionStatuses },
                  eta: { gt: deadline },
                },
                select: { id: true },
              })
            : Promise.resolve(null),
        ]);
        const committed = Math.max(
          0,
          Number(commitments._sum.quantity ?? 0) -
            Number(commitments._sum.deliveredQuantity ?? 0),
        );
        const protectedQuantity = need.quantityReceived + committed;
        if (quantity.data < protectedQuantity) {
          fail(
            `La cantidad total no puede ser menor que ${protectedQuantity}: ${need.quantityReceived} recibidas y ${committed} aún comprometidas.`,
          );
        }
        if (incompatibleEta) {
          fail(
            "El nuevo plazo es anterior a una llegada ya comprometida. Reasigna o cancela esa aportación antes de acortar el plazo.",
          );
        }

        const nextStatus =
          need.status === NeedStatus.COVERED &&
          quantity.data > need.quantityReceived
            ? need.validatedAt &&
              need.validatedById &&
              need.publishedAt &&
              need.safePoint.isActive &&
              need.safePoint.validatedAt &&
              need.safePoint.validatedById &&
              need.incident.verifiedAt &&
              need.incident.verifiedById &&
              need.incident.publicLocationApprovedAt &&
              need.incident.publicLocationApprovedById &&
              publishedIncidentStatuses.includes(need.incident.status)
              ? NeedStatus.ACTIVE
              : NeedStatus.DRAFT
            : need.status;
        const updated = await transaction.need.updateMany({
          where: { id: need.id, updatedAt: need.updatedAt },
          data: {
            quantityNeeded: quantity.data,
            deadline,
            status: nextStatus,
          },
        });
        if (updated.count !== 1) throw new ConcurrentMutationError();

        await touchIncident(transaction, need.incidentId);
        await writeAudit(transaction, {
          coordinator,
          incidentId: need.incidentId,
          municipalityId: need.incident.municipalityId,
          action: "need.updated",
          entityType: "Need",
          entityId: need.id,
          metadata: {
            before: {
              quantityNeeded: need.quantityNeeded,
              deadline: need.deadline?.toISOString(),
              status: need.status,
            },
            after: {
              quantityNeeded: quantity.data,
              deadline: deadline?.toISOString(),
              status: nextStatus,
            },
            protectedQuantity,
            reason,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirectWithMessage(
      returnPath,
      "error",
      operationalErrorMessage(
        error,
        "No se ha podido actualizar la necesidad.",
      ),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    returnPath,
    "notice",
    "Necesidad actualizada y auditada.",
  );
}

export async function updateNeedStatus(formData: FormData) {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const returnPath = managementPath(incidentId, "needs", formData);
  const needId = String(formData.get("needId") ?? "");
  const parsedStatus = z
    .enum(["DRAFT", "ACTIVE", "COVERED", "CANCELLED", "EXPIRED"])
    .safeParse(formData.get("status"));
  if (!parsedStatus.success) {
    redirectWithMessage(returnPath, "error", "Estado de necesidad no válido.");
  }
  const status = parsedStatus.data as NeedStatus;

  try {
    await prisma.$transaction(
      async (transaction) => {
        const need = await transaction.need.findFirst({
          where: {
            id: needId,
            incidentId,
            incident: incidentScopeWhere(coordinator),
          },
          include: { incident: true, safePoint: true },
        });
        if (!need) fail("Necesidad no encontrada.");
        if (!needTransitions[need.status].includes(status)) {
          fail("Ese cambio de estado de la necesidad no está permitido.");
        }

        const now = new Date();
        const reason = requiredReason(formData.get("reason"));
        if (formData.get("confirmNeedStatusChange") !== "on") {
          fail("Confirma que has revisado las aportaciones y la publicación.");
        }

        if (status === NeedStatus.ACTIVE) {
          if (
            !need.incident.verifiedAt ||
            !need.incident.verifiedById ||
            !need.incident.publicLocationApprovedAt ||
            !need.incident.publicLocationApprovedById ||
            !need.safePoint.isActive ||
            !need.safePoint.validatedAt ||
            !need.safePoint.validatedById ||
            !publishedIncidentStatuses.includes(need.incident.status)
          ) {
            fail(
              "La emergencia validada y el punto de entrega deben estar activos para publicar.",
            );
          }
          if (need.deadline && need.deadline <= now) {
            fail("Actualiza o elimina la fecha límite vencida antes de publicar.");
          }
        }
        if (
          status === NeedStatus.COVERED &&
          need.quantityReceived < need.quantityNeeded
        ) {
          fail(
            "Solo se puede cubrir cuando la cantidad recibida alcanza el total.",
          );
        }
        if (
          status === NeedStatus.ACTIVE &&
          need.status === NeedStatus.COVERED &&
          need.quantityReceived >= need.quantityNeeded
        ) {
          fail(
            "Aumenta primero la cantidad solicitada por encima de lo ya recibido antes de reabrir.",
          );
        }
        if (status === NeedStatus.EXPIRED) {
          if (!need.deadline || need.deadline > now) {
            fail(
              "Solo se puede caducar una necesidad cuya fecha límite ya venció.",
            );
          }
        }
        if (status === NeedStatus.CANCELLED || status === NeedStatus.EXPIRED) {
          const pending = await transaction.contribution.count({
            where: {
              needId: need.id,
              status: { in: outstandingContributionStatuses },
            },
          });
          if (pending > 0) {
            fail(
              `Quedan ${pending} aportaciones pendientes. Cancélalas, reasígnalas o complétalas primero.`,
            );
          }
        }

        await transaction.need.update({
          where: { id: need.id },
          data: {
            status,
            validatedById:
              status === NeedStatus.ACTIVE
                ? coordinator.id
                : need.validatedById,
            validatedAt: status === NeedStatus.ACTIVE ? now : need.validatedAt,
            publishedAt:
              status === NeedStatus.ACTIVE
                ? (need.publishedAt ?? now)
                : need.publishedAt,
            cancelledAt:
              status === NeedStatus.CANCELLED ? now : need.cancelledAt,
            cancellationReason:
              status === NeedStatus.CANCELLED
                ? reason
                : need.cancellationReason,
          },
        });
        await touchIncident(transaction, need.incidentId, now);
        await writeAudit(transaction, {
          coordinator,
          incidentId: need.incidentId,
          municipalityId: need.incident.municipalityId,
          action: "need.status_changed",
          entityType: "Need",
          entityId: need.id,
          metadata: { from: need.status, to: status, reason },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirectWithMessage(
      returnPath,
      "error",
      operationalErrorMessage(error, "No se ha podido cambiar la necesidad."),
    );
  }

  revalidateIncident(incidentId);
  redirectWithMessage(
    returnPath,
    "notice",
    "Estado de la necesidad actualizado.",
  );
}

export type ContributionUpdateState = {
  ok: boolean;
  message: string;
  revision?: number;
};

export async function updateContributionStatus(
  _state: ContributionUpdateState,
  formData: FormData,
): Promise<ContributionUpdateState> {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const contributionId = String(formData.get("contributionId") ?? "");
  const parsedStatus = z
    .enum([
      "PLEDGED",
      "EN_ROUTE",
      "PARTIALLY_DELIVERED",
      "DELIVERED",
      "CANCELLED",
      "NO_SHOW",
    ])
    .safeParse(formData.get("status"));
  const deliveredInput = z.coerce
    .number()
    .int()
    .min(0)
    .safeParse(formData.get("deliveredQuantity") ?? 0);
  const revisionInput = z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .safeParse(String(formData.get("revision") ?? "").trim() || undefined);
  if (
    !parsedStatus.success ||
    !deliveredInput.success ||
    !revisionInput.success
  ) {
    return { ok: false, message: "Revisa el estado y la cantidad entregada." };
  }
  const status = parsedStatus.data as ContributionStatus;

  try {
    const nextRevision = await prisma.$transaction(
      async (transaction) => {
        const contribution = await transaction.contribution.findFirst({
          where: {
            id: contributionId,
            incidentId,
            incident: incidentScopeWhere(coordinator),
          },
          include: {
            safePoint: true,
            incident: true,
            need: { include: { safePoint: true } },
          },
        });
        if (!contribution) fail("Aportación no encontrada.");
        if (
          revisionInput.data !== undefined &&
          revisionInput.data !== contribution.revision
        ) {
          throw new ConcurrentMutationError();
        }
        if (!contributionTransitions[contribution.status].includes(status)) {
          fail("Ese cambio retrocede o altera un estado ya finalizado.");
        }

        const operationalStatuses: ContributionStatus[] = [
          ContributionStatus.EN_ROUTE,
          ContributionStatus.PARTIALLY_DELIVERED,
          ContributionStatus.DELIVERED,
        ];
        if (operationalStatuses.includes(status)) {
          if (
            !contribution.safePoint ||
            !contribution.safePointId ||
            contribution.safePoint.incidentId !== contribution.incidentId ||
            (contribution.need &&
              (contribution.safePointId !== contribution.need.safePointId ||
                contribution.safePoint.id !== contribution.need.safePoint.id ||
                contribution.need.incidentId !== contribution.incidentId ||
                contribution.need.safePoint.incidentId !==
                  contribution.incidentId))
          ) {
            fail(
              "El destino asignado ya no coincide con el punto de entrega de la solicitud. No inicies ni confirmes el trayecto hasta revisar la asignación.",
            );
          }
          const destination = contribution.safePoint;
          const incident = contribution.incident;
          if (
            !destination.isActive ||
            !destination.validatedAt ||
            !destination.validatedById ||
            (!contribution.need &&
              (destination.pointStatus !== "ACTIVE" ||
                !destination.publishedAt))
          ) {
            fail(
              "El punto de entrega ya no está activo y validado. Cancela la aportación o revisa el destino.",
            );
          }
          if (
            (contribution.need &&
              (contribution.need.status !== NeedStatus.ACTIVE ||
                !contribution.need.validatedAt ||
                !contribution.need.validatedById ||
                !contribution.need.publishedAt)) ||
            !publishedIncidentStatuses.includes(incident.status) ||
            !incident.verifiedAt ||
            !incident.verifiedById ||
            !incident.publicLocationApprovedAt ||
            !incident.publicLocationApprovedById
          ) {
            fail(
              "La emergencia o la solicitud asociada ya no están operativas y validadas.",
            );
          }
          if (
            status === ContributionStatus.EN_ROUTE &&
            contribution.need &&
            contribution.need.deadline &&
            contribution.need.deadline.getTime() <= Date.now()
          ) {
            fail("No se puede iniciar el trayecto después de la fecha límite.");
          }
        }

        let deliveredQuantity = contribution.deliveredQuantity;
        if (status === ContributionStatus.DELIVERED) {
          deliveredQuantity = contribution.quantity;
        } else if (status === ContributionStatus.PARTIALLY_DELIVERED) {
          deliveredQuantity = deliveredInput.data;
          if (
            deliveredQuantity <= contribution.deliveredQuantity ||
            deliveredQuantity >= contribution.quantity
          ) {
            fail(
              `La entrega parcial debe superar ${contribution.deliveredQuantity} y ser menor que ${contribution.quantity}.`,
            );
          }
        }
        if (deliveredQuantity < contribution.deliveredQuantity) {
          fail("No se puede descontar material que ya fue recepcionado.");
        }

        const reason =
          status === ContributionStatus.CANCELLED ||
          status === ContributionStatus.NO_SHOW
            ? requiredReason(formData.get("reason"))
            : optionalReason(formData.get("reason"));
        if (
          (status === ContributionStatus.CANCELLED ||
            status === ContributionStatus.NO_SHOW) &&
          formData.get("confirmContributionStatus") !== "on"
        ) {
          fail("Confirma que has verificado el resultado de la aportación.");
        }
        const delta = deliveredQuantity - contribution.deliveredQuantity;
        if (
          delta > 0 &&
          contribution.need &&
          contribution.need.quantityReceived + delta >
            contribution.need.quantityNeeded
        ) {
          fail(
            `Solo se pueden recepcionar ${Math.max(0, contribution.need.quantityNeeded - contribution.need.quantityReceived)} ${contribution.need.unit}. Registra una entrega parcial.`,
          );
        }

        const updatedContribution = await transaction.contribution.updateMany({
          where: {
            id: contribution.id,
            revision: contribution.revision,
            status: contribution.status,
            deliveredQuantity: contribution.deliveredQuantity,
          },
          data: {
            status,
            deliveredQuantity,
            statusReason: reason ?? null,
            revision: { increment: 1 },
            checkedInAt:
              delta > 0
                ? (contribution.checkedInAt ?? new Date())
                : contribution.checkedInAt,
            cancelledAt:
              status === ContributionStatus.CANCELLED
                ? new Date()
                : contribution.cancelledAt,
          },
        });
        if (updatedContribution.count !== 1)
          throw new ConcurrentMutationError();

        let nextNeedStatus = contribution.need?.status;
        if (delta > 0 && contribution.need && contribution.needId) {
          const updatedNeed = await transaction.need.updateMany({
            where: {
              id: contribution.needId,
              quantityReceived: {
                lte: contribution.need.quantityNeeded - delta,
              },
            },
            data: { quantityReceived: { increment: delta } },
          });
          if (updatedNeed.count !== 1) {
            fail("La necesidad ha alcanzado su cantidad total.");
          }
          if (
            contribution.need.quantityReceived + delta >=
            contribution.need.quantityNeeded
          ) {
            nextNeedStatus = NeedStatus.COVERED;
            await transaction.need.update({
              where: { id: contribution.needId },
              data: { status: NeedStatus.COVERED },
            });
          }
        }

        const now = new Date();
        await touchIncident(transaction, contribution.incidentId, now);
        await writeAudit(transaction, {
          coordinator,
          incidentId: contribution.incidentId,
          municipalityId: contribution.incident.municipalityId,
          action: "contribution.status_changed",
          entityType: "Contribution",
          entityId: contribution.id,
          metadata: {
            from: contribution.status,
            to: status,
            deliveredBefore: contribution.deliveredQuantity,
            deliveredAfter: deliveredQuantity,
            needStatus: nextNeedStatus,
            reason,
            revisionBefore: contribution.revision,
          },
        });
        return contribution.revision + 1;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    revalidateIncident(incidentId);
    return {
      ok: true,
      message: "Aportación actualizada y auditada.",
      revision: nextRevision,
    };
  } catch (error) {
    return {
      ok: false,
      message: operationalErrorMessage(
        error,
        "No se ha podido actualizar la aportación.",
      ),
    };
  }
}

export type ContributionReassignState = ContributionUpdateState;

export type ContributionReassignmentTarget = {
  id: string;
  title: string;
  safePointName: string;
  remaining: number;
  unit: string;
};

export type ContributionReassignmentTargetsResult = {
  ok: boolean;
  message: string;
  targets: ContributionReassignmentTarget[];
};

const maximumReassignmentTargets = 500;

export async function getContributionReassignmentTargets(
  incidentId: string,
  contributionId: string,
): Promise<ContributionReassignmentTargetsResult> {
  const coordinator = await assertCoordinator();
  const identifiers = z
    .object({
      incidentId: z.string().min(1).max(191),
      contributionId: z.string().min(1).max(191),
    })
    .safeParse({ incidentId, contributionId });
  if (!identifiers.success) {
    return { ok: false, message: "Aportación no válida.", targets: [] };
  }

  try {
    const contribution = await prisma.contribution.findFirst({
      where: {
        id: contributionId,
        incidentId,
        incident: incidentScopeWhere(coordinator),
      },
      select: {
        id: true,
        needId: true,
        quantity: true,
        deliveredQuantity: true,
        eta: true,
        status: true,
        need: { select: { type: true, unit: true } },
      },
    });
    if (
      !contribution ||
      !contribution.need ||
      !contribution.needId ||
      contribution.status !== ContributionStatus.PLEDGED ||
      contribution.deliveredQuantity !== 0
    ) {
      return {
        ok: false,
        message: "Esta aportación ya no admite reasignación.",
        targets: [],
      };
    }

    const now = new Date();
    const candidates = await prisma.need.findMany({
      where: {
        incidentId,
        id: { not: contribution.needId },
        type: contribution.need.type,
        unit: contribution.need.unit,
        status: NeedStatus.ACTIVE,
        validatedAt: { not: null },
        validatedById: { not: null },
        publishedAt: { not: null },
        OR: [{ deadline: null }, { deadline: { gt: now } }],
        safePoint: {
          isActive: true,
          validatedAt: { not: null },
          validatedById: { not: null },
        },
        incident: {
          ...incidentScopeWhere(coordinator),
          status: { in: publishedIncidentStatuses },
          verifiedAt: { not: null },
          verifiedById: { not: null },
          publicLocationApprovedAt: { not: null },
          publicLocationApprovedById: { not: null },
        },
      },
      orderBy: [{ deadline: "asc" }, { title: "asc" }, { id: "asc" }],
      take: maximumReassignmentTargets + 1,
      select: {
        id: true,
        title: true,
        quantityNeeded: true,
        quantityReceived: true,
        unit: true,
        deadline: true,
        safePoint: { select: { name: true } },
        contributions: {
          where: { status: { in: outstandingContributionStatuses } },
          select: { quantity: true, deliveredQuantity: true },
        },
      },
    });

    if (candidates.length > maximumReassignmentTargets) {
      return {
        ok: false,
        message:
          "Hay demasiados destinos posibles para una reasignación segura. Filtra o divide las necesidades antes de continuar.",
        targets: [],
      };
    }

    const targets = candidates.flatMap((candidate) => {
      if (
        candidate.deadline &&
        contribution.eta &&
        contribution.eta > candidate.deadline
      ) {
        return [];
      }
      const committed = candidate.contributions.reduce(
        (total, item) =>
          total + Math.max(0, item.quantity - item.deliveredQuantity),
        0,
      );
      const remaining = Math.max(
        0,
        candidate.quantityNeeded - candidate.quantityReceived - committed,
      );
      if (remaining < contribution.quantity) return [];
      return [
        {
          id: candidate.id,
          title: candidate.title,
          safePointName: candidate.safePoint.name,
          remaining,
          unit: candidate.unit,
        },
      ];
    });

    return {
      ok: true,
      message:
        targets.length > 0
          ? "Destinos seguros actualizados."
          : "No hay otra necesidad compatible con capacidad y plazo suficientes.",
      targets,
    };
  } catch (error) {
    console.error("Contribution reassignment targets failed", error);
    return {
      ok: false,
      message: "No se han podido comprobar los destinos seguros.",
      targets: [],
    };
  }
}

export async function reassignContribution(
  _state: ContributionReassignState,
  formData: FormData,
): Promise<ContributionReassignState> {
  const coordinator = await assertCoordinator();
  const incidentId = String(formData.get("incidentId") ?? "");
  const contributionId = String(formData.get("contributionId") ?? "");
  const targetNeedId = String(formData.get("targetNeedId") ?? "");

  try {
    const nextRevision = await prisma.$transaction(
      async (transaction) => {
        const contribution = await transaction.contribution.findFirst({
          where: {
            id: contributionId,
            incidentId,
            incident: incidentScopeWhere(coordinator),
          },
          include: { incident: true, need: true },
        });
        if (!contribution) fail("Aportación no encontrada.");
        if (!contribution.need || !contribution.needId) {
          fail(
            "Una aportación directa se gestiona en su punto de entrega y no necesita reasignarse a una solicitud.",
          );
        }
        if (
          contribution.status !== ContributionStatus.PLEDGED ||
          contribution.deliveredQuantity !== 0
        ) {
          fail(
            "Solo se pueden reasignar aportaciones confirmadas que aún no están en camino ni tienen recepción.",
          );
        }
        if (contribution.needId === targetNeedId) {
          fail("Selecciona una necesidad distinta.");
        }
        const suppliedRevision = Number(formData.get("revision"));
        if (
          Number.isInteger(suppliedRevision) &&
          suppliedRevision > 0 &&
          suppliedRevision !== contribution.revision
        ) {
          throw new ConcurrentMutationError();
        }
        const reason = requiredReason(formData.get("reason"));
        if (formData.get("confirmReassignment") !== "on") {
          fail("Confirma la revisión del destino y de su capacidad restante.");
        }
        const target = await transaction.need.findFirst({
          where: {
            id: targetNeedId,
            incidentId,
            status: NeedStatus.ACTIVE,
            validatedAt: { not: null },
            validatedById: { not: null },
            publishedAt: { not: null },
          },
          include: { safePoint: true, incident: true },
        });
        if (
          !target ||
          !target.safePoint.isActive ||
          !target.safePoint.validatedAt ||
          !target.safePoint.validatedById ||
          !target.incident.verifiedAt ||
          !target.incident.verifiedById ||
          !target.incident.publicLocationApprovedAt ||
          !target.incident.publicLocationApprovedById ||
          !publishedIncidentStatuses.includes(target.incident.status) ||
          (target.deadline !== null && target.deadline <= new Date())
        ) {
          fail("La necesidad de destino ya no admite aportaciones.");
        }
        if (
          target.type !== contribution.need.type ||
          target.unit.trim().toLocaleLowerCase("es-ES") !==
            contribution.need.unit.trim().toLocaleLowerCase("es-ES")
        ) {
          fail(
            "La necesidad de destino debe tener el mismo tipo y la misma unidad.",
          );
        }
        if (
          contribution.eta &&
          target.deadline &&
          contribution.eta > target.deadline
        ) {
          fail(
            "La llegada estimada supera el plazo del nuevo destino; actualiza el compromiso antes de reasignarlo.",
          );
        }
        const commitments = await transaction.contribution.aggregate({
          where: {
            needId: target.id,
            status: { in: outstandingContributionStatuses },
          },
          _sum: { quantity: true, deliveredQuantity: true },
        });
        const committed = Math.max(
          0,
          Number(commitments._sum.quantity ?? 0) -
            Number(commitments._sum.deliveredQuantity ?? 0),
        );
        const remaining = Math.max(
          0,
          target.quantityNeeded - target.quantityReceived - committed,
        );
        if (contribution.quantity > remaining) {
          fail(
            `La necesidad de destino solo admite ${remaining} ${target.unit}.`,
          );
        }

        const updated = await transaction.contribution.updateMany({
          where: { id: contribution.id, revision: contribution.revision },
          data: {
            needId: target.id,
            safePointId: target.safePointId,
            revision: { increment: 1 },
            statusReason: reason,
          },
        });
        if (updated.count !== 1) throw new ConcurrentMutationError();

        await touchIncident(transaction, incidentId);
        await writeAudit(transaction, {
          coordinator,
          incidentId,
          municipalityId: contribution.incident.municipalityId,
          action: "contribution.reassigned",
          entityType: "Contribution",
          entityId: contribution.id,
          metadata: {
            fromNeedId: contribution.needId,
            toNeedId: target.id,
            fromSafePointId: contribution.safePointId,
            toSafePointId: target.safePointId,
            quantity: contribution.quantity,
            reason,
          },
        });
        return contribution.revision + 1;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    revalidateIncident(incidentId);
    return {
      ok: true,
      message: "Aportación reasignada.",
      revision: nextRevision,
    };
  } catch (error) {
    return {
      ok: false,
      message: operationalErrorMessage(
        error,
        "No se ha podido reasignar la aportación.",
      ),
    };
  }
}
