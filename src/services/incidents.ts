import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  ContributionCategory as DbContributionCategory,
  ContributionStatus as DbContributionStatus,
  IncidentStatus as DbIncidentStatus,
  IncidentType as DbIncidentType,
  NeedStatus as DbNeedStatus,
  Priority as DbPriority,
} from "@/generated/prisma/enums";
import { calculateRemainingQuantity } from "@/lib/contribution-quantities";
import { getOperationalTimeZone } from "@/config/env";
import {
  incidentScopeWhere,
  requireCoordinator,
  type CoordinatorContext,
} from "@/lib/dal";
import { prisma } from "@/lib/db";
import {
  isIncidentPubliclyEligible,
  publicIncidentEligibilityWhere,
} from "@/lib/public-incident-eligibility";
import { zonedDateTimeLocalToUtc } from "@/lib/time-zone";
import type {
  AuditEntry,
  ContributionQueueFilters,
  ContributionStatus,
  Incident,
  IncidentQueueFilters,
  IncidentQueueItem,
  IncidentStatus,
  IncidentType,
  ManagedContribution,
  ManagedIncident,
  ManagedIncidentDetailOptions,
  ManagedIncidentTab,
  ManagedNeedOption,
  ManagedNeed,
  ManagedSafePoint,
  ManagedSafePointOption,
  Need,
  NeedOperationalStatus,
  NeedStatus,
  NeedType,
  PageResult,
  Priority,
  PublicStats,
} from "@/types/domain";

const outstandingContributionStatuses = [
  DbContributionStatus.PLEDGED,
  DbContributionStatus.EN_ROUTE,
  DbContributionStatus.PARTIALLY_DELIVERED,
];

const publicIncidentSelect = {
  id: true,
  publicCode: true,
  title: true,
  type: true,
  status: true,
  origin: true,
  priority: true,
  publicSummary: true,
  safetyNotice: true,
  responsibleOrgName: true,
  publicLocationMode: true,
  publicLatitude: true,
  publicLongitude: true,
  publicRadiusMeters: true,
  publicLocationLabel: true,
  publicLocationApprovedAt: true,
  timeZone: true,
  updatedAt: true,
  municipality: {
    select: { id: true, name: true, province: true, region: true },
  },
  safePoints: {
    where: {
      isActive: true,
      pointStatus: "ACTIVE",
      publishedAt: { not: null },
      validatedAt: { not: null },
      validatedById: { not: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      incidentId: true,
      name: true,
      address: true,
      instructions: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
      capacityNote: true,
      isActive: true,
      pointType: true,
      pointStatus: true,
      publishedAt: true,
    },
  },
  needs: {
    where: {
      status: {
        in: [DbNeedStatus.ACTIVE, DbNeedStatus.COVERED],
      },
      validatedAt: { not: null },
      validatedById: { not: null },
      publishedAt: { not: null },
      safePoint: {
        isActive: true,
        validatedAt: { not: null },
        validatedById: { not: null },
      },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      incidentId: true,
      safePointId: true,
      type: true,
      title: true,
      description: true,
      priority: true,
      quantityNeeded: true,
      quantityReceived: true,
      unit: true,
      deadline: true,
      status: true,
      validatedAt: true,
      validatedById: true,
      publishedAt: true,
      updatedAt: true,
      requestingOrganization: { select: { name: true } },
    },
  },
  notices: {
    where: { status: "PUBLISHED", publishedAt: { not: null } },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      body: true,
      publishedAt: true,
      organization: { select: { name: true } },
    },
  },
} satisfies Prisma.IncidentSelect;

type PublicIncidentRecord = Prisma.IncidentGetPayload<{
  select: typeof publicIncidentSelect;
}>;

const managedIncidentBaseSelect = {
  id: true,
  publicCode: true,
  title: true,
  type: true,
  status: true,
  origin: true,
  priority: true,
  description: true,
  publicSummary: true,
  safetyNotice: true,
  operationalLatitude: true,
  operationalLongitude: true,
  radiusMeters: true,
  publicLocationMode: true,
  publicLatitude: true,
  publicLongitude: true,
  publicRadiusMeters: true,
  publicLocationLabel: true,
  publicLocationApprovedAt: true,
  publicLocationApprovedById: true,
  timeZone: true,
  responsibleOrgName: true,
  organizationId: true,
  verifiedById: true,
  verifiedAt: true,
  closedAt: true,
  closedReason: true,
  lastActivityAt: true,
  createdAt: true,
  updatedAt: true,
  municipality: true,
  affectedMunicipalities: {
    select: {
      isPrimary: true,
      municipality: {
        select: { id: true, name: true, province: true, region: true },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { municipalityId: "asc" }],
  },
  organization: true,
  verifiedBy: { select: { name: true, email: true } },
  publicLocationApprovedBy: { select: { name: true, email: true } },
} satisfies Prisma.IncidentSelect;

type ManagedIncidentBaseRecord = Prisma.IncidentGetPayload<{
  select: typeof managedIncidentBaseSelect;
}>;

const managedNeedSelect = {
  id: true,
  incidentId: true,
  safePointId: true,
  type: true,
  title: true,
  description: true,
  priority: true,
  quantityNeeded: true,
  quantityReceived: true,
  unit: true,
  deadline: true,
  status: true,
  requestingOrganizationId: true,
  validatedAt: true,
  validatedById: true,
  publishedAt: true,
  cancellationReason: true,
  cancelledAt: true,
  updatedAt: true,
  requestingOrganization: { select: { name: true } },
  requestedBy: { select: { name: true, email: true } },
  validatedBy: { select: { name: true, email: true } },
} satisfies Prisma.NeedSelect;

type ManagedNeedRecord = Prisma.NeedGetPayload<{
  select: typeof managedNeedSelect;
}>;

const managedSafePointSelect = {
  id: true,
  incidentId: true,
  name: true,
  address: true,
  instructions: true,
  latitude: true,
  longitude: true,
  radiusMeters: true,
  capacityNote: true,
  qrToken: true,
  isActive: true,
  pointType: true,
  pointStatus: true,
  publishedAt: true,
  deactivatedAt: true,
  deactivationReason: true,
  validatedAt: true,
  validatedById: true,
  createdAt: true,
  updatedAt: true,
  validatedBy: { select: { name: true, email: true } },
} satisfies Prisma.SafePointSelect;

const auditEntrySelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  actor: { select: { name: true, email: true } },
} satisfies Prisma.AuditLogSelect;

type AuditEntryRecord = Prisma.AuditLogGetPayload<{
  select: typeof auditEntrySelect;
}>;

