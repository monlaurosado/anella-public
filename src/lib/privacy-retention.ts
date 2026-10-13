import mariadb from "mariadb";

import { Prisma } from "@/generated/prisma/client";
import {
  ContributionStatus,
  IncidentStatus,
  NeedStatus,
  NotificationOutboxStatus,
  OrganizationClaimStatus,
} from "@/generated/prisma/enums";
import { getDatabaseUrl, getPrivacyConfig } from "@/config/env";
import { prisma } from "@/lib/db";

export const ANONYMIZED_CONTRIBUTOR_NAME = "Datos anonimizados";
export const ANONYMIZED_CLAIMANT_NAME = "Datos anonimizados";
export const ANONYMIZED_CLAIMANT_EMAIL = "anonimizada@invalid.local";
const MAINTENANCE_LOCK_NAME = "anella:operational-maintenance:v1";
const MAINTENANCE_BATCH_SIZE = 500;
const MAINTENANCE_BATCH_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 15_000,
} as const;
const pendingDeliveryStatuses = [
  ContributionStatus.PLEDGED,
  ContributionStatus.EN_ROUTE,
  ContributionStatus.PARTIALLY_DELIVERED,
];

export function getRetentionCutoff(now: Date, retentionDays: number) {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

type MaintenanceLockResult<T> =
  { acquired: false } | { acquired: true; value: T };

function getMaintenanceConnectionUrl() {
  const databaseUrl = new URL(getDatabaseUrl());
  databaseUrl.protocol = "mariadb:";
  if (databaseUrl.searchParams.get("sslaccept") === "strict") {
    databaseUrl.searchParams.delete("sslaccept");
    databaseUrl.searchParams.set("ssl", "true");
  }
  return databaseUrl.toString();
}

async function withMaintenanceLock<T>(
  operation: (assertLockOwned: () => Promise<void>) => Promise<T>,
): Promise<MaintenanceLockResult<T>> {
  // MySQL named locks belong to a connection, not to a transaction. Keeping a
  // dedicated connection open lets every data batch commit independently while
  // the exclusion lock remains owned for the whole maintenance invocation.
  const lockConnection = await mariadb.createConnection(
    getMaintenanceConnectionUrl(),
  );
  let acquired = false;

  try {
    const rows = (await lockConnection.query(
      "SELECT GET_LOCK(?, 0) AS acquired",
      [MAINTENANCE_LOCK_NAME],
    )) as Array<{ acquired: number | bigint | null }>;
    acquired = Number(rows[0]?.acquired ?? 0) === 1;
    if (!acquired) return { acquired: false };

    const assertLockOwned = async () => {
      const ownership = (await lockConnection.query(
        `SELECT
           IS_USED_LOCK(?) AS owner,
           CONNECTION_ID() AS connectionId`,
        [MAINTENANCE_LOCK_NAME],
      )) as Array<{
        owner: number | bigint | null;
        connectionId: number | bigint;
      }>;
      if (
        Number(ownership[0]?.owner ?? -1) !==
        Number(ownership[0]?.connectionId ?? -2)
      ) {
        throw new Error(
          "Se perdió el lock exclusivo durante el mantenimiento.",
        );
      }
    };

    return { acquired: true, value: await operation(assertLockOwned) };
  } finally {
    try {
      if (acquired) {
        await lockConnection.query("SELECT RELEASE_LOCK(?)", [
          MAINTENANCE_LOCK_NAME,
        ]);
      }
    } finally {
      await lockConnection.end();
    }
  }
}

async function runMaintenanceBatch<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(operation, MAINTENANCE_BATCH_TRANSACTION_OPTIONS);
}

async function drainMaintenanceBatches(
  assertLockOwned: () => Promise<void>,
  operation: () => Promise<number>,
) {
  let processed = 0;

  while (true) {
    await assertLockOwned();
    const batchCount = await operation();
    if (batchCount === 0) return processed;
    processed += batchCount;
  }
}

function dueNeedsWhere(now: Date) {
  return {
    status: NeedStatus.ACTIVE,
    deadline: { lte: now },
  } satisfies Prisma.NeedWhereInput;
}

