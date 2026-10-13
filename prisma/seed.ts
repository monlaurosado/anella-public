import { createHash } from "node:crypto";

import { compare, hash } from "bcryptjs";
import mariadb from "mariadb";
import { z } from "zod";

import {
  ContributionStatus,
  DetectionSource,
  DropOffPointStatus,
  ExternalDetectionStatus,
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  OrganizationKind,
  OrganizationVerificationStatus,
  Priority,
  PublicLocationMode,
  UserRole,
} from "../src/generated/prisma/enums";
import { prisma } from "../src/lib/db";
import { assertSeedEnvironment } from "../src/config/seed-environment";

const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .email()
    .transform((value) => value.toLowerCase())
    .optional(),
);

const optionalPassword = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .min(12)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "La contraseña no puede superar 72 bytes UTF-8.",
    )
    .optional(),
);

const seedSchema = z.object({
  environment: z
    .enum(["development", "test", "staging", "production"])
    .optional(),
  databaseUrl: z.string().min(1),
  adminEmail: optionalEmail,
  adminPassword: optionalPassword,
  adminName: z.string().min(2).default("Coordinación municipal"),
  municipalityName: z.string().min(2).default("Municipio piloto"),
  organizationName: z.string().min(2).default("Protección Civil municipal"),
  demoData: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  resetAdminPassword: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  bootstrapAdmin: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  bootstrapTicket: z.string().trim().min(6).max(191).optional(),
  bootstrapOperator: z.string().trim().min(3).max(191).optional(),
});

function readSeedConfig() {
  return seedSchema.parse({
    environment: process.env.ANELLA_ENV,
    databaseUrl: process.env.DATABASE_URL,
    adminEmail: process.env.SEED_ADMIN_EMAIL,
    adminPassword: process.env.SEED_ADMIN_PASSWORD,
    adminName: process.env.SEED_ADMIN_NAME,
    municipalityName: process.env.SEED_MUNICIPALITY_NAME,
    organizationName: process.env.SEED_ORGANIZATION_NAME,
    demoData: process.env.SEED_DEMO_DATA,
    resetAdminPassword: process.env.SEED_RESET_ADMIN_PASSWORD,
    bootstrapAdmin: process.env.SEED_BOOTSTRAP_ADMIN,
    bootstrapTicket: process.env.SEED_BOOTSTRAP_TICKET,
    bootstrapOperator: process.env.SEED_BOOTSTRAP_OPERATOR,
  });
}

function at(anchor: Date, hours: number) {
  return new Date(anchor.getTime() + hours * 60 * 60 * 1_000);
}

function simulationTokenHash(label: string) {
  return createHash("sha256")
    .update(`ANella SIMULACRO local:${label}`)
    .digest("hex");
}

async function ensureMunicipalityAndOrganization(config: {
  municipalityName: string;
  organizationName: string;
}) {
  let municipality = await prisma.municipality.findFirst({
    where: {
      name: config.municipalityName,
      country: "ES",
    },
    orderBy: { id: "asc" },
  });

  municipality ??= await prisma.municipality.create({
    data: {
      name: config.municipalityName,
      province: "Barcelona",
      region: "Catalunya",
      country: "ES",
      latitude: 41.61,
      longitude: 2.29,
    },
  });

  let organization = await prisma.organization.findFirst({
    where: {
      name: config.organizationName,
      municipalityId: municipality.id,
    },
    orderBy: { id: "asc" },
  });

  organization ??= await prisma.organization.create({
    data: {
      name: config.organizationName,
      kind: OrganizationKind.CIVIL_PROTECTION,
      verificationStatus: OrganizationVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      contactEmail: "simulacro-proteccion-civil@example.invalid",
      municipalityId: municipality.id,
    },
  });

  if (
    organization.verificationStatus !== OrganizationVerificationStatus.VERIFIED
  ) {
    organization = await prisma.organization.update({
      where: { id: organization.id },
      data: {
        verificationStatus: OrganizationVerificationStatus.VERIFIED,
        verifiedAt: organization.verifiedAt ?? new Date(),
      },
    });
  }

  return { municipality, organization };
}

async function ensureLocalUser(input: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  municipalityId: string;
  organizationId: string;
  resetPassword?: boolean;
}) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existing) {
    const tenantMatches =
      existing.municipalityId === input.municipalityId &&
      existing.organizationId === input.organizationId;

    if (existing.role !== input.role || !existing.isActive || !tenantMatches) {
      throw new Error(
        `El usuario ${input.email} ya existe con rol, estado o tenant distintos. El seed no eleva roles, reactiva cuentas ni reasigna usuarios existentes.`,
      );
    }

    if (!input.resetPassword) {
      return existing;
    }

    const passwordHash = await hash(input.password, 12);

    return prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        credentialsChangedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
    });
  }

  const passwordHash = await hash(input.password, 12);

  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      isActive: true,
      // Las credenciales conocidas son exclusivas del entorno local de prueba.
      // En producción, las cuentas temporales se crean por el flujo de equipo y
      // siempre fuerzan el primer cambio de clave.
      mustChangePassword: false,
      credentialsChangedAt: new Date(),
      municipalityId: input.municipalityId,
      organizationId: input.organizationId,
    },
  });
}