const managedContributionInclude = {
  incident: { include: { municipality: true } },
  need: {
    include: {
      safePoint: true,
    },
  },
  safePoint: true,
} satisfies Prisma.ContributionInclude;

type ManagedContributionRecord = Prisma.ContributionGetPayload<{
  include: typeof managedContributionInclude;
}>;

const incidentStatusMap: Record<DbIncidentStatus, IncidentStatus> = {
  DRAFT: "draft",
  PENDING_VALIDATION: "pending_validation",
  ACTIVE: "active",
  MONITORING: "monitoring",
  RESOLVED: "resolved",
  CANCELLED: "cancelled",
};

const needStatusMap: Record<DbNeedStatus, NeedStatus> = {
  DRAFT: "draft",
  ACTIVE: "active",
  COVERED: "covered",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

const contributionStatusMap: Record<DbContributionStatus, ContributionStatus> =
  {
    PLEDGED: "pledged",
    EN_ROUTE: "en_route",
    PARTIALLY_DELIVERED: "partially_delivered",
    DELIVERED: "delivered",
    CANCELLED: "cancelled",
    NO_SHOW: "no_show",
  };

const dbIncidentStatusMap: Record<IncidentStatus, DbIncidentStatus> = {
  draft: DbIncidentStatus.DRAFT,
  pending_validation: DbIncidentStatus.PENDING_VALIDATION,
  active: DbIncidentStatus.ACTIVE,
  monitoring: DbIncidentStatus.MONITORING,
  resolved: DbIncidentStatus.RESOLVED,
  cancelled: DbIncidentStatus.CANCELLED,
};

const dbIncidentTypeMap: Record<IncidentType, DbIncidentType> = {
  wildfire: DbIncidentType.WILDFIRE,
  flood: DbIncidentType.FLOOD,
  storm: DbIncidentType.STORM,
  earthquake: DbIncidentType.EARTHQUAKE,
  snow: DbIncidentType.SNOW,
  power_outage: DbIncidentType.POWER_OUTAGE,
  search_rescue: DbIncidentType.SEARCH_RESCUE,
  health: DbIncidentType.HEALTH,
  industrial: DbIncidentType.INDUSTRIAL,
  other: DbIncidentType.OTHER,
};

const dbPriorityMap: Record<Priority, DbPriority> = {
  low: DbPriority.LOW,
  medium: DbPriority.MEDIUM,
  high: DbPriority.HIGH,
  critical: DbPriority.CRITICAL,
};

const dbContributionStatusMap: Record<
  ContributionStatus,
  DbContributionStatus
> = {
  pledged: DbContributionStatus.PLEDGED,
  en_route: DbContributionStatus.EN_ROUTE,
  partially_delivered: DbContributionStatus.PARTIALLY_DELIVERED,
  delivered: DbContributionStatus.DELIVERED,
  cancelled: DbContributionStatus.CANCELLED,
  no_show: DbContributionStatus.NO_SHOW,
};

function toPriority(value: string) {
  return value.toLowerCase() as Priority;
}

function toIncidentType(value: string) {
  return value.toLowerCase() as IncidentType;
}

function toNeedType(value: string) {
  return value.toLowerCase() as NeedType;
}

function actorLabel(actor: { name: string | null; email: string } | null) {
  return actor?.name ?? actor?.email ?? "Sistema";
}

type NeedQuantitySummary = {
  quantityCommitted: number;
  quantityEnRoute: number;
};

const emptyNeedQuantitySummary: NeedQuantitySummary = {
  quantityCommitted: 0,
  quantityEnRoute: 0,
};

export function deriveNeedOperationalStatus({
  status,
  deadline,
  publishedAt,
  quantityNeeded,
  quantityReceived,
  quantityCommitted,
  quantityEnRoute,
  now = new Date(),
}: {
  status: NeedStatus;
  deadline?: Date | string | null;
  publishedAt?: Date | string | null;
  quantityNeeded: number;
  quantityReceived: number;
  quantityCommitted: number;
  quantityEnRoute: number;
  now?: Date;
}): NeedOperationalStatus {
  if (status === "cancelled") return "cancelled";
  if (
    status === "expired" ||
    (deadline && new Date(deadline).getTime() <= now.getTime())
  ) {
    return "expired";
  }
  if (status === "covered" || quantityReceived >= quantityNeeded) {
    return "covered";
  }
  if (status === "draft") return publishedAt ? "published" : "draft";
  if (quantityReceived > 0) return "partially_received";
  if (quantityEnRoute > 0) return "en_route";
  if (quantityCommitted > 0) return "committed";
  return "open";
}

function mapNeed(
  need: PublicIncidentRecord["needs"][number] | ManagedNeedRecord,
  timeZone: string,
  quantities: NeedQuantitySummary = emptyNeedQuantitySummary,
  includeValidationActor = false,
): Need {
  const { quantityCommitted, quantityEnRoute } = quantities;
  const status = needStatusMap[need.status];

  return {
    id: need.id,
    incidentId: need.incidentId,
    safePointId: need.safePointId,
    type: toNeedType(need.type),
    title: need.title,
    description: need.description ?? undefined,
    priority: toPriority(need.priority),
    quantityNeeded: need.quantityNeeded,
    quantityReceived: need.quantityReceived,
    quantityCommitted,
    quantityEnRoute,
    unit: need.unit,
    deadline: need.deadline?.toISOString(),
    timeZone,
    status,
    operationalStatus: deriveNeedOperationalStatus({
      status,
      deadline: need.deadline,
      publishedAt: need.publishedAt,
      quantityNeeded: need.quantityNeeded,
      quantityReceived: need.quantityReceived,
      quantityCommitted,
      quantityEnRoute,
    }),
    requestingOrganizationName: need.requestingOrganization?.name ?? undefined,
    validatedByName:
      includeValidationActor && "validatedBy" in need && need.validatedBy
        ? actorLabel(need.validatedBy)
        : undefined,
    validatedAt: need.validatedAt?.toISOString(),
    publishedAt: need.publishedAt?.toISOString(),
    updatedAt: need.updatedAt.toISOString(),
  };
}

function mapIncidentHeader(
  record: PublicIncidentRecord | ManagedIncidentBaseRecord,
): Omit<Incident, "safePoints" | "needs" | "notices"> {
  const publicCoordinates =
    record.publicLocationMode === "GENERALIZED_AREA" &&
    record.publicLocationApprovedAt &&
    record.publicLatitude !== null &&
    record.publicLongitude !== null
      ? {
          lat: Number(record.publicLatitude),
          lng: Number(record.publicLongitude),
        }
      : undefined;

  return {
    id: record.id,
    publicCode: record.publicCode,
    title: record.title,
    type: toIncidentType(record.type),
    status: incidentStatusMap[record.status],
    priority: toPriority(record.priority),
    municipality: {
      id: record.municipality?.id ?? "unknown",
      name: record.municipality?.name ?? "Municipio sin asignar",
      province: record.municipality?.province ?? undefined,
      region: record.municipality?.region ?? undefined,
    },
    responsibleOrgName: record.responsibleOrgName ?? "Coordinación municipal",
    publicSummary:
      record.publicSummary ?? "Información validada pendiente de ampliación.",
    safetyNotice:
      record.safetyNotice ??
      "No acudas a la zona de intervención. Utiliza solo puntos de entrega oficiales publicados.",
    publicArea: {
      mode: record.publicLocationMode.toLowerCase() as Incident["publicArea"]["mode"],
      label:
        record.publicLocationLabel ??
        record.municipality?.name ??
        "Ubicación pública pendiente",
      coordinates: publicCoordinates,
      radiusMeters: publicCoordinates
        ? (record.publicRadiusMeters ?? undefined)
        : undefined,
      approvedAt: record.publicLocationApprovedAt?.toISOString(),
    },
    timeZone: record.timeZone,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapPublicIncident(
  record: PublicIncidentRecord,
  quantitiesByNeedId: ReadonlyMap<string, NeedQuantitySummary>,
): Incident {
  const publicSafePointIds = new Set(
    record.safePoints.map((point) => point.id),
  );
  const needs = record.needs
    .filter(
      (need) =>
        need.incidentId === record.id &&
        publicSafePointIds.has(need.safePointId),
    )
    .map((need) =>
      mapNeed(
        need,
        record.timeZone,
        quantitiesByNeedId.get(need.id) ?? emptyNeedQuantitySummary,
      ),
    )
    .filter((need) => need.operationalStatus !== "expired");

  return {
    ...mapIncidentHeader(record),
    safePoints: record.safePoints.map((point) => ({
      id: point.id,
      incidentId: point.incidentId,
      name: point.name,
      address: point.address ?? "Dirección pendiente",
      instructions:
        point.instructions ?? "Sigue las indicaciones del coordinador.",
      coordinates: {
        lat: Number(point.latitude),
        lng: Number(point.longitude),
      },
      radiusMeters: point.radiusMeters,
      capacityNote: point.capacityNote ?? undefined,
      isActive: point.isActive,
      pointType:
        point.pointType.toLowerCase() as Incident["safePoints"][number]["pointType"],
      status:
        point.pointStatus.toLowerCase() as Incident["safePoints"][number]["status"],
      publishedAt: point.publishedAt?.toISOString(),
    })),
    needs,
    notices: record.notices
      .filter((notice) => notice.publishedAt !== null)
      .map((notice) => ({
        id: notice.id,
        title: notice.title,
        body: notice.body,
        organizationName: notice.organization.name,
        publishedAt: notice.publishedAt!.toISOString(),
      })),
  };
}

function getStats(incidents: Incident[]): PublicStats {
  const needs = incidents.flatMap((incident) => incident.needs);

  return {
    activeIncidents: incidents.filter((incident) =>
      ["active", "monitoring"].includes(incident.status),
    ).length,
    enabledDropOffPoints: incidents.reduce(
      (total, incident) => total + incident.safePoints.length,
      0,
    ),
    openNeeds: needs.filter((need) =>
      ["open", "committed", "en_route", "partially_received"].includes(
        need.operationalStatus,
      ),
    ).length,
    coveredNeeds: needs.filter((need) => need.operationalStatus === "covered")
      .length,
    pledgedContributions: needs.reduce(
      (total, need) => total + need.quantityCommitted,
      0,
    ),
  };
}

function contributionScopeWhere(coordinator: CoordinatorContext) {
  if (coordinator.role === "SUPER_ADMIN") return {};

  return {
    incident: {
      municipalityId: coordinator.municipalityId ?? "__none__",
    },
  } satisfies Prisma.ContributionWhereInput;
}

function mapManagedContribution(
  contribution: ManagedContributionRecord,
): ManagedContribution {
  const hasConfirmedDestination = Boolean(
    contribution.safePoint &&
    contribution.safePointId &&
    contribution.safePoint.incidentId === contribution.incidentId &&
    (!contribution.need ||
      (contribution.safePointId === contribution.need.safePointId &&
        contribution.safePoint.id === contribution.need.safePoint.id &&
        contribution.need.incidentId === contribution.incidentId)),
  );

  return {
    id: contribution.id,
    publicCode: contribution.publicCode,
    incidentId: contribution.incidentId,
    needId: contribution.needId ?? undefined,
    safePointId: contribution.safePointId,
    category:
      contribution.category.toLowerCase() as ManagedContribution["category"],
    description: contribution.description ?? undefined,
    unit: contribution.unit ?? contribution.need?.unit ?? "aportación",
    citizenName: contribution.citizenName,
    citizenPhone: contribution.citizenPhone ?? undefined,
    citizenEmail: contribution.citizenEmail ?? undefined,
    quantity: contribution.quantity,
    deliveredQuantity: contribution.deliveredQuantity,
    eta: contribution.eta?.toISOString(),
    status: contributionStatusMap[contribution.status],
    statusReason: contribution.statusReason ?? undefined,
    revision: contribution.revision,
    notes: contribution.notes ?? undefined,
    safePointName: hasConfirmedDestination
      ? contribution.safePoint!.name
      : "Destino pendiente de revisión",
    safePointActive: Boolean(
      hasConfirmedDestination &&
      contribution.safePoint?.isActive &&
      contribution.safePoint.pointStatus === "ACTIVE" &&
      contribution.safePoint.validatedAt &&
      contribution.safePoint.validatedById &&
      (!contribution.need ||
        (contribution.need.safePoint.isActive &&
          contribution.need.safePoint.validatedAt &&
          contribution.need.safePoint.validatedById)),
    ),
    needTitle:
      contribution.need?.title ??
      contribution.description ??
      "Aportación directa",
    needUnit: contribution.need?.unit ?? contribution.unit ?? "aportación",
    needStatus: contribution.need
      ? needStatusMap[contribution.need.status]
      : undefined,
    incidentCode: contribution.incident.publicCode,
    incidentTitle: contribution.incident.title,
    incidentTimeZone: contribution.incident.timeZone,
    municipalityName:
      contribution.incident.municipality?.name ?? "Sin municipio",
    createdAt: contribution.createdAt.toISOString(),
    updatedAt: contribution.updatedAt.toISOString(),
    checkedInAt: contribution.checkedInAt?.toISOString(),
  };
}

async function getNeedQuantitySummaries(
  transaction: Prisma.TransactionClient,
  needIds: string[],
) {
  if (needIds.length === 0) {
    return new Map<string, NeedQuantitySummary>();
  }

  const rows = await transaction.$queryRaw<
    Array<{
      needId: string;
      quantityCommitted: number | bigint;
      quantityEnRoute: number | bigint;
    }>
  >(Prisma.sql`
    SELECT
      c.needId AS needId,
      SUM(CASE
        WHEN c.status IN ('PLEDGED', 'EN_ROUTE', 'PARTIALLY_DELIVERED')
        THEN GREATEST(c.quantity - c.deliveredQuantity, 0)
        ELSE 0
      END) AS quantityCommitted,
      SUM(CASE
        WHEN c.status IN ('EN_ROUTE', 'PARTIALLY_DELIVERED')
        THEN GREATEST(c.quantity - c.deliveredQuantity, 0)
        ELSE 0
      END) AS quantityEnRoute
    FROM Contribution AS c
    WHERE c.needId IN (${Prisma.join(needIds)})
    GROUP BY c.needId
  `);

  return new Map(
    rows.map((row) => [
      row.needId,
      {
        quantityCommitted: Number(row.quantityCommitted),
        quantityEnRoute: Number(row.quantityEnRoute),
      },
    ]),
  );
}

export async function getPublicIncidents(): Promise<Incident[]> {
  return prisma.$transaction(
    async (transaction) => {
      const records = await transaction.incident.findMany({
        where: publicIncidentEligibilityWhere,
        select: publicIncidentSelect,
        orderBy: [
          { priority: "desc" },
          { lastActivityAt: "desc" },
          { id: "desc" },
        ],
      });
      const quantitiesByNeedId = await getNeedQuantitySummaries(
        transaction,
        records.flatMap((record) => record.needs.map((need) => need.id)),
      );

      return records.map((record) =>
        mapPublicIncident(record, quantitiesByNeedId),
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getIncidentById(id: string): Promise<Incident | null> {
  return prisma.$transaction(
    async (transaction) => {
      const record = await transaction.incident.findFirst({
        where: {
          ...publicIncidentEligibilityWhere,
          OR: [{ id }, { publicCode: id }],
        },
        select: publicIncidentSelect,
      });
      if (!record) return null;

      const quantitiesByNeedId = await getNeedQuantitySummaries(
        transaction,
        record.needs.map((need) => need.id),
      );
      return mapPublicIncident(record, quantitiesByNeedId);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getPublicIncidentTitle(id: string) {
  return prisma.incident.findFirst({
    where: {
      ...publicIncidentEligibilityWhere,
      OR: [{ id }, { publicCode: id }],
    },
    select: { title: true, publicCode: true },
  });
}

export async function getPublicStats(): Promise<PublicStats> {
  return getStats(await getPublicIncidents());
}

export async function getPublicSnapshot() {
  const incidents = await getPublicIncidents();
  return { incidents, stats: getStats(incidents) };
}

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

function nextDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    String(next.getUTCFullYear()).padStart(4, "0"),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function operationalDayBoundary(value?: string, endExclusive = false) {
  if (!value || !dateOnlyPattern.test(value)) return undefined;

  try {
    const date = endExclusive ? nextDateOnly(value) : value;
    return zonedDateTimeLocalToUtc(`${date}T00:00`, getOperationalTimeZone());
  } catch {
    return undefined;
  }
}

function pagination(page?: number, pageSize?: number) {
  const normalizedPage =
    Number.isInteger(page) && page! > 0 && page! <= 999_999 ? page! : 1;
  const normalizedPageSize = Math.min(
    100,
    Math.max(10, Number.isInteger(pageSize) ? pageSize! : 25),
  );
  return { page: normalizedPage, pageSize: normalizedPageSize };
}

export async function getIncidentQueue(
  filters: IncidentQueueFilters = {},
): Promise<PageResult<IncidentQueueItem>> {
  const coordinator = await requireCoordinator();
  const { page, pageSize } = pagination(filters.page, filters.pageSize);
  const createdFrom = operationalDayBoundary(filters.createdFrom);
  const createdToExclusive = operationalDayBoundary(filters.createdTo, true);

  const clauses: Prisma.IncidentWhereInput[] = [
    incidentScopeWhere(coordinator),
  ];
  if (filters.query) {
    clauses.push({
      OR: [
        { publicCode: { contains: filters.query } },
        { title: { contains: filters.query } },
        { municipality: { name: { contains: filters.query } } },
        { organization: { name: { contains: filters.query } } },
        { responsibleOrgName: { contains: filters.query } },
      ],
    });
  }
  if (filters.statuses?.length) {
    clauses.push({
      status: {
        in: filters.statuses.map((value) => dbIncidentStatusMap[value]),
      },
    });
  }
  if (filters.types?.length) {
    clauses.push({
      type: { in: filters.types.map((value) => dbIncidentTypeMap[value]) },
    });
  }
  if (filters.priorities?.length) {
    clauses.push({
      priority: { in: filters.priorities.map((value) => dbPriorityMap[value]) },
    });
  }
  if (filters.municipality) {
    clauses.push({
      municipality: { name: { contains: filters.municipality } },
    });
  }
  if (filters.organization) {
    clauses.push({
      OR: [
        { organization: { name: { contains: filters.organization } } },
        { responsibleOrgName: { contains: filters.organization } },
      ],
    });
  }
  if (createdFrom || createdToExclusive) {
    clauses.push({
      createdAt: { gte: createdFrom, lt: createdToExclusive },
    });
  }
  if (filters.hasPendingNeeds) {
    clauses.push({
      contributions: {
        some: {
          status: {
            in: [
              DbContributionStatus.PLEDGED,
              DbContributionStatus.EN_ROUTE,
              DbContributionStatus.PARTIALLY_DELIVERED,
            ],
          },
        },
      },
    });
  }
  const where: Prisma.IncidentWhereInput = { AND: clauses };

  const direction = filters.direction ?? "desc";
  const orderBy: Prisma.IncidentOrderByWithRelationInput[] =
    filters.sort === "created"
      ? [{ createdAt: direction }, { id: direction }]
      : filters.sort === "priority"
        ? [{ priority: direction }, { lastActivityAt: "desc" }, { id: "desc" }]
        : [
            { lastActivityAt: direction },
            { createdAt: direction },
            { id: direction },
          ];

  const now = new Date();
  const { total, records, metrics, resolvedPage, pageCount } =
    await prisma.$transaction(
      async (transaction) => {
        const recordCount = await transaction.incident.count({ where });
        const resolvedPageCount = Math.max(
          1,
          Math.ceil(recordCount / pageSize),
        );
        const resolvedPageNumber = Math.min(page, resolvedPageCount);
        const pageRecords = await transaction.incident.findMany({
          where,
          skip: (resolvedPageNumber - 1) * pageSize,
          take: pageSize,
          orderBy,
          select: {
            id: true,
            publicCode: true,
            title: true,
            type: true,
            status: true,
            priority: true,
            responsibleOrgName: true,
            timeZone: true,
            lastActivityAt: true,
            createdAt: true,
            municipality: { select: { name: true } },
            organization: { select: { name: true } },
          },
        });
        const ids = pageRecords.map((record) => record.id);
        const aggregateRows = ids.length
          ? await transaction.$queryRaw<
              Array<{
                incidentId: string;
                openNeeds: number | bigint;
                pendingDeliveries: number | bigint;
              }>
            >(Prisma.sql`
            SELECT
              i.id AS incidentId,
              (
                SELECT COUNT(*)
                FROM Need AS n
                WHERE n.incidentId = i.id
                  AND n.status = 'ACTIVE'
                  AND (n.deadline IS NULL OR n.deadline > ${now})
              ) AS openNeeds,
              COUNT(CASE
                WHEN c.status IN ('PLEDGED', 'EN_ROUTE', 'PARTIALLY_DELIVERED')
                THEN c.id
              END) AS pendingDeliveries
            FROM Incident AS i
            LEFT JOIN Contribution AS c ON c.incidentId = i.id
            WHERE i.id IN (${Prisma.join(ids)})
            GROUP BY i.id
          `)
          : [];

        return {
          total: recordCount,
          records: pageRecords,
          resolvedPage: resolvedPageNumber,
          pageCount: resolvedPageCount,
          metrics: new Map(
            aggregateRows.map((row) => [
              row.incidentId,
              {
                openNeeds: Number(row.openNeeds),
                pendingDeliveries: Number(row.pendingDeliveries),
              },
            ]),
          ),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );

  const items = records.map((record) => ({
    id: record.id,
    publicCode: record.publicCode,
    title: record.title,
    type: toIncidentType(record.type),
    status: incidentStatusMap[record.status],
    priority: toPriority(record.priority),
    municipalityName: record.municipality?.name ?? "Sin municipio",
    organizationName:
      record.organization?.name ??
      record.responsibleOrgName ??
      "Sin organización",
    openNeeds: metrics.get(record.id)?.openNeeds ?? 0,
    pendingDeliveries: metrics.get(record.id)?.pendingDeliveries ?? 0,
    timeZone: record.timeZone,
    lastActivityAt: record.lastActivityAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  }));

  return {
    items,
    page: resolvedPage,
    pageSize,
    total,
    pageCount,
  };
}

export async function getContributionQueue(
  filters: ContributionQueueFilters = {},
): Promise<PageResult<ManagedContribution>> {
  const coordinator = await requireCoordinator();
  const { page, pageSize } = pagination(filters.page, filters.pageSize);
  const createdFrom = operationalDayBoundary(filters.createdFrom);
  const createdToExclusive = operationalDayBoundary(filters.createdTo, true);
  const clauses: Prisma.ContributionWhereInput[] = [
    contributionScopeWhere(coordinator),
  ];
  if (filters.query) {
    clauses.push({
      OR: [
        { publicCode: { contains: filters.query } },
        { description: { contains: filters.query } },
        { need: { title: { contains: filters.query } } },
        { incident: { publicCode: { contains: filters.query } } },
        { incident: { title: { contains: filters.query } } },
      ],
    });
  }
  if (filters.statuses?.length) {
    clauses.push({
      status: {
        in: filters.statuses.map((value) => dbContributionStatusMap[value]),
      },
    });
  }
  if (filters.incidentId) {
    clauses.push({ incidentId: filters.incidentId });
  }
  if (filters.safePointId) {
    clauses.push({ safePointId: filters.safePointId });
  }
  if (filters.incidentQuery) {
    clauses.push({
      incident: {
        OR: [
          { publicCode: { contains: filters.incidentQuery } },
          { title: { contains: filters.incidentQuery } },
          {
            municipality: { name: { contains: filters.incidentQuery } },
          },
          {
            organization: { name: { contains: filters.incidentQuery } },
          },
          { responsibleOrgName: { contains: filters.incidentQuery } },
        ],
      },
    });
  }
  if (filters.safePointQuery) {
    const pointMatches = {
      OR: [
        { name: { contains: filters.safePointQuery } },
        { qrToken: { contains: filters.safePointQuery } },
      ],
    } satisfies Prisma.SafePointWhereInput;
    clauses.push({
      OR: [{ safePoint: pointMatches }, { need: { safePoint: pointMatches } }],
    });
  }
  if (filters.category) {
    clauses.push({
      category: filters.category.toUpperCase() as DbContributionCategory,
    });
  }
  if (filters.municipality) {
    clauses.push({
      incident: { municipality: { name: { contains: filters.municipality } } },
    });
  }
  if (createdFrom || createdToExclusive) {
    clauses.push({ createdAt: { gte: createdFrom, lt: createdToExclusive } });
  }
  if (filters.eta === "with_eta") clauses.push({ eta: { not: null } });
  if (filters.eta === "due_soon") {
    const now = new Date();
    clauses.push({
      eta: { gte: now, lte: new Date(now.getTime() + 2 * 60 * 60 * 1_000) },
      status: { in: outstandingContributionStatuses },
    });
  }
  if (filters.eta === "late") {
    clauses.push({
      eta: { lt: new Date() },
      status: { in: outstandingContributionStatuses },
    });
  }
  const where: Prisma.ContributionWhereInput = { AND: clauses };

  const { total, records, resolvedPage, pageCount } = await prisma.$transaction(
    async (transaction) => {
      const recordCount = await transaction.contribution.count({ where });
      const resolvedPageCount = Math.max(1, Math.ceil(recordCount / pageSize));
      const resolvedPageNumber = Math.min(page, resolvedPageCount);
      const pageRecords = await transaction.contribution.findMany({
        where,
        include: managedContributionInclude,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (resolvedPageNumber - 1) * pageSize,
        take: pageSize,
      });

      return {
        total: recordCount,
        records: pageRecords,
        resolvedPage: resolvedPageNumber,
        pageCount: resolvedPageCount,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  return {
    items: records.map(mapManagedContribution),
    page: resolvedPage,
    pageSize,
    total,
    pageCount,
  };
}

const managedIncidentTabs = new Set<ManagedIncidentTab>([
  "summary",
  "needs",
  "contributions",
  "safe-points",
  "activity",
]);

const contributionStatuses = Object.keys(
  dbContributionStatusMap,
) as ContributionStatus[];

function normalizeManagedIncidentTab(
  value: ManagedIncidentDetailOptions["tab"],
): ManagedIncidentTab {
  return value && managedIncidentTabs.has(value) ? value : "summary";
}

function normalizeContributionStatus(
  value: ManagedIncidentDetailOptions["contributionStatus"],
): "all" | ContributionStatus {
  return value && (value === "all" || contributionStatuses.includes(value))
    ? value
    : "all";
}

export async function getManagedContributionPage(
  incidentId: string,
  contributionId: string,
  options: {
    pageSize?: number;
    contributionStatus?: "all" | ContributionStatus;
  } = {},
): Promise<number | null> {
  const coordinator = await requireCoordinator();
  const { pageSize } = pagination(1, options.pageSize);
  const contributionStatus = normalizeContributionStatus(
    options.contributionStatus,
  );
  const scope = contributionScopeWhere(coordinator);
  const incidentClause: Prisma.ContributionWhereInput = {
    incidentId,
  };
  const target = await prisma.contribution.findFirst({
    where: { AND: [scope, incidentClause, { id: contributionId }] },
    select: { id: true, status: true, updatedAt: true, createdAt: true },
  });
  if (!target) return null;
  if (
    contributionStatus !== "all" &&
    target.status !== dbContributionStatusMap[contributionStatus]
  ) {
    return null;
  }

  const statusClause: Prisma.ContributionWhereInput =
    contributionStatus === "all"
      ? {}
      : { status: dbContributionStatusMap[contributionStatus] };
  const preceding = await prisma.contribution.count({
    where: {
      AND: [
        scope,
        incidentClause,
        statusClause,
        {
          OR: [
            { updatedAt: { gt: target.updatedAt } },
            {
              updatedAt: target.updatedAt,
              createdAt: { gt: target.createdAt },
            },
            {
              updatedAt: target.updatedAt,
              createdAt: target.createdAt,
              id: { gt: target.id },
            },
          ],
        },
      ],
    },
  });

  return Math.floor(preceding / pageSize) + 1;
}

export async function getManagedIncidentTitle(id: string) {
  const coordinator = await requireCoordinator();
  return prisma.incident.findFirst({
    where: { id, ...incidentScopeWhere(coordinator) },
    select: { title: true, publicCode: true },
  });
}

function emptyContributionStatusCounts(): Record<ContributionStatus, number> {
  return {
    pledged: 0,
    en_route: 0,
    partially_delivered: 0,
    delivered: 0,
    cancelled: 0,
    no_show: 0,
  };
}

async function getSafePointMetrics(
  transaction: Prisma.TransactionClient,
  incidentId: string,
  safePointIds: string[],
) {
  if (safePointIds.length === 0) {
    return new Map<
      string,
      {
        associatedNeeds: number;
        activeNeeds: number;
        pendingDeliveries: number;
      }
    >();
  }

  const rows = await transaction.$queryRaw<
    Array<{
      safePointId: string;
      associatedNeeds: number | bigint;
      activeNeeds: number | bigint;
      pendingDeliveries: number | bigint;
    }>
  >(Prisma.sql`
    SELECT
      sp.id AS safePointId,
      (
        SELECT COUNT(*)
        FROM Need AS n
        WHERE n.safePointId = sp.id
      ) AS associatedNeeds,
      (
        SELECT COUNT(*)
        FROM Need AS n
        WHERE n.safePointId = sp.id
          AND n.status = 'ACTIVE'
      ) AS activeNeeds,
      (
        SELECT COUNT(*)
        FROM Contribution AS c
        WHERE c.incidentId = ${incidentId}
          AND c.status IN ('PLEDGED', 'EN_ROUTE', 'PARTIALLY_DELIVERED')
          AND c.safePointId = sp.id
      ) AS pendingDeliveries
    FROM SafePoint AS sp
    WHERE sp.incidentId = ${incidentId}
      AND sp.id IN (${Prisma.join(safePointIds)})
  `);

  return new Map(
    rows.map((row) => [
      row.safePointId,
      {
        associatedNeeds: Number(row.associatedNeeds),
        activeNeeds: Number(row.activeNeeds),
        pendingDeliveries: Number(row.pendingDeliveries),
      },
    ]),
  );
}

function getPublicVisibilityBlockers(record: ManagedIncidentBaseRecord) {
  const blockers: string[] = [];
  if (
    record.status !== DbIncidentStatus.ACTIVE &&
    record.status !== DbIncidentStatus.MONITORING
  ) {
    blockers.push("El incidente no está activo ni en seguimiento.");
  }
  if (!record.verifiedAt) {
    blockers.push("El incidente aún no tiene validación humana.");
  }
  if (!record.verifiedById) {
    blockers.push(
      "La validación del incidente no tiene una cuenta responsable.",
    );
  }
  if (!record.publicLocationApprovedAt) {
    blockers.push(
      "La representación pública de la ubicación aún no está aprobada.",
    );
  }
  if (!record.publicLocationApprovedById) {
    blockers.push(
      "La ubicación pública no tiene una cuenta aprobadora responsable.",
    );
  }
  return blockers;
}

function mapAuditEntry(entry: AuditEntryRecord): AuditEntry {
  return {
    id: entry.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? undefined,
    actorName: actorLabel(entry.actor),
    metadata:
      entry.metadata && typeof entry.metadata === "object"
        ? (entry.metadata as Record<string, unknown>)
        : undefined,
    createdAt: entry.createdAt.toISOString(),
  };
}

export async function getManagedIncidentById(
  id: string,
  options: ManagedIncidentDetailOptions = {},
): Promise<ManagedIncident | null> {
  const coordinator = await requireCoordinator();
  const tab = normalizeManagedIncidentTab(options.tab);
  const contributionStatus = normalizeContributionStatus(
    options.contributionStatus,
  );
  const { page, pageSize } = pagination(options.page, options.pageSize);

  return prisma.$transaction(
    async (transaction): Promise<ManagedIncident | null> => {
      const record = await transaction.incident.findFirst({
        where: { id, ...incidentScopeWhere(coordinator) },
        select: managedIncidentBaseSelect,
      });
      if (!record) return null;

      const [needCount, safePointCount, activityCount, statusRows] =
        await Promise.all([
          transaction.need.count({ where: { incidentId: record.id } }),
          transaction.safePoint.count({ where: { incidentId: record.id } }),
          transaction.auditLog.count({ where: { incidentId: record.id } }),
          transaction.contribution.groupBy({
            by: ["status"],
            where: { incidentId: record.id },
            _count: { _all: true },
          }),
        ]);

      const contributionStatusCounts = emptyContributionStatusCounts();
      for (const row of statusRows) {
        contributionStatusCounts[contributionStatusMap[row.status]] =
          row._count._all;
      }
      const contributionCount = Object.values(contributionStatusCounts).reduce(
        (total, count) => total + count,
        0,
      );
      const filteredContributionCount =
        contributionStatus === "all"
          ? contributionCount
          : contributionStatusCounts[contributionStatus];
      const total =
        tab === "needs"
          ? needCount
          : tab === "contributions"
            ? filteredContributionCount
            : tab === "safe-points"
              ? safePointCount
              : tab === "activity"
                ? activityCount
                : 0;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const resolvedPage = Math.min(page, pageCount);

      let needs: ManagedNeed[] = [];
      let contributions: ManagedContribution[] = [];
      let safePoints: ManagedSafePoint[] = [];
      let activity: AuditEntry[] = [];
      let safePointOptions: ManagedSafePointOption[] = [];
      const needOptions: ManagedNeedOption[] = [];
      let publicPreview: ManagedIncident["publicPreview"];
      let recentContributions: ManagedContribution[] = [];

      if (tab === "summary") {
        const [publicRecord, recentContributionRecords] = await Promise.all([
          transaction.incident.findUnique({
            where: { id: record.id },
            select: publicIncidentSelect,
          }),
          transaction.contribution.findMany({
            where: { incidentId: record.id },
            include: managedContributionInclude,
            orderBy: [
              { updatedAt: "desc" },
              { createdAt: "desc" },
              { id: "desc" },
            ],
            take: 5,
          }),
        ]);
        recentContributions = recentContributionRecords.map(
          mapManagedContribution,
        );
        if (publicRecord) {
          const publicQuantities = await getNeedQuantitySummaries(
            transaction,
            publicRecord.needs.map((need) => need.id),
          );
          const publicIncident = mapPublicIncident(
            publicRecord,
            publicQuantities,
          );
          const blockers = getPublicVisibilityBlockers(record);
          publicPreview = {
            isVisible: isIncidentPubliclyEligible(record),
            blockers,
            incident: publicIncident,
          };
        }
      }

      if (tab === "needs") {
        const needRecords = await transaction.need.findMany({
          where: { incidentId: record.id },
          select: managedNeedSelect,
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
          skip: (resolvedPage - 1) * pageSize,
          take: pageSize,
        });
        const quantities = await getNeedQuantitySummaries(
          transaction,
          needRecords.map((need) => need.id),
        );
        needs = needRecords.map((need) => ({
          ...mapNeed(
            need,
            record.timeZone,
            quantities.get(need.id) ?? emptyNeedQuantitySummary,
            true,
          ),
          requestingOrganizationId: need.requestingOrganizationId ?? undefined,
          requestedByName: need.requestedBy
            ? actorLabel(need.requestedBy)
            : undefined,
          cancellationReason: need.cancellationReason ?? undefined,
          cancelledAt: need.cancelledAt?.toISOString(),
        }));
      }

      if (tab === "contributions") {
        const contributionRecords = await transaction.contribution.findMany({
          where: {
            incidentId: record.id,
            ...(contributionStatus === "all"
              ? {}
              : { status: dbContributionStatusMap[contributionStatus] }),
          },
          include: managedContributionInclude,
          orderBy: [
            { updatedAt: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          skip: (resolvedPage - 1) * pageSize,
          take: pageSize,
        });
        contributions = contributionRecords.map(mapManagedContribution);
      }

      if (tab === "safe-points") {
        const safePointRecords = await transaction.safePoint.findMany({
          where: { incidentId: record.id },
          select: managedSafePointSelect,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip: (resolvedPage - 1) * pageSize,
          take: pageSize,
        });
        const metrics = await getSafePointMetrics(
          transaction,
          record.id,
          safePointRecords.map((point) => point.id),
        );
        safePoints = safePointRecords.map((point) => {
          const pointMetrics = metrics.get(point.id) ?? {
            associatedNeeds: 0,
            activeNeeds: 0,
            pendingDeliveries: 0,
          };
          return {
            id: point.id,
            incidentId: point.incidentId,
            name: point.name,
            address: point.address ?? "Dirección pendiente",
            instructions:
              point.instructions ?? "Sigue las indicaciones del coordinador.",
            coordinates: {
              lat: Number(point.latitude),
              lng: Number(point.longitude),
            },
            radiusMeters: point.radiusMeters,
            capacityNote: point.capacityNote ?? undefined,
            isActive: point.isActive,
            pointType:
              point.pointType.toLowerCase() as ManagedSafePoint["pointType"],
            status:
              point.pointStatus.toLowerCase() as ManagedSafePoint["status"],
            publishedAt: point.publishedAt?.toISOString(),
            qrToken: point.qrToken,
            updatedAt: point.updatedAt.toISOString(),
            validatedAt: point.validatedAt?.toISOString(),
            validatedByName: point.validatedBy
              ? actorLabel(point.validatedBy)
              : undefined,
            ...pointMetrics,
            deactivatedAt: point.deactivatedAt?.toISOString(),
            deactivationReason: point.deactivationReason ?? undefined,
          };
        });
      }

      if (tab === "activity") {
        const activityRecords = await transaction.auditLog.findMany({
          where: { incidentId: record.id },
          select: auditEntrySelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (resolvedPage - 1) * pageSize,
          take: pageSize,
        });
        activity = activityRecords.map(mapAuditEntry);
      }

      if (tab === "needs") {
        const optionRecords = await transaction.safePoint.findMany({
          where: { incidentId: record.id },
          select: {
            id: true,
            name: true,
            isActive: true,
            validatedAt: true,
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        safePointOptions = optionRecords.map((point) => ({
          id: point.id,
          name: point.name,
          isActive: point.isActive,
          validatedAt: point.validatedAt?.toISOString(),
        }));
      }

      return {
        ...mapIncidentHeader(record),
        origin: record.origin.toLowerCase() as ManagedIncident["origin"],
        affectedMunicipalities:
          record.affectedMunicipalities.length > 0
            ? record.affectedMunicipalities.map(({ municipality }) => ({
                id: municipality.id,
                name: municipality.name,
                province: municipality.province ?? undefined,
                region: municipality.region ?? undefined,
              }))
            : record.municipality
              ? [
                  {
                    id: record.municipality.id,
                    name: record.municipality.name,
                    province: record.municipality.province ?? undefined,
                    region: record.municipality.region ?? undefined,
                  },
                ]
              : [],
        isPubliclyVisible: isIncidentPubliclyEligible(record),
        ...(publicPreview ? { publicPreview } : {}),
        description: record.description ?? undefined,
        operationalCoordinates: {
          lat: Number(record.operationalLatitude),
          lng: Number(record.operationalLongitude),
        },
        operationalRadiusMeters: record.radiusMeters,
        organizationId: record.organizationId ?? undefined,
        organizationName: record.organization?.name ?? undefined,
        createdAt: record.createdAt.toISOString(),
        verifiedAt: record.verifiedAt?.toISOString(),
        verifiedByName: record.verifiedBy
          ? actorLabel(record.verifiedBy)
          : undefined,
        closedAt: record.closedAt?.toISOString(),
        closedReason: record.closedReason ?? undefined,
        lastActivityAt: record.lastActivityAt.toISOString(),
        publicLocationApprovedByName: record.publicLocationApprovedBy
          ? actorLabel(record.publicLocationApprovedBy)
          : undefined,
        safePoints,
        needs,
        notices: publicPreview?.incident.notices ?? [],
        contributions,
        recentContributions,
        activity,
        counts: {
          needs: needCount,
          contributions: contributionCount,
          contributionStatuses: contributionStatusCounts,
          safePoints: safePointCount,
          activity: activityCount,
        },
        pagination: {
          tab,
          page: resolvedPage,
          pageSize,
          total,
          pageCount,
        },
        safePointOptions,
        needOptions,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export const safePointOperationPageSizes = [10, 25, 50, 100] as const;

export async function getDropOffPointQueue() {
  const coordinator = await requireCoordinator();
  const records = await prisma.safePoint.findMany({
    where: { incident: incidentScopeWhere(coordinator) },
    select: {
      id: true,
      name: true,
      address: true,
      pointType: true,
      pointStatus: true,
      isActive: true,
      publishedAt: true,
      updatedAt: true,
      incident: {
        select: {
          id: true,
          publicCode: true,
          title: true,
          municipality: { select: { name: true } },
        },
      },
      _count: { select: { contributions: true } },
    },
    orderBy: [{ pointStatus: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
    take: 500,
  });

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    address: record.address ?? "Dirección pendiente",
    type: record.pointType.toLowerCase(),
    status: record.pointStatus.toLowerCase(),
    isActive: record.isActive,
    publishedAt: record.publishedAt?.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    contributionCount: record._count.contributions,
    incident: {
      id: record.incident.id,
      publicCode: record.incident.publicCode,
      title: record.incident.title,
      municipalityName: record.incident.municipality?.name ?? "Sin municipio",
    },
  }));
}

export async function getNoticeCoordinationData() {
  const coordinator = await requireCoordinator();
  const scope = incidentScopeWhere(coordinator);
  const [incidents, notices] = await Promise.all([
    prisma.incident.findMany({
      where: {
        ...scope,
        status: { in: [DbIncidentStatus.ACTIVE, DbIncidentStatus.MONITORING] },
      },
      select: { id: true, publicCode: true, title: true },
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
      take: 200,
    }),
    prisma.incidentNotice.findMany({
      where: { incident: scope },
      select: {
        id: true,
        title: true,
        body: true,
        status: true,
        publishedAt: true,
        closedAt: true,
        createdAt: true,
        incident: { select: { id: true, publicCode: true, title: true } },
        organization: { select: { name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
    }),
  ]);

  return {
    incidents,
    notices: notices.map((notice) => ({
      ...notice,
      status: notice.status.toLowerCase(),
      publishedAt: notice.publishedAt?.toISOString(),
      closedAt: notice.closedAt?.toISOString(),
      createdAt: notice.createdAt.toISOString(),
    })),
  };
}

export async function getSafePointOperations(
  qrToken: string,
  options: { page?: number; pageSize?: number } = {},
) {
  const coordinator = await requireCoordinator();
  const { page, pageSize } = pagination(options.page, options.pageSize);
  const safePoint = await prisma.safePoint.findFirst({
    where: { qrToken, incident: incidentScopeWhere(coordinator) },
    select: {
      id: true,
      qrToken: true,
      name: true,
      address: true,
      incidentId: true,
      isActive: true,
      validatedAt: true,
      validatedById: true,
      incident: { select: { title: true } },
    },
  });
  if (!safePoint) return null;

  const contributionWhere: Prisma.ContributionWhereInput = {
    AND: [{ safePointId: safePoint.id }, contributionScopeWhere(coordinator)],
  };
  const { total, contributionRecords, resolvedPage, pageCount } =
    await prisma.$transaction(
      async (transaction) => {
        const recordCount = await transaction.contribution.count({
          where: contributionWhere,
        });
        const resolvedPageCount = Math.max(
          1,
          Math.ceil(recordCount / pageSize),
        );
        const resolvedPageNumber = Math.min(page, resolvedPageCount);
        const records = await transaction.contribution.findMany({
          where: contributionWhere,
          include: managedContributionInclude,
          orderBy: [
            { updatedAt: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          skip: (resolvedPageNumber - 1) * pageSize,
          take: pageSize,
        });

        return {
          total: recordCount,
          contributionRecords: records,
          resolvedPage: resolvedPageNumber,
          pageCount: resolvedPageCount,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

  return {
    id: safePoint.id,
    qrToken: safePoint.qrToken,
    name: safePoint.name,
    address: safePoint.address ?? "Dirección pendiente",
    incidentId: safePoint.incidentId,
    incidentTitle: safePoint.incident.title,
    isActive: safePoint.isActive,
    isOperational: Boolean(
      safePoint.isActive && safePoint.validatedAt && safePoint.validatedById,
    ),
    contributions: {
      items: contributionRecords.map(mapManagedContribution),
      page: resolvedPage,
      pageSize,
      total,
      pageCount,
    } satisfies PageResult<ManagedContribution>,
  };
}

export { calculateRemainingQuantity };