async function expireDueNeedsBatch(
  transaction: Prisma.TransactionClient,
  now: Date,
) {
  const group = await transaction.need.findMany({
    where: {
      ...dueNeedsWhere(now),
      contributions: {
        none: { status: { in: pendingDeliveryStatuses } },
      },
    },
    orderBy: { id: "asc" },
    take: MAINTENANCE_BATCH_SIZE,
    select: {
      id: true,
      incidentId: true,
      deadline: true,
      incident: { select: { municipalityId: true } },
    },
  });
  if (group.length === 0) return 0;

  const ids = group.map((need) => need.id);
  const updated = await transaction.need.updateMany({
    where: { id: { in: ids }, status: NeedStatus.ACTIVE },
    data: { status: NeedStatus.EXPIRED },
  });
  if (updated.count !== group.length) {
    throw new Error(
      "El lote de necesidades vencidas cambió durante el mantenimiento.",
    );
  }

  await transaction.auditLog.createMany({
    data: group.map((need) => ({
      incidentId: need.incidentId,
      municipalityId: need.incident.municipalityId,
      action: "need.expired_automatically",
      entityType: "Need",
      entityId: need.id,
      metadata: {
        deadline: need.deadline?.toISOString() ?? null,
        expiredAt: now.toISOString(),
        pendingDeliveriesAtExpiry: 0,
      },
    })),
  });
  await transaction.incident.updateMany({
    where: { id: { in: [...new Set(group.map((need) => need.incidentId))] } },
    data: { lastActivityAt: now },
  });

  return updated.count;
}

function contributionCandidatesWhere(cutoff: Date, now: Date) {
  return {
    AND: [
      {
        OR: [
          { piiExpiresAt: { lte: now } },
          {
            incident: {
              status: {
                in: [IncidentStatus.RESOLVED, IncidentStatus.CANCELLED],
              },
              OR: [
                { closedAt: { lt: cutoff } },
                { closedAt: null, updatedAt: { lt: cutoff } },
              ],
            },
          },
        ],
      },
      {
        OR: [
          { citizenName: { not: ANONYMIZED_CONTRIBUTOR_NAME } },
          { citizenPhone: { not: null } },
          { citizenEmail: { not: null } },
          { description: { not: null } },
          { notes: { not: null } },
          { eta: { not: null } },
          { statusReason: { not: null } },
          { cancelTokenHash: { not: null } },
        ],
      },
    ],
  } satisfies Prisma.ContributionWhereInput;
}

async function anonymizeContributionBatch(
  transaction: Prisma.TransactionClient,
  now: Date,
  retentionDays: number,
) {
  const cutoff = getRetentionCutoff(now, retentionDays);
  const candidates = await transaction.contribution.findMany({
    where: contributionCandidatesWhere(cutoff, now),
    orderBy: { id: "asc" },
    take: MAINTENANCE_BATCH_SIZE,
    select: {
      id: true,
      incidentId: true,
      incident: { select: { municipalityId: true } },
    },
  });
  if (candidates.length === 0) return 0;

  const countsByIncident = new Map<
    string,
    { count: number; municipalityId: string | null }
  >();
  for (const contribution of candidates) {
    const incidentId = contribution.incidentId;
    const current = countsByIncident.get(incidentId);
    countsByIncident.set(incidentId, {
      count: (current?.count ?? 0) + 1,
      municipalityId: contribution.incident.municipalityId,
    });
  }

  const updated = await transaction.contribution.updateMany({
    where: { id: { in: candidates.map((item) => item.id) } },
    data: {
      citizenName: ANONYMIZED_CONTRIBUTOR_NAME,
      citizenPhone: null,
      citizenEmail: null,
      description: null,
      notes: null,
      eta: null,
      statusReason: null,
      cancelTokenHash: null,
    },
  });
  if (updated.count !== candidates.length) {
    throw new Error(
      "El lote de contribuciones cambió durante la anonimización.",
    );
  }

  await transaction.auditLog.createMany({
    data: [...countsByIncident].map(([incidentId, summary]) => ({
      incidentId,
      municipalityId: summary.municipalityId,
      action: "privacy.contributions_anonymized",
      entityType: "Incident",
      entityId: incidentId,
      metadata: {
        count: summary.count,
        cutoff: cutoff.toISOString(),
        retentionDays,
      },
    })),
  });

  return updated.count;
}

