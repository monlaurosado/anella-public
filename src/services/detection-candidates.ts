import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import {
  DetectionSource,
  ExternalDetectionStatus,
  IncidentOrigin,
  IncidentStatus,
  IncidentType,
  NotificationKind,
  OrganizationVerificationStatus,
  Priority,
  PublicLocationMode,
} from "@/generated/prisma/enums";
import { getEmergencyAutomationConfig } from "@/config/env";
import { prisma } from "@/lib/db";

const CANDIDATE_PLANNER_LOCK = "anella:detection-candidate-planner:v1";
const ACTIVE_INCIDENT_STATUSES = [
  IncidentStatus.DRAFT,
  IncidentStatus.PENDING_VALIDATION,
  IncidentStatus.ACTIVE,
  IncidentStatus.MONITORING,
];
const OFFICIAL_OPEN_STATUSES = new Set([
  "DECLARED",
  "ACTIVE",
  "STABILIZED",
  "CONTROLLED",
]);

type NamedLockValue = number | bigint | string | null;

export type CandidateDetection = {
  id: string;
  source: string;
  provider: string | null;
  providerStatus: string | null;
  latitude: number;
  longitude: number;
  detectedAt: Date;
  municipalityId: string;
};

export type DetectionCluster = {
  detections: CandidateDetection[];
  latitude: number;
  longitude: number;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  municipalityIds: string[];
  sources: string[];
  hasOfficialOpenSignal: boolean;
  thermalSignalCount: number;
  qualifiesAsCandidate: boolean;
};

export type DetectionCandidatePlanResult = {
  status: "completed" | "busy" | "disabled";
  clusters: number;
  qualifyingClusters: number;
  candidatesCreated: number;
  linkedToExisting: number;
  detectionsLinked: number;
  notificationsQueued: number;
  notificationsSuppressedByCooldown: number;
};

type PlannerOptions = {
  now?: Date;
  actorId?: string;
  createCandidates?: boolean;
  enqueueNotifications?: boolean;
  radiusMeters?: number;
  windowMinutes?: number;
  minimumThermalSignals?: number;
};

function emptyResult(
  status: DetectionCandidatePlanResult["status"],
): DetectionCandidatePlanResult {
  return {
    status,
    clusters: 0,
    qualifyingClusters: 0,
    candidatesCreated: 0,
    linkedToExisting: 0,
    detectionsLinked: 0,
    notificationsQueued: 0,
    notificationsSuppressedByCooldown: 0,
  };
}

function json(value: Record<string, unknown>) {
  return value as Prisma.InputJsonObject;
}