function assertProductionBootstrapConfig(
  config: ReturnType<typeof readSeedConfig>,
) {
  const forbidden =
    /anella\.local|AnellaLocal|simulacro|piloto|prueba|example|replace|change-me|pendiente/i;
  if (
    !config.adminEmail ||
    !config.adminPassword ||
    !config.bootstrapTicket ||
    !config.bootstrapOperator
  ) {
    throw new Error(
      "El bootstrap requiere SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_BOOTSTRAP_TICKET y SEED_BOOTSTRAP_OPERATOR.",
    );
  }
  if (
    config.adminPassword.length < 16 ||
    Buffer.byteLength(config.adminPassword, "utf8") > 72 ||
    new Set(config.adminPassword).size < 10 ||
    [
      config.adminEmail,
      config.adminPassword,
      config.adminName,
      config.municipalityName,
      config.organizationName,
      config.bootstrapTicket,
      config.bootstrapOperator,
    ].some((value) => forbidden.test(value))
  ) {
    throw new Error(
      "El bootstrap productivo rechaza credenciales locales, datos de simulacro y marcadores de posición.",
    );
  }
}

async function bootstrapProductionAdmin(
  config: ReturnType<typeof readSeedConfig>,
) {
  assertProductionBootstrapConfig(config);
  const passwordHash = await hash(config.adminPassword!, 12);
  const lockName = "anella:production-admin-bootstrap:v1";
  const databaseUrl = new URL(config.databaseUrl);
  databaseUrl.protocol = "mariadb:";
  if (databaseUrl.searchParams.get("sslaccept") === "strict") {
    databaseUrl.searchParams.delete("sslaccept");
    databaseUrl.searchParams.set("ssl", "true");
  }
  const lockConnection = await mariadb.createConnection(databaseUrl.toString());
  let lockAcquired = false;

  try {
    const rows = (await lockConnection.query(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [lockName],
    )) as Array<{ acquired: number | bigint | null }>;
    if (Number(rows[0]?.acquired ?? 0) !== 1) {
      throw new Error("No se ha podido adquirir el lock del bootstrap.");
    }
    lockAcquired = true;

    return await prisma.$transaction(async (transaction) => {
      let municipality = await transaction.municipality.findFirst({
        where: { name: config.municipalityName, country: "ES" },
        orderBy: { id: "asc" },
      });
      municipality ??= await transaction.municipality.create({
        data: { name: config.municipalityName, country: "ES" },
      });

      let organization = await transaction.organization.findFirst({
        where: {
          name: config.organizationName,
          municipalityId: municipality.id,
        },
        orderBy: { id: "asc" },
      });
      organization ??= await transaction.organization.create({
        data: {
          name: config.organizationName,
          kind: OrganizationKind.MUNICIPALITY,
          verificationStatus: OrganizationVerificationStatus.VERIFIED,
          verifiedAt: new Date(),
          municipalityId: municipality.id,
        },
      });

      const existing = await transaction.user.findUnique({
        where: { email: config.adminEmail! },
      });
      if (existing) {
        const bootstrapAudits = await transaction.auditLog.findMany({
          where: {
            municipalityId: municipality.id,
            action: "user.production_bootstrapped",
            entityType: "User",
            entityId: existing.id,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 2,
        });
        const bootstrapMetadata = bootstrapAudits[0]?.metadata;
        const metadata =
          bootstrapMetadata &&
          typeof bootstrapMetadata === "object" &&
          !Array.isArray(bootstrapMetadata)
            ? (bootstrapMetadata as Record<string, unknown>)
            : undefined;
        const credentialMatches = existing.passwordHash
          ? await compare(config.adminPassword!, existing.passwordHash)
          : false;
        if (
          existing.role !== UserRole.MUNICIPAL_ADMIN ||
          !existing.isActive ||
          existing.disabledAt ||
          !existing.mustChangePassword ||
          !existing.credentialsChangedAt ||
          existing.municipalityId !== municipality.id ||
          existing.organizationId !== organization.id ||
          !credentialMatches ||
          bootstrapAudits.length !== 1 ||
          metadata?.ticket !== config.bootstrapTicket ||
          metadata?.operator !== config.bootstrapOperator ||
          metadata?.mustChangePassword !== true ||
          metadata?.credentialTransmittedOutOfBand !== true
        ) {
          throw new Error(
            "La cuenta de bootstrap preexistente no acredita origen, credencial temporal, estado o pertenencia exactos; no se modificará.",
          );
        }
        return { created: false, user: existing };
      }

      const now = new Date();
      const user = await transaction.user.create({
        data: {
          email: config.adminEmail!,
          name: config.adminName,
          passwordHash,
          role: UserRole.MUNICIPAL_ADMIN,
          isActive: true,
          mustChangePassword: true,
          credentialsChangedAt: now,
          municipalityId: municipality.id,
          organizationId: organization.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          municipalityId: municipality.id,
          action: "user.production_bootstrapped",
          entityType: "User",
          entityId: user.id,
          metadata: {
            ticket: config.bootstrapTicket,
            operator: config.bootstrapOperator,
            role: user.role,
            mustChangePassword: true,
            credentialTransmittedOutOfBand: true,
          },
        },
      });
      return { created: true, user };
    });
  } finally {
    try {
      if (lockAcquired) {
        await lockConnection.query("SELECT RELEASE_LOCK(?)", [lockName]);
      }
    } finally {
      await lockConnection.end();
    }
  }
}

async function seedSimulation(input: {
  municipalityId: string;
  municipalityName: string;
  organizationId: string;
  organizationName: string;
  actorId: string;
}) {
  const anchor = new Date();
  anchor.setUTCMinutes(0, 0, 0);

  const incidentSpecs = [
    {
      key: "draft",
      publicCode: "SIM-DRAFT-001",
      title: "SIMULACRO · Incidente en borrador",
      type: IncidentType.OTHER,
      status: IncidentStatus.DRAFT,
      priority: Priority.LOW,
      description:
        "SIMULACRO: borrador interno para practicar la preparación previa.",
      publicSummary:
        "SIMULACRO: este incidente no representa una emergencia real.",
      operationalLatitude: 41.5904,
      operationalLongitude: 2.2511,
      radiusMeters: 1_200,
      publicLocationMode: PublicLocationMode.MUNICIPALITY_ONLY,
      publicLatitude: null,
      publicLongitude: null,
      publicRadiusMeters: null,
      publicLocationLabel: input.municipalityName,
      isVerified: false,
      closedAt: null,
      closedReason: null,
      lastActivityAt: at(anchor, -30),
    },
    {
      key: "pending",
      publicCode: "SIM-PENDING-001",
      title: "SIMULACRO · Incidente pendiente de validación",
      type: IncidentType.FLOOD,
      status: IncidentStatus.PENDING_VALIDATION,
      priority: Priority.HIGH,
      description:
        "SIMULACRO: señal interna pendiente de validación municipal.",
      publicSummary:
        "SIMULACRO: este incidente no representa una emergencia real.",
      operationalLatitude: 41.6217,
      operationalLongitude: 2.2734,
      radiusMeters: 1_800,
      publicLocationMode: PublicLocationMode.MUNICIPALITY_ONLY,
      publicLatitude: null,
      publicLongitude: null,
      publicRadiusMeters: null,
      publicLocationLabel: input.municipalityName,
      isVerified: false,
      closedAt: null,
      closedReason: null,
      lastActivityAt: at(anchor, -18),
    },
    {
      key: "active",
      publicCode: "DEMO-001",
      title: "SIMULACRO · Incendio forestal activo",
      type: IncidentType.WILDFIRE,
      status: IncidentStatus.ACTIVE,
      priority: Priority.CRITICAL,
      description:
        "SIMULACRO: escenario operativo para validar coordinación y entregas seguras.",
      publicSummary:
        "SIMULACRO: ejercicio municipal sin emergencia real. Puedes comunicar voluntariamente qué material llevarás a un punto habilitado.",
      operationalLatitude: 41.6082,
      operationalLongitude: 2.2864,
      radiusMeters: 1_500,
      publicLocationMode: PublicLocationMode.GENERALIZED_AREA,
      // Coordenadas publicas deliberadamente generalizadas: nunca se copian de la ubicacion operativa.
      publicLatitude: 41.62,
      publicLongitude: 2.3,
      publicRadiusMeters: 5_000,
      publicLocationLabel: `Area general de ${input.municipalityName}`,
      isVerified: true,
      closedAt: null,
      closedReason: null,
      lastActivityAt: at(anchor, -1),
    },
    {
      key: "monitoring",
      publicCode: "SIM-MONITOR-001",
      title: "SIMULACRO · Incidente en seguimiento",
      type: IncidentType.STORM,
      status: IncidentStatus.MONITORING,
      priority: Priority.MEDIUM,
      description:
        "SIMULACRO: fase de seguimiento sin nuevas solicitudes públicas.",
      publicSummary: "SIMULACRO: seguimiento preventivo, sin emergencia real.",
      operationalLatitude: 41.6331,
      operationalLongitude: 2.3218,
      radiusMeters: 2_000,
      publicLocationMode: PublicLocationMode.SAFE_POINTS_ONLY,
      publicLatitude: null,
      publicLongitude: null,
      publicRadiusMeters: null,
      publicLocationLabel: "Solo puntos de entrega publicados",
      isVerified: true,
      closedAt: null,
      closedReason: null,
      lastActivityAt: at(anchor, -8),
    },
    {
      key: "resolved",
      publicCode: "SIM-RESOLVED-001",
      title: "SIMULACRO · Incidente resuelto",
      type: IncidentType.POWER_OUTAGE,
      status: IncidentStatus.RESOLVED,
      priority: Priority.LOW,
      description:
        "SIMULACRO: expediente finalizado y conservado para auditoría.",
      publicSummary:
        "SIMULACRO: ejercicio finalizado; no existe una emergencia real.",
      operationalLatitude: 41.6022,
      operationalLongitude: 2.3339,
      radiusMeters: 900,
      publicLocationMode: PublicLocationMode.MUNICIPALITY_ONLY,
      publicLatitude: null,
      publicLongitude: null,
      publicRadiusMeters: null,
      publicLocationLabel: input.municipalityName,
      isVerified: true,
      closedAt: at(anchor, -48),
      closedReason: "SIMULACRO: objetivos del ejercicio completados.",
      lastActivityAt: at(anchor, -48),
    },
    {
      key: "cancelled",
      publicCode: "SIM-CANCEL-001",
      title: "SIMULACRO · Incidente cancelado",
      type: IncidentType.SEARCH_RESCUE,
      status: IncidentStatus.CANCELLED,
      priority: Priority.MEDIUM,
      description:
        "SIMULACRO: expediente cancelado para probar cierres con motivo.",
      publicSummary:
        "SIMULACRO: ejercicio cancelado; no existe una emergencia real.",
      operationalLatitude: 41.5754,
      operationalLongitude: 2.3042,
      radiusMeters: 1_100,
      publicLocationMode: PublicLocationMode.MUNICIPALITY_ONLY,
      publicLatitude: null,
      publicLongitude: null,
      publicRadiusMeters: null,
      publicLocationLabel: input.municipalityName,
      isVerified: true,
      closedAt: at(anchor, -72),
      closedReason:
        "SIMULACRO: escenario duplicado, cancelado por coordinación.",
      lastActivityAt: at(anchor, -72),
    },
  ];

  const incidents = new Map<
    string,
    Awaited<ReturnType<typeof prisma.incident.upsert>>
  >();

  for (const spec of incidentSpecs) {
    const verifiedAt = spec.isVerified ? at(anchor, -96) : null;
    const hasHumanPublicApproval = spec.isVerified;
    const commonData = {
      title: spec.title,
      type: spec.type,
      status: spec.status,
      priority: spec.priority,
      description: spec.description,
      publicSummary: spec.publicSummary,
      safetyNotice:
        "SIMULACRO: no acudas a la zona operativa. Entrega solo en puntos de entrega habilitados. En una emergencia real, llama al 112.",
      operationalLatitude: spec.operationalLatitude,
      operationalLongitude: spec.operationalLongitude,
      radiusMeters: spec.radiusMeters,
      publicLocationMode: spec.publicLocationMode,
      publicLatitude: spec.publicLatitude,
      publicLongitude: spec.publicLongitude,
      publicRadiusMeters: spec.publicRadiusMeters,
      publicLocationLabel: spec.publicLocationLabel,
      publicLocationApprovedById: hasHumanPublicApproval ? input.actorId : null,
      publicLocationApprovedAt: hasHumanPublicApproval ? at(anchor, -90) : null,
      timeZone: "Europe/Madrid",
      responsibleOrgName: input.organizationName,
      organizationId: input.organizationId,
      municipalityId: input.municipalityId,
      createdById: input.actorId,
      verifiedById: spec.isVerified ? input.actorId : null,
      verifiedAt,
      closedAt: spec.closedAt,
      closedReason: spec.closedReason,
      lastActivityAt: spec.lastActivityAt,
    };

    const incident = await prisma.incident.upsert({
      where: { publicCode: spec.publicCode },
      update: commonData,
      create: {
        publicCode: spec.publicCode,
        ...commonData,
      },
    });

    incidents.set(spec.key, incident);
  }

  const activeIncident = incidents.get("active");

  if (!activeIncident) {
    throw new Error("No se ha podido crear el incidente activo de SIMULACRO.");
  }

  const safePointSpecs = [
    {
      key: "sports-center",
      qrToken: "simulacro-punto-polideportivo",
      legacyQrToken: "demo-punto-seguro",
      name: "SIMULACRO · Polideportivo municipal",
      address: "Avinguda del SIMULACRO, 18",
      instructions:
        "SIMULACRO: entrada de aportaciones por la puerta norte identificada como punto de entrega.",
      latitude: 41.6111,
      longitude: 2.2912,
      capacityNote: "SIMULACRO: descarga de vehículos ligeros",
      contactName: "SIMULACRO · Mesa de recepción A",
      isActive: true,
      deactivatedAt: null,
      deactivationReason: null,
    },
    {
      key: "civic-center",
      qrToken: "simulacro-punto-centro-civico",
      legacyQrToken: null,
      name: "SIMULACRO · Centro cívico",
      address: "Carrer del SIMULACRO, 7",
      instructions:
        "SIMULACRO: acceso peatonal accesible y mostrador de recepción señalizado.",
      latitude: 41.6156,
      longitude: 2.2978,
      capacityNote: "SIMULACRO: recepción de pequeño volumen",
      contactName: "SIMULACRO · Mesa de recepción B",
      isActive: true,
      deactivatedAt: null,
      deactivationReason: null,
    },
    {
      key: "inactive-warehouse",
      qrToken: "simulacro-punto-almacen-inactivo",
      legacyQrToken: null,
      name: "SIMULACRO · Almacén desactivado",
      address: "Passeig del SIMULACRO, 3",
      instructions:
        "SIMULACRO: punto cerrado; no se deben dirigir aportaciones aquí.",
      latitude: 41.6068,
      longitude: 2.2801,
      capacityNote: "SIMULACRO: fuera de servicio",
      contactName: "SIMULACRO · Punto cerrado",
      isActive: false,
      deactivatedAt: at(anchor, -12),
      deactivationReason:
        "SIMULACRO: acceso cerrado para practicar la desactivación segura.",
    },
  ];

  const safePoints = new Map<
    string,
    Awaited<ReturnType<typeof prisma.safePoint.upsert>>
  >();

  for (const spec of safePointSpecs) {
    const legacy = spec.legacyQrToken
      ? await prisma.safePoint.findUnique({
          where: { qrToken: spec.legacyQrToken },
        })
      : null;
    const qrToken = legacy ? spec.legacyQrToken! : spec.qrToken;
    const commonData = {
      incidentId: activeIncident.id,
      municipalityId: input.municipalityId,
      name: spec.name,
      address: spec.address,
      instructions: spec.instructions,
      latitude: spec.latitude,
      longitude: spec.longitude,
      capacityNote: spec.capacityNote,
      contactName: spec.contactName,
      isActive: spec.isActive,
      pointStatus: spec.isActive
        ? DropOffPointStatus.ACTIVE
        : DropOffPointStatus.CLOSED,
      publishedAt: spec.isActive ? at(anchor, -24) : null,
      closedAt: spec.isActive ? null : (spec.deactivatedAt ?? at(anchor, -24)),
      deactivatedAt: spec.deactivatedAt,
      deactivationReason: spec.deactivationReason,
      validatedById: spec.isActive ? input.actorId : null,
      validatedAt: spec.isActive ? at(anchor, -24) : null,
    };

    const safePoint = await prisma.safePoint.upsert({
      where: { qrToken },
      update: commonData,
      create: {
        qrToken,
        ...commonData,
      },
    });

    safePoints.set(spec.key, safePoint);
  }

  const sportsCenter = safePoints.get("sports-center");
  const civicCenter = safePoints.get("civic-center");
  const inactiveWarehouse = safePoints.get("inactive-warehouse");

  if (!sportsCenter || !civicCenter || !inactiveWarehouse) {
    throw new Error("No se han podido crear los puntos seguros de SIMULACRO.");
  }

  const needSpecs = [
    {
      key: "draft",
      id: "sim-need-draft",
      legacyTitle: null,
      safePointId: civicCenter.id,
      type: NeedType.OTHER,
      title: "SIMULACRO · Necesidad en borrador",
      description: "SIMULACRO: solicitud interna aún no validada ni publicada.",
      priority: Priority.LOW,
      quantityNeeded: 30,
      quantityReceived: 0,
      unit: "uds",
      deadline: at(anchor, 96),
      status: NeedStatus.DRAFT,
      validatedAt: null,
      publishedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      key: "open",
      id: "sim-need-open",
      legacyTitle: "Agua embotellada (simulacro)",
      safePointId: sportsCenter.id,
      type: NeedType.WATER,
      title: "SIMULACRO · Necesidad activa sin compromisos",
      description:
        "SIMULACRO: agua embotellada solicitada para practicar la publicación.",
      priority: Priority.CRITICAL,
      quantityNeeded: 100,
      quantityReceived: 0,
      unit: "paquetes",
      deadline: at(anchor, 72),
      status: NeedStatus.ACTIVE,
      validatedAt: at(anchor, -20),
      publishedAt: at(anchor, -19),
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      key: "committed",
      id: "sim-need-committed",
      legacyTitle: null,
      safePointId: civicCenter.id,
      type: NeedType.FOOD,
      title: "SIMULACRO · Necesidad con aportación comprometida",
      description:
        "SIMULACRO: alimentos no perecederos con una aportación pendiente.",
      priority: Priority.HIGH,
      quantityNeeded: 100,
      quantityReceived: 0,
      unit: "cajas",
      deadline: at(anchor, 48),
      status: NeedStatus.ACTIVE,
      validatedAt: at(anchor, -18),
      publishedAt: at(anchor, -17),
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      key: "en-route",
      id: "sim-need-en-route",
      legacyTitle: null,
      safePointId: sportsCenter.id,
      type: NeedType.ICE,
      title: "SIMULACRO · Necesidad con aportación en camino",
      description:
        "SIMULACRO: suministro en camino hacia un punto seguro publicado.",
      priority: Priority.HIGH,
      quantityNeeded: 120,
      quantityReceived: 0,
      unit: "bolsas",
      deadline: at(anchor, 24),
      status: NeedStatus.ACTIVE,
      validatedAt: at(anchor, -16),
      publishedAt: at(anchor, -15),
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      key: "partial",
      id: "sim-need-partial",
      legacyTitle: null,
      safePointId: civicCenter.id,
      type: NeedType.TOOLS,
      title: "SIMULACRO · Necesidad parcialmente recibida",
      description:
        "SIMULACRO: parte del material ya fue registrado en recepción.",
      priority: Priority.MEDIUM,
      quantityNeeded: 100,
      quantityReceived: 15,
      unit: "kits",
      deadline: at(anchor, 8),
      status: NeedStatus.ACTIVE,
      validatedAt: at(anchor, -14),
      publishedAt: at(anchor, -13),
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      key: "covered",
      id: "sim-need-covered",
      legacyTitle: null,
      safePointId: sportsCenter.id,
      type: NeedType.MEDICAL_SUPPLIES,
      title: "SIMULACRO · Necesidad cubierta",
      description: "SIMULACRO: cantidad completa recibida y necesidad cerrada.",
      priority: Priority.HIGH,
      quantityNeeded: 40,
      quantityReceived: 40,
      unit: "kits",
      deadline: at(anchor, 12),
      status: NeedStatus.COVERED,
      validatedAt: at(anchor, -36),
      publishedAt: at(anchor, -35),
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      key: "expired",
      id: "sim-need-expired",
      legacyTitle: null,
      safePointId: civicCenter.id,
      type: NeedType.TRANSPORT,
      title: "SIMULACRO · Necesidad caducada",
      description:
        "SIMULACRO: plazo vencido para comprobar el cierre automatico seguro.",
      priority: Priority.MEDIUM,
      quantityNeeded: 20,
      quantityReceived: 0,
      unit: "plazas",
      deadline: at(anchor, -24),
      status: NeedStatus.EXPIRED,
      validatedAt: at(anchor, -72),
      publishedAt: at(anchor, -71),
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      key: "cancelled",
      id: "sim-need-cancelled",
      legacyTitle: null,
      safePointId: inactiveWarehouse.id,
      type: NeedType.SHELTER,
      title: "SIMULACRO · Necesidad cancelada",
      description:
        "SIMULACRO: solicitud retirada con motivo operativo documentado.",
      priority: Priority.LOW,
      quantityNeeded: 30,
      quantityReceived: 0,
      unit: "plazas",
      deadline: at(anchor, 24),
      status: NeedStatus.CANCELLED,
      validatedAt: at(anchor, -48),
      publishedAt: at(anchor, -47),
      cancelledAt: at(anchor, -12),
      cancellationReason:
        "SIMULACRO: punto seguro desactivado antes de recibir aportaciones.",
    },
  ];

  const needs = new Map<
    string,
    Awaited<ReturnType<typeof prisma.need.upsert>>
  >();

  for (const spec of needSpecs) {
    const existingById = await prisma.need.findUnique({
      where: { id: spec.id },
    });
    const existingByTitle = existingById
      ? null
      : await prisma.need.findFirst({
          where: {
            incidentId: activeIncident.id,
            title: spec.title,
          },
          orderBy: { id: "asc" },
        });
    const legacy =
      existingById || existingByTitle || !spec.legacyTitle
        ? null
        : await prisma.need.findFirst({
            where: {
              incidentId: activeIncident.id,
              title: spec.legacyTitle,
            },
            orderBy: { id: "asc" },
          });
    const existing = existingById ?? existingByTitle ?? legacy;
    const commonData = {
      incidentId: activeIncident.id,
      safePointId: spec.safePointId,
      type: spec.type,
      title: spec.title,
      description: spec.description,
      priority: spec.priority,
      quantityNeeded: spec.quantityNeeded,
      quantityReceived: spec.quantityReceived,
      unit: spec.unit,
      deadline: spec.deadline,
      status: spec.status,
      requestingOrganizationId: input.organizationId,
      requestedById: input.actorId,
      validatedById: spec.validatedAt ? input.actorId : null,
      validatedAt: spec.validatedAt,
      publishedAt: spec.publishedAt,
      cancelledAt: spec.cancelledAt,
      cancellationReason: spec.cancellationReason,
    };

    const need = existing
      ? await prisma.need.update({
          where: { id: existing.id },
          data: commonData,
        })
      : await prisma.need.upsert({
          where: { id: spec.id },
          update: commonData,
          create: {
            id: spec.id,
            ...commonData,
          },
        });

    needs.set(spec.key, need);
  }

  const contributionSpecs = [
    {
      publicCode: "SIM-AP-0001",
      needKey: "committed",
      safePointId: civicCenter.id,
      citizenName: "SIMULACRO · Persona 01",
      quantity: 20,
      deliveredQuantity: 0,
      eta: at(anchor, 5),
      status: ContributionStatus.PLEDGED,
      statusReason: null,
      checkedInAt: null,
      cancelledAt: null,
      revision: 1,
      createdAt: at(anchor, -4),
    },
    {
      publicCode: "SIM-AP-0002",
      needKey: "en-route",
      safePointId: sportsCenter.id,
      citizenName: "SIMULACRO · Persona 02",
      quantity: 25,
      deliveredQuantity: 0,
      eta: at(anchor, 2),
      status: ContributionStatus.EN_ROUTE,
      statusReason: "SIMULACRO: salida confirmada hacia el punto seguro.",
      checkedInAt: null,
      cancelledAt: null,
      revision: 2,
      createdAt: at(anchor, -6),
    },
    {
      publicCode: "SIM-AP-0003",
      needKey: "partial",
      safePointId: civicCenter.id,
      citizenName: "SIMULACRO · Persona 03",
      quantity: 30,
      deliveredQuantity: 15,
      eta: at(anchor, -1),
      status: ContributionStatus.PARTIALLY_DELIVERED,
      statusReason: "SIMULACRO: recepción parcial registrada.",
      checkedInAt: at(anchor, -1),
      cancelledAt: null,
      revision: 3,
      createdAt: at(anchor, -10),
    },
    {
      publicCode: "SIM-AP-0004",
      needKey: "covered",
      safePointId: sportsCenter.id,
      citizenName: "SIMULACRO · Persona 04",
      quantity: 40,
      deliveredQuantity: 40,
      eta: at(anchor, -4),
      status: ContributionStatus.DELIVERED,
      statusReason: "SIMULACRO: entrega completa verificada.",
      checkedInAt: at(anchor, -3),
      cancelledAt: null,
      revision: 2,
      createdAt: at(anchor, -20),
    },
    {
      publicCode: "SIM-AP-0005",
      needKey: "cancelled",
      safePointId: inactiveWarehouse.id,
      citizenName: "SIMULACRO · Persona 05",
      quantity: 10,
      deliveredQuantity: 0,
      eta: at(anchor, -10),
      status: ContributionStatus.CANCELLED,
      statusReason:
        "SIMULACRO: compromiso cancelado antes de desactivar el punto.",
      checkedInAt: null,
      cancelledAt: at(anchor, -13),
      revision: 2,
      createdAt: at(anchor, -30),
    },
    {
      publicCode: "SIM-AP-0006",
      needKey: "expired",
      safePointId: civicCenter.id,
      citizenName: "SIMULACRO · Persona 06",
      quantity: 12,
      deliveredQuantity: 0,
      eta: at(anchor, -28),
      status: ContributionStatus.NO_SHOW,
      statusReason: "SIMULACRO: aportación no presentada antes del plazo.",
      checkedInAt: null,
      cancelledAt: at(anchor, -24),
      revision: 2,
      createdAt: at(anchor, -50),
    },
  ];

  const contributions: Array<
    Awaited<ReturnType<typeof prisma.contribution.upsert>>
  > = [];

  for (const [index, spec] of contributionSpecs.entries()) {
    const need = needs.get(spec.needKey);

    if (!need) {
      throw new Error(`Falta la necesidad ${spec.needKey} del SIMULACRO.`);
    }

    const commonData = {
      cancelTokenHash: simulationTokenHash(spec.publicCode),
      incidentId: need.incidentId,
      needId: need.id,
      safePointId: spec.safePointId,
      citizenName: spec.citizenName,
      citizenPhone: `+34000000${String(index + 1).padStart(3, "0")}`,
      citizenEmail: `simulacro+${index + 1}@example.invalid`,
      quantity: spec.quantity,
      deliveredQuantity: spec.deliveredQuantity,
      eta: spec.eta,
      status: spec.status,
      statusReason: spec.statusReason,
      revision: spec.revision,
      notes:
        "SIMULACRO: datos ficticios para probar coordinación; no contactar.",
      consentAt: spec.createdAt,
      checkedInAt: spec.checkedInAt,
      cancelledAt: spec.cancelledAt,
    };

    const contribution = await prisma.contribution.upsert({
      where: { publicCode: spec.publicCode },
      update: commonData,
      create: {
        publicCode: spec.publicCode,
        createdAt: spec.createdAt,
        ...commonData,
      },
    });

    contributions.push(contribution);
  }

  const pendingDetection = await prisma.externalDetection.upsert({
    where: { externalId: "SIM-DETECTION-PENDING-001" },
    update: {
      source: DetectionSource.NASA_FIRMS,
      latitude: 41.6473,
      longitude: 2.3412,
      detectedAt: at(anchor, -2),
      brightness: 312.4,
      confidence: "SIMULACRO HIGH",
      status: ExternalDetectionStatus.PENDING,
      rawJson: {
        simulation: true,
        notice: "SIMULACRO: señal externa pendiente de validación humana.",
      },
      municipalityId: input.municipalityId,
      linkedIncidentId: null,
    },
    create: {
      externalId: "SIM-DETECTION-PENDING-001",
      source: DetectionSource.NASA_FIRMS,
      latitude: 41.6473,
      longitude: 2.3412,
      detectedAt: at(anchor, -2),
      brightness: 312.4,
      confidence: "SIMULACRO HIGH",
      status: ExternalDetectionStatus.PENDING,
      rawJson: {
        simulation: true,
        notice: "SIMULACRO: señal externa pendiente de validación humana.",
      },
      municipalityId: input.municipalityId,
    },
  });

  const linkedDetection = await prisma.externalDetection.upsert({
    where: { externalId: "SIM-DETECTION-LINKED-001" },
    update: {
      source: DetectionSource.EFFIS,
      latitude: 41.6082,
      longitude: 2.2864,
      detectedAt: at(anchor, -26),
      brightness: null,
      confidence: "SIMULACRO REVIEWED",
      status: ExternalDetectionStatus.LINKED,
      rawJson: {
        simulation: true,
        notice: "SIMULACRO: señal revisada y vinculada internamente.",
      },
      municipalityId: input.municipalityId,
      linkedIncidentId: activeIncident.id,
    },
    create: {
      externalId: "SIM-DETECTION-LINKED-001",
      source: DetectionSource.EFFIS,
      latitude: 41.6082,
      longitude: 2.2864,
      detectedAt: at(anchor, -26),
      confidence: "SIMULACRO REVIEWED",
      status: ExternalDetectionStatus.LINKED,
      rawJson: {
        simulation: true,
        notice: "SIMULACRO: señal revisada y vinculada internamente.",
      },
      municipalityId: input.municipalityId,
      linkedIncidentId: activeIncident.id,
    },
  });

  const dismissedDetection = await prisma.externalDetection.upsert({
    where: { externalId: "SIM-DETECTION-DISMISSED-001" },
    update: {
      source: DetectionSource.MANUAL,
      latitude: 41.5712,
      longitude: 2.2447,
      detectedAt: at(anchor, -40),
      brightness: null,
      confidence: "SIMULACRO FALSE POSITIVE",
      status: ExternalDetectionStatus.DISMISSED,
      rawJson: {
        simulation: true,
        notice: "SIMULACRO: falso positivo descartado por coordinación.",
      },
      municipalityId: input.municipalityId,
      linkedIncidentId: null,
    },
    create: {
      externalId: "SIM-DETECTION-DISMISSED-001",
      source: DetectionSource.MANUAL,
      latitude: 41.5712,
      longitude: 2.2447,
      detectedAt: at(anchor, -40),
      confidence: "SIMULACRO FALSE POSITIVE",
      status: ExternalDetectionStatus.DISMISSED,
      rawJson: {
        simulation: true,
        notice: "SIMULACRO: falso positivo descartado por coordinación.",
      },
      municipalityId: input.municipalityId,
    },
  });

  const auditEntries = [
    ...incidentSpecs.map((spec) => ({
      id: `sim-audit-incident-${spec.key}`,
      incidentId: incidents.get(spec.key)!.id,
      action: "SIMULATION_INCIDENT_STATE_SEEDED",
      entityType: "Incident",
      entityId: incidents.get(spec.key)!.id,
      metadata: {
        simulation: true,
        publicCode: spec.publicCode,
        status: spec.status,
        message: "SIMULACRO: estado de incidente preparado para validación.",
      },
      createdAt: spec.lastActivityAt,
    })),
    ...needSpecs.map((spec) => ({
      id: `sim-audit-need-${spec.key}`,
      incidentId: activeIncident.id,
      action: "SIMULATION_NEED_STATE_SEEDED",
      entityType: "Need",
      entityId: needs.get(spec.key)!.id,
      metadata: {
        simulation: true,
        status: spec.status,
        quantityNeeded: spec.quantityNeeded,
        quantityReceived: spec.quantityReceived,
        message: "SIMULACRO: estado de necesidad preparado para validación.",
      },
      createdAt: spec.publishedAt ?? at(anchor, -6),
    })),
    ...contributionSpecs.map((spec, index) => ({
      id: `sim-audit-contribution-${index + 1}`,
      incidentId: activeIncident.id,
      action: "SIMULATION_CONTRIBUTION_STATE_SEEDED",
      entityType: "Contribution",
      entityId: contributions[index]!.id,
      metadata: {
        simulation: true,
        publicCode: spec.publicCode,
        status: spec.status,
        quantity: spec.quantity,
        deliveredQuantity: spec.deliveredQuantity,
        message: "SIMULACRO: estado de aportación preparado para validación.",
      },
      createdAt: spec.createdAt,
    })),
    {
      id: "sim-audit-detection-pending",
      incidentId: null,
      action: "SIMULATION_DETECTION_PENDING_SEEDED",
      entityType: "ExternalDetection",
      entityId: pendingDetection.id,
      metadata: {
        simulation: true,
        status: ExternalDetectionStatus.PENDING,
        message: "SIMULACRO: señal externa privada pendiente de revisión.",
      },
      createdAt: at(anchor, -2),
    },
    {
      id: "sim-audit-detection-linked",
      incidentId: activeIncident.id,
      action: "SIMULATION_DETECTION_LINKED_SEEDED",
      entityType: "ExternalDetection",
      entityId: linkedDetection.id,
      metadata: {
        simulation: true,
        status: ExternalDetectionStatus.LINKED,
        message: "SIMULACRO: señal externa vinculada tras revisión.",
      },
      createdAt: at(anchor, -25),
    },
    {
      id: "sim-audit-detection-dismissed",
      incidentId: null,
      action: "SIMULATION_DETECTION_DISMISSED_SEEDED",
      entityType: "ExternalDetection",
      entityId: dismissedDetection.id,
      metadata: {
        simulation: true,
        status: ExternalDetectionStatus.DISMISSED,
        message: "SIMULACRO: señal externa descartada tras revisión.",
      },
      createdAt: at(anchor, -39),
    },
  ];

  for (const entry of auditEntries) {
    await prisma.auditLog.upsert({
      where: { id: entry.id },
      update: {
        actorId: input.actorId,
        incidentId: entry.incidentId,
        municipalityId: input.municipalityId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
      },
      create: {
        id: entry.id,
        actorId: input.actorId,
        incidentId: entry.incidentId,
        municipalityId: input.municipalityId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      },
    });
  }

  console.log(
    "SIMULACRO preparado: 6 incidentes, 3 puntos, 8 necesidades, 6 aportaciones y 3 detecciones.",
  );
}

async function seed() {
  const config = readSeedConfig();
  const effectiveEnvironment = assertSeedEnvironment(
    config.environment,
    config.databaseUrl,
  );
  const isProduction = effectiveEnvironment === "production";

  if (isProduction && config.demoData) {
    throw new Error("SEED_DEMO_DATA no está permitido en producción.");
  }

  if (isProduction && config.resetAdminPassword) {
    throw new Error(
      "SEED_RESET_ADMIN_PASSWORD no esta permitido en produccion. Gestiona credenciales mediante el flujo seguro de usuarios.",
    );
  }

  if (isProduction) {
    if (!config.bootstrapAdmin) {
      console.log(
        "Seed productivo sin cambios: activa SEED_BOOTSTRAP_ADMIN=true solo para el alta inicial controlada.",
      );
      return;
    }

    const result = await bootstrapProductionAdmin(config);
    console.log(
      result.created
        ? "Administrador productivo creado con cambio de contraseña obligatorio. Desactiva SEED_BOOTSTRAP_ADMIN inmediatamente."
        : "El administrador productivo ya existía en el tenant esperado; no se modificó.",
    );
    return;
  }

  const { municipality, organization } =
    await ensureMunicipalityAndOrganization(config);

  if (!config.adminEmail || !config.adminPassword) {
    throw new Error(
      "SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD son obligatorios en desarrollo y test.",
    );
  }

  const actor = await ensureLocalUser({
    email: config.adminEmail,
    password: config.adminPassword,
    name: config.adminName,
    role: UserRole.MUNICIPAL_ADMIN,
    municipalityId: municipality.id,
    organizationId: organization.id,
    resetPassword: config.resetAdminPassword,
  });

  await ensureLocalUser({
    email: "coordinador@anella.local",
    password: "AnellaCoord-2026!",
    name: "Coordinación de SIMULACRO",
    role: UserRole.COORDINATOR,
    municipalityId: municipality.id,
    organizationId: organization.id,
  });

  if (!config.demoData) {
    return;
  }

  await seedSimulation({
    municipalityId: municipality.id,
    municipalityName: municipality.name,
    organizationId: organization.id,
    organizationName: organization.name,
    actorId: actor.id,
  });
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("No se ha podido inicializar Anella", error);
    await prisma.$disconnect();
    process.exit(1);
  });
