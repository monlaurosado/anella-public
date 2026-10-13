import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getIdempotencySecret } from "@/config/env";
import {
  ContributionStatus,
  IncidentStatus,
  NeedStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { isIncidentPubliclyEligible } from "@/lib/public-incident-eligibility";

const cancellableStatuses: ContributionStatus[] = [
  ContributionStatus.PLEDGED,
  ContributionStatus.EN_ROUTE,
];
const activeDeliveryStatuses: ContributionStatus[] = [
  ContributionStatus.PLEDGED,
  ContributionStatus.EN_ROUTE,
  ContributionStatus.PARTIALLY_DELIVERED,
];
export const CONTRIBUTION_ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
export const LAST_CONTRIBUTION_COOKIE_NAME = "__Host-anella-ultima-aportacion";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function valuesMatch(actualValue: string, expectedValue: string) {
  const actual = Buffer.from(actualValue, "utf8");
  const expected = Buffer.from(expectedValue, "utf8");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function primaryTokenMatches(token: string, tokenHash: string | null) {
  if (!tokenHash || token.length < 32 || token.length > 128) {
    return false;
  }

  return valuesMatch(hashToken(token), tokenHash);
}

function createPortableAccessToken(
  publicCode: string,
  tokenHash: string,
  now: Date,
) {
  const expiresAt =
    Math.floor(now.getTime() / 1_000) + CONTRIBUTION_ACCESS_COOKIE_MAX_AGE;
  const encodedExpiry = expiresAt.toString(36);
  const signature = createHmac("sha256", getIdempotencySecret())
    .update(`contribution-access:${publicCode}:${encodedExpiry}:${tokenHash}`)
    .digest("base64url");

  return `v1.${encodedExpiry}.${signature}`;
}

function portableAccessTokenExpiresAt(
  publicCode: string,
  token: string,
  tokenHash: string | null,
  now: Date,
) {
  if (!tokenHash) return null;

  const match = /^v1\.([0-9a-z]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;

  const [, encodedExpiry, signature] = match;
  const expiresAt = Number.parseInt(encodedExpiry, 36);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(now.getTime() / 1_000)
  ) {
    return null;
  }

  const expectedSignature = createHmac("sha256", getIdempotencySecret())
    .update(`contribution-access:${publicCode}:${encodedExpiry}:${tokenHash}`)
    .digest("base64url");

  return valuesMatch(signature, expectedSignature) ? expiresAt : null;
}

function accessTokenMaxAge(
  publicCode: string,
  token: string,
  tokenHash: string | null,
  now: Date,
) {
  if (primaryTokenMatches(token, tokenHash)) {
    return CONTRIBUTION_ACCESS_COOKIE_MAX_AGE;
  }

  const expiresAt = portableAccessTokenExpiresAt(
    publicCode,
    token,
    tokenHash,
    now,
  );
  if (!expiresAt) return null;

  return Math.min(
    CONTRIBUTION_ACCESS_COOKIE_MAX_AGE,
    expiresAt - Math.floor(now.getTime() / 1_000),
  );
}

function accessTokenMatches(
  publicCode: string,
  token: string,
  tokenHash: string | null,
  now: Date,
) {
  return accessTokenMaxAge(publicCode, token, tokenHash, now) !== null;
}

export async function createContributionPrivateLinkToken(
  publicCode: string,
  currentToken: string,
  now = new Date(),
) {
  const contribution = await prisma.contribution.findUnique({
    where: { publicCode },
    select: { cancelTokenHash: true },
  });

  if (!contribution?.cancelTokenHash) {
    return null;
  }

  if (primaryTokenMatches(currentToken, contribution.cancelTokenHash)) {
    return createPortableAccessToken(
      publicCode,
      contribution.cancelTokenHash,
      now,
    );
  }

  return portableAccessTokenExpiresAt(
    publicCode,
    currentToken,
    contribution.cancelTokenHash,
    now,
  )
    ? currentToken
    : null;
}

export function getContributionAccessCookieName(publicCode: string) {
  const codeHash = hashToken(`contribution:${publicCode}`).slice(0, 24);
  return `__Host-anella-aportacion-${codeHash}`;
}

export function getContributionAccessCookiePath() {
  return "/";
}

export async function verifyContributionAccess(
  publicCode: string,
  token: string,
  now = new Date(),
) {
  const contribution = await prisma.contribution.findUnique({
    where: { publicCode },
    select: { cancelTokenHash: true },
  });

  return Boolean(
    contribution &&
    accessTokenMaxAge(publicCode, token, contribution.cancelTokenHash, now) !==
      null,
  );
}

export async function authorizeContributionLinkExchange(
  publicCode: string,
  token: string,
  now = new Date(),
) {
  const contribution = await prisma.contribution.findUnique({
    where: { publicCode },
    select: { cancelTokenHash: true },
  });
  if (!contribution) return null;

  const expiresAt = portableAccessTokenExpiresAt(
    publicCode,
    token,
    contribution.cancelTokenHash,
    now,
  );
  if (!expiresAt) return null;

  return {
    maxAge: Math.min(
      CONTRIBUTION_ACCESS_COOKIE_MAX_AGE,
      expiresAt - Math.floor(now.getTime() / 1_000),
    ),
  };
}

export async function cancelContributionByToken(
  publicCode: string,
  token: string,
) {
  const contribution = await prisma.contribution.findUnique({
    where: { publicCode },
    select: {
      id: true,
      publicCode: true,
      cancelTokenHash: true,
      status: true,
      deliveredQuantity: true,
      incidentId: true,
      incident: { select: { municipalityId: true } },
      need: {
        select: { incident: { select: { municipalityId: true } } },
      },
    },
  });

  if (
    !contribution ||
    !accessTokenMatches(
      publicCode,
      token,
      contribution.cancelTokenHash,
      new Date(),
    )
  ) {
    return { ok: false, message: "No se ha encontrado la aportación." };
  }

  if (
    !cancellableStatuses.includes(contribution.status) ||
    contribution.deliveredQuantity !== 0
  ) {
    return {
      ok: false,
      message: "Esta aportación ya no puede cancelarse desde la web.",
    };
  }

  const cancelledAt = new Date();
  const cancelled = await prisma.$transaction(async (transaction) => {
    const result = await transaction.contribution.updateMany({
      where: {
        id: contribution.id,
        cancelTokenHash: contribution.cancelTokenHash,
        status: { in: cancellableStatuses },
        deliveredQuantity: 0,
      },
      data: {
        status: ContributionStatus.CANCELLED,
        statusReason: "Cancelada por la persona aportante",
        cancelledAt,
        revision: { increment: 1 },
      },
    });

    if (result.count === 1) {
      await transaction.incident.update({
        where: { id: contribution.incidentId },
        data: { lastActivityAt: cancelledAt },
      });
      await transaction.auditLog.create({
        data: {
          incidentId: contribution.incidentId,
          municipalityId:
            contribution.incident?.municipalityId ??
            contribution.need?.incident.municipalityId ??
            null,
          action: "CONTRIBUTION_CANCELLED_BY_CITIZEN",
          entityType: "Contribution",
          entityId: contribution.id,
          metadata: {
            publicCode: contribution.publicCode,
            previousStatus: contribution.status,
            status: ContributionStatus.CANCELLED,
            reason: "Cancelada por la persona aportante",
          },
        },
      });
    }

    return result;
  });

  return cancelled.count === 1
    ? {
        ok: true,
        message: "La aportación se ha cancelado correctamente.",
      }
    : {
        ok: false,
        message: "La aportación ha cambiado y ya no puede cancelarse.",
      };
}

type DeliveryNotice = {
  canProceed: boolean;
  tone: "safe" | "blocked" | "complete";
  message: string;
};

function getDeliveryNotice(
  contribution: {
    status: ContributionStatus;
    quantity: number;
    deliveredQuantity: number;
    safePointId: string | null;
    incidentId: string;
    safePoint: {
      id: string;
      incidentId: string;
      isActive: boolean;
      validatedAt: Date | null;
      validatedById: string | null;
      pointStatus: "DRAFT" | "ACTIVE" | "PAUSED" | "CLOSED";
      publishedAt: Date | null;
    } | null;
    need: {
      incidentId: string;
      safePointId: string;
      status: NeedStatus;
      deadline: Date | null;
      validatedAt: Date | null;
      validatedById: string | null;
      publishedAt: Date | null;
      safePoint: {
        id: string;
        incidentId: string;
        isActive: boolean;
        validatedAt: Date | null;
        validatedById: string | null;
      };
      incident: {
        status: IncidentStatus;
        verifiedAt: Date | null;
        verifiedById: string | null;
        publicLocationApprovedAt: Date | null;
        publicLocationApprovedById: string | null;
      };
    } | null;
    incident: {
      status: IncidentStatus;
      verifiedAt: Date | null;
      verifiedById: string | null;
      publicLocationApprovedAt: Date | null;
      publicLocationApprovedById: string | null;
    };
  },
  now: Date,
): DeliveryNotice {
  const incident = contribution.incident ?? contribution.need?.incident;
  const incidentId = contribution.incidentId ?? contribution.need?.incidentId;
  if (contribution.status === ContributionStatus.CANCELLED) {
    return {
      canProceed: false,
      tone: "complete",
      message: "Esta aportación está cancelada. No te desplaces al punto.",
    };
  }

  if (contribution.status === ContributionStatus.DELIVERED) {
    return {
      canProceed: false,
      tone: "complete",
      message: "La entrega consta como completada. No es necesario volver.",
    };
  }

  if (contribution.status === ContributionStatus.NO_SHOW) {
    return {
      canProceed: false,
      tone: "blocked",
      message:
        "La aportación figura como no presentada. No te desplaces sin una nueva confirmación.",
    };
  }

  if (
    !activeDeliveryStatuses.includes(contribution.status) ||
    contribution.quantity <= 0 ||
    contribution.deliveredQuantity < 0 ||
    contribution.deliveredQuantity >= contribution.quantity
  ) {
    return {
      canProceed: false,
      tone: "blocked",
      message:
        "La entrega no está activa. No te desplaces sin confirmación del equipo coordinador.",
    };
  }

  if (!incident || !isIncidentPubliclyEligible(incident)) {
    return {
      canProceed: false,
      tone: "blocked",
      message:
        "El incidente ya no admite entregas. No te desplaces al punto ni a la zona de intervención.",
    };
  }

  if (
    contribution.need &&
    (contribution.need.status !== NeedStatus.ACTIVE ||
      !contribution.need.validatedAt ||
      !contribution.need.validatedById ||
      !contribution.need.publishedAt)
  ) {
    return {
      canProceed: false,
      tone: "blocked",
      message:
        "La necesidad ya no está disponible o está pendiente de validación. No te desplaces.",
    };
  }

  if (
    contribution.need &&
    contribution.need.deadline &&
    contribution.need.deadline.getTime() <= now.getTime()
  ) {
    return {
      canProceed: false,
      tone: "blocked",
      message:
        "El plazo de entrega ha finalizado. No te desplaces al punto ni a la zona de intervención.",
    };
  }

  if (
    !contribution.safePoint ||
    !contribution.safePointId ||
    contribution.safePoint.incidentId !== incidentId ||
    (contribution.need &&
      (contribution.safePointId !== contribution.need.safePointId ||
        contribution.safePoint.id !== contribution.need.safePoint.id ||
        contribution.need.incidentId !== incidentId ||
        contribution.need.safePoint.incidentId !== incidentId))
  ) {
    return {
      canProceed: false,
      tone: "blocked",
      message:
        "El punto de entrega ha cambiado. No te desplaces hasta recibir una nueva confirmación.",
    };
  }

  if (
    !contribution.safePoint.isActive ||
    (!contribution.need &&
      (contribution.safePoint.pointStatus !== "ACTIVE" ||
        !contribution.safePoint.publishedAt)) ||
    (contribution.need && !contribution.need.safePoint.isActive)
  ) {
    return {
      canProceed: false,
      tone: "blocked",
      message:
        "El punto de entrega está desactivado. No te desplaces; el equipo coordinador debe publicar otro destino.",
    };
  }

  if (
    !contribution.safePoint.validatedAt ||
    !contribution.safePoint.validatedById ||
    (contribution.need &&
      (!contribution.need.safePoint.validatedAt ||
        !contribution.need.safePoint.validatedById))
  ) {
    return {
      canProceed: false,
      tone: "blocked",
      message:
        "El punto de entrega está pendiente de validación humana. No te desplaces hasta recibir una nueva confirmación.",
    };
  }

  return {
    canProceed: true,
    tone: "safe",
    message:
      "Entrega únicamente en el punto de entrega indicado. No acudas a la zona de intervención.",
  };
}

export async function getContributionStatus(
  publicCode: string,
  token: string,
  now = new Date(),
) {
  const contribution = await prisma.contribution.findUnique({
    where: { publicCode },
    select: {
      publicCode: true,
      cancelTokenHash: true,
      status: true,
      quantity: true,
      incidentId: true,
      description: true,
      unit: true,
      deliveredQuantity: true,
      eta: true,
      createdAt: true,
      safePointId: true,
      safePoint: {
        select: {
          id: true,
          incidentId: true,
          name: true,
          address: true,
          isActive: true,
          pointStatus: true,
          publishedAt: true,
          validatedAt: true,
          validatedById: true,
        },
      },
      need: {
        select: {
          incidentId: true,
          safePointId: true,
          title: true,
          unit: true,
          status: true,
          deadline: true,
          validatedAt: true,
          validatedById: true,
          publishedAt: true,
          safePoint: {
            select: {
              id: true,
              incidentId: true,
              isActive: true,
              validatedAt: true,
              validatedById: true,
            },
          },
          incident: {
            select: {
              status: true,
              verifiedAt: true,
              verifiedById: true,
              publicLocationApprovedAt: true,
              publicLocationApprovedById: true,
              title: true,
              timeZone: true,
            },
          },
        },
      },
      incident: {
        select: {
          status: true,
          verifiedAt: true,
          verifiedById: true,
          publicLocationApprovedAt: true,
          publicLocationApprovedById: true,
          title: true,
          timeZone: true,
        },
      },
    },
  });

  if (
    !contribution ||
    !accessTokenMatches(publicCode, token, contribution.cancelTokenHash, now)
  ) {
    return null;
  }

  const deliveryNotice = getDeliveryNotice(contribution, now);
  const incident = contribution.incident ?? contribution.need?.incident;
  const incidentIsPublic = Boolean(
    incident && isIncidentPubliclyEligible(incident),
  );

  return {
    publicCode: contribution.publicCode,
    status: contribution.status,
    quantity: contribution.quantity,
    deliveredQuantity: contribution.deliveredQuantity,
    eta: contribution.eta?.toISOString(),
    createdAt: contribution.createdAt.toISOString(),
    needTitle:
      contribution.need?.title ??
      contribution.description ??
      "Aportación directa",
    unit: contribution.need?.unit ?? contribution.unit ?? "aportación",
    deadline: contribution.need?.deadline?.toISOString(),
    incidentId: contribution.incidentId ?? contribution.need?.incidentId,
    incidentTitle: incident?.title ?? "Emergencia",
    incidentTimeZone: incident?.timeZone ?? "Europe/Madrid",
    incidentIsPublic,
    safePointName: deliveryNotice.canProceed
      ? contribution.safePoint?.name
      : undefined,
    safePointAddress: deliveryNotice.canProceed
      ? contribution.safePoint?.address
      : undefined,
    deliveryNotice,
    canCancel:
      cancellableStatuses.includes(contribution.status) &&
      contribution.deliveredQuantity === 0,
  };
}