async function anonymizeOrganizationClaimsBatch(
  transaction: Prisma.TransactionClient,
  now: Date,
) {
  const candidates = await transaction.organizationClaim.findMany({
    where: {
      piiExpiresAt: { lte: now },
      OR: [
        { claimantName: { not: ANONYMIZED_CLAIMANT_NAME } },
        { claimantEmail: { not: ANONYMIZED_CLAIMANT_EMAIL } },
        { emailDomain: { not: "invalid.local" } },
        { verificationTokenHash: { not: null } },
        { verificationTokenCiphertext: { not: null } },
        { reviewReason: { not: null } },
      ],
    },
    orderBy: { id: "asc" },
    take: MAINTENANCE_BATCH_SIZE,
    select: {
      id: true,
      municipalityId: true,
      organizationId: true,
      status: true,
    },
  });
  if (candidates.length === 0) return 0;

  const ids = candidates.map((claim) => claim.id);
  const openClaimStatuses = new Set<OrganizationClaimStatus>([
    OrganizationClaimStatus.EMAIL_PENDING,
    OrganizationClaimStatus.PENDING_REVIEW,
  ]);
  const openIds = candidates
    .filter((claim) => openClaimStatuses.has(claim.status))
    .map((claim) => claim.id);
  const closedIds = ids.filter((id) => !openIds.includes(id));

  const commonData = {
    claimantName: ANONYMIZED_CLAIMANT_NAME,
    claimantEmail: ANONYMIZED_CLAIMANT_EMAIL,
    emailDomain: "invalid.local",
    verificationTokenHash: null,
    verificationTokenCiphertext: null,
    reviewReason: null,
  } as const;
  let updatedCount = 0;
  if (openIds.length > 0) {
    const updated = await transaction.organizationClaim.updateMany({
      where: { id: { in: openIds } },
      data: { ...commonData, status: OrganizationClaimStatus.EXPIRED },
    });
    updatedCount += updated.count;
  }
  if (closedIds.length > 0) {
    const updated = await transaction.organizationClaim.updateMany({
      where: { id: { in: closedIds } },
      data: commonData,
    });
    updatedCount += updated.count;
  }
  if (updatedCount !== candidates.length) {
    throw new Error(
      "El lote de reclamaciones cambió durante la anonimización.",
    );
  }

  await transaction.auditLog.createMany({
    data: candidates.map((claim) => ({
      municipalityId: claim.municipalityId,
      action: "privacy.organization_claim_anonymized",
      entityType: "OrganizationClaim",
      entityId: claim.id,
      metadata: {
        organizationId: claim.organizationId,
        priorStatus: claim.status,
        redactedAt: now.toISOString(),
      },
    })),
  });

  return updatedCount;
}

async function redactNotificationOutboxBatch(
  transaction: Prisma.TransactionClient,
  now: Date,
  retentionDays: number,
) {
  const cutoff = getRetentionCutoff(now, retentionDays);
  const candidates = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM NotificationOutbox
    WHERE status IN ('SENT', 'DISCARDED')
      AND updatedAt < ${cutoff}
      AND (
        JSON_EXTRACT(payload, '$.retentionRedacted') IS NULL
        OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.retentionRedacted')) <> 'true'
      )
    ORDER BY id ASC
    LIMIT ${MAINTENANCE_BATCH_SIZE}
  `;
  if (candidates.length === 0) return 0;

  const updated = await transaction.notificationOutbox.updateMany({
    where: {
      id: { in: candidates.map((entry) => entry.id) },
      status: {
        in: [NotificationOutboxStatus.SENT, NotificationOutboxStatus.DISCARDED],
      },
    },
    data: {
      payload: {
        retentionRedacted: true,
        redactedAt: now.toISOString(),
      },
      lastError: null,
    },
  });
  if (updated.count !== candidates.length) {
    throw new Error(
      "El lote de notificaciones cambió durante la anonimización.",
    );
  }
  return updated.count;
}

async function redactAuditEntriesBatch(
  transaction: Prisma.TransactionClient,
  now: Date,
  retentionDays: number,
) {
  const cutoff = getRetentionCutoff(now, retentionDays);
  const auditCandidates = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT audit.id
    FROM AuditLog AS audit
    INNER JOIN Incident AS incident ON incident.id = audit.incidentId
    WHERE incident.status IN ('RESOLVED', 'CANCELLED')
      AND (
        incident.closedAt < ${cutoff}
        OR (incident.closedAt IS NULL AND incident.updatedAt < ${cutoff})
      )
      AND (
        audit.metadata IS NULL
        OR JSON_EXTRACT(audit.metadata, '$.retentionRedacted') IS NULL
        OR JSON_UNQUOTE(JSON_EXTRACT(audit.metadata, '$.retentionRedacted')) <> 'true'
      )
    ORDER BY audit.id ASC
    LIMIT ${MAINTENANCE_BATCH_SIZE}
  `;
  if (auditCandidates.length === 0) return 0;

  const updated = await transaction.auditLog.updateMany({
    where: { id: { in: auditCandidates.map((entry) => entry.id) } },
    data: {
      metadata: {
        retentionRedacted: true,
        redactedAt: now.toISOString(),
        retentionDays,
      },
    },
  });
  if (updated.count !== auditCandidates.length) {
    throw new Error("El lote de auditoría cambió durante la anonimización.");
  }

  return updated.count;
}

