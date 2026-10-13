import "server-only";

import { z } from "zod";

import { getAppUrl, getEmergencyAutomationConfig } from "@/config/env";
import type { Prisma } from "@/generated/prisma/client";
import {
  NotificationKind,
  NotificationOutboxStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { decryptOrganizationClaimToken } from "@/services/organization-claims";

const STALE_PROCESSING_MINUTES = 15;
const RETRY_BASE_MINUTES = 5;

const detectionPayloadSchema = z.object({
  clusterCount: z.number().int().min(1).max(1_000),
  signalCount: z.number().int().min(1).max(10_000),
  sources: z.array(z.string().min(1).max(100)).max(50),
  incidentIds: z.array(z.string().min(1).max(191)).max(100),
  firstDetectedAt: z.iso.datetime(),
  lastDetectedAt: z.iso.datetime(),
  statement: z.literal("possible-fire-signal-requires-human-review"),
});

export type NotificationProviderMessage = {
  outboxId: string;
  kind: string;
  templateKey: string;
  to: string;
  data: Record<string, unknown>;
};

export type NotificationProvider = {
  send(message: NotificationProviderMessage): Promise<{
    providerMessageId?: string;
  }>;
};

export type NotificationOutboxResult = {
  status: "completed" | "disabled" | "drill";
  selected: number;
  sent: number;
  failed: number;
  discarded: number;
};

type ProcessOptions = {
  now?: Date;
  limit?: number;
  provider?: NotificationProvider;
  deliveryEnabled?: boolean;
  drillMode?: boolean;
};

function json(value: Record<string, unknown>) {
  return value as Prisma.InputJsonObject;
}

function emptyResult(
  status: NotificationOutboxResult["status"],
): NotificationOutboxResult {
  return { status, selected: 0, sent: 0, failed: 0, discarded: 0 };
}

function retryAt(now: Date, attempt: number) {
  const exponent = Math.max(0, Math.min(attempt - 1, 6));
  return new Date(now.getTime() + RETRY_BASE_MINUTES * 2 ** exponent * 60_000);
}

async function resolveMessage(
  outbox: Awaited<ReturnType<typeof loadClaimedOutbox>>,
  now: Date,
): Promise<NotificationProviderMessage | null> {
  if (!outbox) return null;

  if (outbox.kind === NotificationKind.DETECTION_DIGEST) {
    const parsed = detectionPayloadSchema.safeParse(outbox.payload);
    if (!parsed.success || !outbox.organization) return null;
    const recipient =
      outbox.organization.contactEmail ??
      outbox.organization.users[0]?.email ??
      null;
    if (!recipient) return null;
    return {
      outboxId: outbox.id,
      kind: outbox.kind,
      templateKey: outbox.templateKey,
      to: recipient,
      data: {
        organizationName: outbox.organization.name,
        clusterCount: parsed.data.clusterCount,
        signalCount: parsed.data.signalCount,
        sources: parsed.data.sources,
        firstDetectedAt: parsed.data.firstDetectedAt,
        lastDetectedAt: parsed.data.lastDetectedAt,
        reviewUrl: `${getAppUrl()}/coordinacion/emergencias`,
        confirmationStatus: "unconfirmed",
      },
    };
  }

  const claim = outbox.organizationClaim;
  if (!claim || !outbox.organization) return null;
  if (outbox.kind === NotificationKind.ORGANIZATION_CLAIM_VERIFICATION) {
    if (
      !claim.verificationTokenCiphertext ||
      !claim.verificationTokenHash ||
      claim.expiresAt <= now
    ) {
      return null;
    }
    const token = decryptOrganizationClaimToken(
      claim.verificationTokenCiphertext,
    );
    return {
      outboxId: outbox.id,
      kind: outbox.kind,
      templateKey: outbox.templateKey,
      to: claim.claimantEmail,
      data: {
        claimantName: claim.claimantName,
        organizationName: outbox.organization.name,
        verificationUrl: `${getAppUrl()}/organizaciones/reclamaciones/${token}`,
        expiresAt: claim.expiresAt.toISOString(),
      },
    };
  }
  if (outbox.kind === NotificationKind.ORGANIZATION_CLAIM_DECISION) {
    return {
      outboxId: outbox.id,
      kind: outbox.kind,
      templateKey: outbox.templateKey,
      to: claim.claimantEmail,
      data: {
        claimantName: claim.claimantName,
        organizationName: outbox.organization.name,
        decision: claim.status,
        reviewedAt: claim.reviewedAt?.toISOString() ?? null,
      },
    };
  }
  return null;
}

async function loadClaimedOutbox(id: string) {
  return prisma.notificationOutbox.findUnique({
    where: { id },
    include: {
      organization: {
        select: {
          name: true,
          contactEmail: true,
          users: {
            where: { isActive: true },
            select: { email: true },
            orderBy: { id: "asc" },
            take: 1,
          },
        },
      },
      organizationClaim: {
        select: {
          claimantName: true,
          claimantEmail: true,
          status: true,
          reviewedAt: true,
          verificationTokenHash: true,
          verificationTokenCiphertext: true,
          expiresAt: true,
        },
      },
    },
  });
}

async function auditAttempt(input: {
  outboxId: string;
  incidentId: string | null;
  municipalityId: string | null;
  organizationId: string | null;
  action: string;
  attempt: number;
  status: string;
}) {
  await prisma.auditLog.create({
    data: {
      incidentId: input.incidentId,
      municipalityId: input.municipalityId,
      action: input.action,
      entityType: "NotificationOutbox",
      entityId: input.outboxId,
      metadata: json({
        organizationId: input.organizationId,
        attempt: input.attempt,
        status: input.status,
        containsRecipient: false,
      }),
    },
  });
}

export async function processNotificationOutbox(
  options: ProcessOptions = {},
): Promise<NotificationOutboxResult> {
  const config = getEmergencyAutomationConfig();
  const deliveryEnabled = options.deliveryEnabled ?? config.deliveryEnabled;
  const drillMode = options.drillMode ?? config.drillMode;
  if (!deliveryEnabled) return emptyResult("disabled");
  if (!drillMode && !options.provider) {
    throw new Error("NOTIFICATION_PROVIDER_REQUIRED");
  }

  const now = options.now ?? new Date();
  const limit = Math.max(
    1,
    Math.min(options.limit ?? config.maximumBatchSize, 1_000),
  );
  await prisma.notificationOutbox.updateMany({
    where: {
      status: NotificationOutboxStatus.PROCESSING,
      lockedAt: {
        lte: new Date(now.getTime() - STALE_PROCESSING_MINUTES * 60_000),
      },
    },
    data: {
      status: NotificationOutboxStatus.FAILED,
      lockedAt: null,
      lastError: "processing-lock-expired",
      notBefore: now,
    },
  });
  const eligible = await prisma.notificationOutbox.findMany({
    where: {
      status: {
        in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.FAILED],
      },
      notBefore: { lte: now },
      attempts: { lt: prisma.notificationOutbox.fields.maxAttempts },
    },
    select: { id: true },
    orderBy: [{ notBefore: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  const result = emptyResult(drillMode ? "drill" : "completed");

  for (const candidate of eligible) {
    const claimed = await prisma.notificationOutbox.updateMany({
      where: {
        id: candidate.id,
        status: {
          in: [
            NotificationOutboxStatus.PENDING,
            NotificationOutboxStatus.FAILED,
          ],
        },
        notBefore: { lte: now },
        attempts: { lt: prisma.notificationOutbox.fields.maxAttempts },
      },
      data: {
        status: NotificationOutboxStatus.PROCESSING,
        attempts: { increment: 1 },
        lockedAt: now,
        lastError: null,
      },
    });
    if (claimed.count !== 1) continue;
    result.selected += 1;
    const outbox = await loadClaimedOutbox(candidate.id);
    if (!outbox) continue;

    if (drillMode) {
      await prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: {
          status: NotificationOutboxStatus.DISCARDED,
          discardedAt: now,
          lockedAt: null,
          lastError: "drill-mode-no-delivery",
        },
      });
      await auditAttempt({
        outboxId: outbox.id,
        incidentId: outbox.incidentId,
        municipalityId: outbox.municipalityId,
        organizationId: outbox.organizationId,
        action: "notification.delivery_drill_discarded",
        attempt: outbox.attempts,
        status: "discarded",
      });
      result.discarded += 1;
      continue;
    }

    const message = await resolveMessage(outbox, now);
    if (!message) {
      await prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: {
          status: NotificationOutboxStatus.DISCARDED,
          discardedAt: now,
          lockedAt: null,
          lastError: "recipient-or-template-unavailable",
        },
      });
      await auditAttempt({
        outboxId: outbox.id,
        incidentId: outbox.incidentId,
        municipalityId: outbox.municipalityId,
        organizationId: outbox.organizationId,
        action: "notification.delivery_discarded",
        attempt: outbox.attempts,
        status: "discarded",
      });
      result.discarded += 1;
      continue;
    }

    try {
      await options.provider!.send(message);
      await prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: {
          status: NotificationOutboxStatus.SENT,
          sentAt: now,
          lockedAt: null,
          lastError: null,
        },
      });
      await auditAttempt({
        outboxId: outbox.id,
        incidentId: outbox.incidentId,
        municipalityId: outbox.municipalityId,
        organizationId: outbox.organizationId,
        action: "notification.delivery_sent",
        attempt: outbox.attempts,
        status: "sent",
      });
      result.sent += 1;
    } catch {
      const exhausted = outbox.attempts >= outbox.maxAttempts;
      await prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: exhausted
          ? {
              status: NotificationOutboxStatus.DISCARDED,
              discardedAt: now,
              lockedAt: null,
              lastError: "provider-error-max-attempts",
            }
          : {
              status: NotificationOutboxStatus.FAILED,
              notBefore: retryAt(now, outbox.attempts),
              lockedAt: null,
              lastError: "provider-error",
            },
      });
      await auditAttempt({
        outboxId: outbox.id,
        incidentId: outbox.incidentId,
        municipalityId: outbox.municipalityId,
        organizationId: outbox.organizationId,
        action: exhausted
          ? "notification.delivery_exhausted"
          : "notification.delivery_failed",
        attempt: outbox.attempts,
        status: exhausted ? "discarded" : "failed",
      });
      if (exhausted) result.discarded += 1;
      else result.failed += 1;
    }
  }
  return result;
}