export function distanceMeters(
  first: Pick<CandidateDetection, "latitude" | "longitude">,
  second: Pick<CandidateDetection, "latitude" | "longitude">,
) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_008.8;
  const deltaLatitude = toRadians(second.latitude - first.latitude);
  const deltaLongitude = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(deltaLongitude / 2) ** 2;
  return (
    2 *
    earthRadiusMeters *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function summarizeCluster(
  detections: CandidateDetection[],
  minimumThermalSignals: number,
): DetectionCluster {
  const ordered = [...detections].sort(
    (first, second) =>
      first.detectedAt.getTime() - second.detectedAt.getTime() ||
      first.id.localeCompare(second.id),
  );
  const thermalSignalCount = ordered.filter(
    (detection) => detection.source === DetectionSource.NASA_FIRMS,
  ).length;
  const hasOfficialOpenSignal = ordered.some(
    (detection) =>
      detection.source !== DetectionSource.NASA_FIRMS &&
      OFFICIAL_OPEN_STATUSES.has(detection.providerStatus ?? ""),
  );
  return {
    detections: ordered,
    latitude:
      ordered.reduce((total, detection) => total + detection.latitude, 0) /
      ordered.length,
    longitude:
      ordered.reduce((total, detection) => total + detection.longitude, 0) /
      ordered.length,
    firstDetectedAt: ordered[0].detectedAt,
    lastDetectedAt: ordered.at(-1)!.detectedAt,
    municipalityIds: [
      ...new Set(ordered.map((detection) => detection.municipalityId)),
    ].sort(),
    sources: [
      ...new Set(
        ordered.map((detection) => detection.provider ?? detection.source),
      ),
    ].sort(),
    hasOfficialOpenSignal,
    thermalSignalCount,
    qualifiesAsCandidate:
      hasOfficialOpenSignal || thermalSignalCount >= minimumThermalSignals,
  };
}

/**
 * Deterministic greedy clustering. Every member must fall inside the cluster's
 * complete time window and be spatially close to at least one prior member.
 * This prevents a chain of detections from joining unrelated events over many
 * hours while still grouping one event observed by several providers.
 */
export function groupCandidateDetections(
  detections: CandidateDetection[],
  options: {
    radiusMeters: number;
    windowMinutes: number;
    minimumThermalSignals: number;
  },
) {
  const windowMilliseconds = options.windowMinutes * 60_000;
  const clusters: CandidateDetection[][] = [];
  const ordered = [...detections].sort(
    (first, second) =>
      first.detectedAt.getTime() - second.detectedAt.getTime() ||
      first.id.localeCompare(second.id),
  );

  for (const detection of ordered) {
    const matchingCluster = clusters.find((cluster) => {
      const firstDetectedAt = cluster[0].detectedAt.getTime();
      if (
        detection.detectedAt.getTime() - firstDetectedAt >
        windowMilliseconds
      ) {
        return false;
      }
      return cluster.some(
        (member) => distanceMeters(member, detection) <= options.radiusMeters,
      );
    });
    if (matchingCluster) matchingCluster.push(detection);
    else clusters.push([detection]);
  }

  return clusters.map((cluster) =>
    summarizeCluster(cluster, options.minimumThermalSignals),
  );
}

function candidatePublicCode(cluster: DetectionCluster) {
  const signature = cluster.detections
    .map((detection) => detection.id)
    .sort()
    .join(":");
  return `CAND-${createHash("sha256").update(signature).digest("hex").slice(0, 20)}`;
}

function primaryMunicipalityId(cluster: DetectionCluster) {
  const counts = new Map<string, number>();
  for (const detection of cluster.detections) {
    counts.set(
      detection.municipalityId,
      (counts.get(detection.municipalityId) ?? 0) + 1,
    );
  }
  return [...counts.entries()].sort(
    ([firstId, firstCount], [secondId, secondCount]) =>
      secondCount - firstCount || firstId.localeCompare(secondId),
  )[0][0];
}

async function findNearbyIncident(
  transaction: Prisma.TransactionClient,
  cluster: DetectionCluster,
  radiusMeters: number,
  now: Date,
) {
  const incidents = await transaction.incident.findMany({
    where: {
      status: { in: ACTIVE_INCIDENT_STATUSES },
      lastActivityAt: {
        gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
      },
      OR: [
        { municipalityId: { in: cluster.municipalityIds } },
        {
          affectedMunicipalities: {
            some: { municipalityId: { in: cluster.municipalityIds } },
          },
        },
      ],
    },
    select: {
      id: true,
      operationalLatitude: true,
      operationalLongitude: true,
      radiusMeters: true,
    },
    orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  return incidents.find(
    (incident) =>
      distanceMeters(cluster, {
        latitude: Number(incident.operationalLatitude),
        longitude: Number(incident.operationalLongitude),
      }) <= Math.max(radiusMeters * 2, incident.radiusMeters),
  );
}

async function createOrLinkCandidate(
  transaction: Prisma.TransactionClient,
  cluster: DetectionCluster,
  options: { radiusMeters: number; now: Date; actorId?: string },
) {
  const nearby = await findNearbyIncident(
    transaction,
    cluster,
    options.radiusMeters,
    options.now,
  );
  const primaryMunicipality = primaryMunicipalityId(cluster);
  let incidentId = nearby?.id;
  let created = false;
  if (!incidentId) {
    const incident = await transaction.incident.create({
      data: {
        publicCode: candidatePublicCode(cluster),
        title: "Posible emergencia en revisión",
        type: IncidentType.WILDFIRE,
        status: IncidentStatus.PENDING_VALIDATION,
        priority: cluster.hasOfficialOpenSignal
          ? Priority.HIGH
          : Priority.MEDIUM,
        origin: IncidentOrigin.DETECTION_CANDIDATE,
        description:
          "Candidata interna generada por agrupación espacial y temporal. Requiere revisión humana antes de cualquier publicación.",
        operationalLatitude: cluster.latitude,
        operationalLongitude: cluster.longitude,
        radiusMeters: options.radiusMeters,
        publicLocationMode: PublicLocationMode.MUNICIPALITY_ONLY,
        municipalityId: primaryMunicipality,
        lastActivityAt: cluster.lastDetectedAt,
        affectedMunicipalities: {
          create: cluster.municipalityIds.map((municipalityId) => ({
            municipalityId,
            isPrimary: municipalityId === primaryMunicipality,
          })),
        },
      },
      select: { id: true },
    });
    incidentId = incident.id;
    created = true;
  } else {
    await transaction.incidentMunicipality.createMany({
      data: cluster.municipalityIds.map((municipalityId) => ({
        incidentId: incidentId!,
        municipalityId,
        isPrimary: false,
      })),
      skipDuplicates: true,
    });
  }

  const linked = await transaction.externalDetection.updateMany({
    where: {
      id: { in: cluster.detections.map((detection) => detection.id) },
      status: ExternalDetectionStatus.PENDING,
      linkedIncidentId: null,
    },
    data: {
      status: ExternalDetectionStatus.LINKED,
      linkedIncidentId: incidentId,
    },
  });
  await transaction.auditLog.create({
    data: {
      actorId: options.actorId,
      incidentId,
      municipalityId: primaryMunicipality,
      action: created
        ? "incident.detection_candidate_created"
        : "external_detection.cluster_linked",
      entityType: created ? "Incident" : "ExternalDetection",
      entityId: incidentId,
      metadata: json({
        detections: cluster.detections.length,
        sources: cluster.sources,
        municipalities: cluster.municipalityIds,
        rule: cluster.hasOfficialOpenSignal
          ? "official-open-signal"
          : "thermal-signal-threshold",
        publicConfirmation: false,
      }),
    },
  });
  return { incidentId, created, linked: linked.count };
}

async function enqueueDetectionDigests(
  transaction: Prisma.TransactionClient,
  clusters: Array<DetectionCluster & { incidentId: string | null }>,
  now: Date,
  actorId?: string,
) {
  const organizations = await transaction.organization.findMany({
    where: {
      verificationStatus: OrganizationVerificationStatus.VERIFIED,
      notificationEnabled: true,
      municipalityId: { not: null },
      municipality: { latitude: { not: null }, longitude: { not: null } },
    },
    select: {
      id: true,
      municipalityId: true,
      notificationRadiusMeters: true,
      notificationCooldownMinutes: true,
      municipality: {
        select: { latitude: true, longitude: true },
      },
    },
    take: 20_000,
  });

  let queued = 0;
  let suppressed = 0;
  for (const organization of organizations) {
    if (!organization.municipalityId || !organization.municipality) continue;
    const matchingClusters = clusters.filter(
      (cluster) =>
        distanceMeters(cluster, {
          latitude: Number(organization.municipality!.latitude),
          longitude: Number(organization.municipality!.longitude),
        }) <= organization.notificationRadiusMeters,
    );
    if (matchingClusters.length === 0) continue;

    const cooldownStart = new Date(
      now.getTime() - organization.notificationCooldownMinutes * 60_000,
    );
    const recentDigest = await transaction.notificationOutbox.findFirst({
      where: {
        organizationId: organization.id,
        municipalityId: organization.municipalityId,
        kind: NotificationKind.DETECTION_DIGEST,
        createdAt: { gte: cooldownStart },
      },
      select: { id: true },
    });
    if (recentDigest) {
      suppressed += 1;
      continue;
    }

    const incidentIds = [
      ...new Set(
        matchingClusters
          .map((cluster) => cluster.incidentId)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort();
    const sources = [
      ...new Set(matchingClusters.flatMap((cluster) => cluster.sources)),
    ].sort();
    const idempotencySignature = createHash("sha256")
      .update(
        [
          organization.id,
          organization.municipalityId,
          ...matchingClusters.flatMap((cluster) =>
            cluster.detections.map((detection) => detection.id),
          ),
        ]
          .sort()
          .join(":"),
      )
      .digest("hex")
      .slice(0, 32);
    const idempotencyKey = `detection-digest:${idempotencySignature}`;
    const alreadyPlanned = await transaction.notificationOutbox.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (alreadyPlanned) {
      suppressed += 1;
      continue;
    }
    const outbox = await transaction.notificationOutbox.create({
      data: {
        idempotencyKey,
        kind: NotificationKind.DETECTION_DIGEST,
        incidentId: incidentIds.length === 1 ? incidentIds[0] : null,
        municipalityId: organization.municipalityId,
        organizationId: organization.id,
        templateKey: "possible-fire-detection-digest-v1",
        payload: json({
          clusterCount: matchingClusters.length,
          signalCount: matchingClusters.reduce(
            (total, cluster) => total + cluster.detections.length,
            0,
          ),
          sources,
          incidentIds,
          firstDetectedAt: new Date(
            Math.min(
              ...matchingClusters.map((cluster) =>
                cluster.firstDetectedAt.getTime(),
              ),
            ),
          ).toISOString(),
          lastDetectedAt: new Date(
            Math.max(
              ...matchingClusters.map((cluster) =>
                cluster.lastDetectedAt.getTime(),
              ),
            ),
          ).toISOString(),
          statement: "possible-fire-signal-requires-human-review",
        }),
      },
      select: { id: true },
    });
    await transaction.auditLog.create({
      data: {
        actorId,
        incidentId: incidentIds.length === 1 ? incidentIds[0] : undefined,
        municipalityId: organization.municipalityId,
        action: "notification.detection_digest_queued",
        entityType: "NotificationOutbox",
        entityId: outbox.id,
        metadata: json({
          organizationId: organization.id,
          clusterCount: matchingClusters.length,
          signalCount: matchingClusters.reduce(
            (total, cluster) => total + cluster.detections.length,
            0,
          ),
          containsTacticalCoordinates: false,
        }),
      },
    });
    queued += 1;
  }
  return { queued, suppressed };
}

export async function planDetectionCandidates(
  options: PlannerOptions = {},
): Promise<DetectionCandidatePlanResult> {
  const config = getEmergencyAutomationConfig();
  const createCandidates =
    options.createCandidates ?? config.candidateAutomationEnabled;
  const enqueueNotifications =
    options.enqueueNotifications ?? config.notificationOutboxEnabled;
  if (!createCandidates && !enqueueNotifications)
    return emptyResult("disabled");

  const now = options.now ?? new Date();
  const radiusMeters = options.radiusMeters ?? config.candidateRadiusMeters;
  const windowMinutes = options.windowMinutes ?? config.candidateWindowMinutes;
  const minimumThermalSignals =
    options.minimumThermalSignals ?? config.minimumThermalSignals;
  const earliest = new Date(now.getTime() - windowMinutes * 60_000);

  return prisma.$transaction(
    async (transaction) => {
      const lockRows = await transaction.$queryRaw<
        Array<{ acquired: NamedLockValue }>
      >`SELECT GET_LOCK(${CANDIDATE_PLANNER_LOCK}, 0) AS acquired`;
      if (Number(lockRows[0]?.acquired ?? 0) !== 1) return emptyResult("busy");

      try {
        const rows = await transaction.externalDetection.findMany({
          where: {
            status: ExternalDetectionStatus.PENDING,
            linkedIncidentId: null,
            municipalityId: { not: null },
            detectedAt: { gte: earliest, lte: now },
          },
          select: {
            id: true,
            source: true,
            provider: true,
            providerStatus: true,
            latitude: true,
            longitude: true,
            detectedAt: true,
            municipalityId: true,
          },
          orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
          take: 5_000,
        });
        const clusters = groupCandidateDetections(
          rows.map((row) => ({
            ...row,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            municipalityId: row.municipalityId!,
          })),
          { radiusMeters, windowMinutes, minimumThermalSignals },
        );
        const qualifying = clusters.filter(
          (cluster) => cluster.qualifiesAsCandidate,
        );
        const result: DetectionCandidatePlanResult = {
          ...emptyResult("completed"),
          clusters: clusters.length,
          qualifyingClusters: qualifying.length,
        };
        const planned: Array<DetectionCluster & { incidentId: string | null }> =
          [];
        for (const cluster of qualifying) {
          if (!createCandidates) {
            planned.push({ ...cluster, incidentId: null });
            continue;
          }
          const linked = await createOrLinkCandidate(transaction, cluster, {
            radiusMeters,
            now,
            actorId: options.actorId,
          });
          result.candidatesCreated += linked.created ? 1 : 0;
          result.linkedToExisting += linked.created ? 0 : 1;
          result.detectionsLinked += linked.linked;
          planned.push({ ...cluster, incidentId: linked.incidentId });
        }
        if (enqueueNotifications && planned.length > 0) {
          const notificationResult = await enqueueDetectionDigests(
            transaction,
            planned,
            now,
            options.actorId,
          );
          result.notificationsQueued = notificationResult.queued;
          result.notificationsSuppressedByCooldown =
            notificationResult.suppressed;
        }
        return result;
      } finally {
        await transaction.$queryRaw<
          Array<{ released: NamedLockValue }>
        >`SELECT RELEASE_LOCK(${CANDIDATE_PLANNER_LOCK}) AS released`;
      }
    },
    { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 60_000 },
  );
}