async function removeThrottleEntriesBatch(
  transaction: Prisma.TransactionClient,
  throttleCutoff: Date,
) {
  const candidates = await transaction.submissionThrottle.findMany({
    where: { updatedAt: { lt: throttleCutoff } },
    orderBy: { id: "asc" },
    take: MAINTENANCE_BATCH_SIZE,
    select: { id: true },
  });
  if (candidates.length === 0) return 0;

  const removed = await transaction.submissionThrottle.deleteMany({
    where: {
      id: { in: candidates.map((entry) => entry.id) },
      updatedAt: { lt: throttleCutoff },
    },
  });

  return removed.count;
}

async function runPrivacyMaintenanceBatches(
  now: Date,
  retentionDays: number,
  assertLockOwned: () => Promise<void>,
) {
  const throttleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const anonymizedContributions = await drainMaintenanceBatches(
    assertLockOwned,
    () =>
      runMaintenanceBatch((transaction) =>
        anonymizeContributionBatch(transaction, now, retentionDays),
      ),
  );
  const anonymizedOrganizationClaims = await drainMaintenanceBatches(
    assertLockOwned,
    () =>
      runMaintenanceBatch((transaction) =>
        anonymizeOrganizationClaimsBatch(transaction, now),
      ),
  );
  const redactedNotificationOutbox = await drainMaintenanceBatches(
    assertLockOwned,
    () =>
      runMaintenanceBatch((transaction) =>
        redactNotificationOutboxBatch(transaction, now, retentionDays),
      ),
  );
  const redactedAuditEntries = await drainMaintenanceBatches(
    assertLockOwned,
    () =>
      runMaintenanceBatch((transaction) =>
        redactAuditEntriesBatch(transaction, now, retentionDays),
      ),
  );
  const removedThrottleEntries = await drainMaintenanceBatches(
    assertLockOwned,
    () =>
      runMaintenanceBatch((transaction) =>
        removeThrottleEntriesBatch(transaction, throttleCutoff),
      ),
  );

  return {
    anonymizedContributions,
    anonymizedOrganizationClaims,
    redactedNotificationOutbox,
    redactedAuditEntries,
    removedThrottleEntries,
  };
}

async function countDeferredNeeds(now: Date) {
  return prisma.need.count({
    where: {
      ...dueNeedsWhere(now),
      contributions: {
        some: { status: { in: pendingDeliveryStatuses } },
      },
    },
  });
}

async function runMaintenanceWork(
  now: Date,
  retentionDays: number,
  assertLockOwned: () => Promise<void>,
) {
  await assertLockOwned();
  const deferredNeeds = await countDeferredNeeds(now);
  const expiredNeeds = await drainMaintenanceBatches(assertLockOwned, () =>
    runMaintenanceBatch((transaction) => expireDueNeedsBatch(transaction, now)),
  );
  const privacy = await runPrivacyMaintenanceBatches(
    now,
    retentionDays,
    assertLockOwned,
  );

  return {
    expiredNeeds,
    deferredNeeds,
    ...privacy,
  };
}

function skippedMaintenanceResult() {
  return {
    skippedBecauseLocked: true as const,
    expiredNeeds: 0,
    deferredNeeds: 0,
    anonymizedContributions: 0,
    anonymizedOrganizationClaims: 0,
    redactedNotificationOutbox: 0,
    redactedAuditEntries: 0,
    removedThrottleEntries: 0,
  };
}

export async function anonymizeExpiredContributionData(now = new Date()) {
  const { retentionDays } = getPrivacyConfig();
  const result = await withMaintenanceLock((assertLockOwned) =>
    runPrivacyMaintenanceBatches(now, retentionDays, assertLockOwned),
  );
  if (!result.acquired) {
    throw new Error(
      "No se puede anonimizar mientras otro mantenimiento está en curso.",
    );
  }

  return result.value;
}

export async function runOperationalMaintenance(now = new Date()) {
  const { retentionDays } = getPrivacyConfig();
  const result = await withMaintenanceLock((assertLockOwned) =>
    runMaintenanceWork(now, retentionDays, assertLockOwned),
  );
  if (!result.acquired) return skippedMaintenanceResult();

  return {
    skippedBecauseLocked: false as const,
    ...result.value,
  };
}
