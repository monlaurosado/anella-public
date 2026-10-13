import "server-only";

import { createHash, createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { z } from "zod";

import {
  getContributionAntiAutomationConfig,
  getIdempotencySecret,
  getPrivacyConfig,
} from "@/config/env";
import { Prisma } from "@/generated/prisma/client";
import {
  ContributionCategory,
  ContributionOrigin,
  ContributionStatus,
  NeedStatus,
  NeedType,
} from "@/generated/prisma/enums";
import { getClientIp } from "@/lib/client-ip";
import { prisma } from "@/lib/db";
import { isIncidentPubliclyEligible } from "@/lib/public-incident-eligibility";
import { runWholeTransactionWithRetry } from "@/lib/retryable-transaction-error";
import { logServerError } from "@/lib/safe-error";
import { TimeZoneError, zonedDateTimeLocalToUtc } from "@/lib/time-zone";
import { consumeRateLimit } from "@/services/rate-limit";
import {
  CONTRIBUTION_ACCESS_COOKIE_MAX_AGE,
  getContributionAccessCookieName,
  getContributionAccessCookiePath,
  LAST_CONTRIBUTION_COOKIE_NAME,
} from "@/services/contributions";

const optionalEmail = z.preprocess(
  (value) =>
    value === null || (typeof value === "string" && value.trim() === "")
      ? undefined
      : value,
  z.email().optional(),
);

const citizenPhoneSchema = z
  .string()
  .trim()
  .regex(/^[+0-9() .-]{6,30}$/, "Indica un teléfono válido")
  .transform((value) => value.replace(/[() .-]/g, ""))
  .refine(
    (value) => /^\+?[0-9]{6,15}$/.test(value),
    "Indica un teléfono válido con entre 6 y 15 cifras",
  )
  .optional();

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.string().trim().max(maximum).optional(),
  );

const optionalQuantity = z.preprocess(
  (value) =>
    value === null || (typeof value === "string" && value.trim() === "")
      ? 1
      : value,
  z.coerce.number().int().positive("La cantidad debe ser positiva").default(1),
);

const contributionSchema = z
  .object({
    idempotencyKey: z.uuid(),
    incidentId: optionalText(191),
    safePointId: optionalText(191),
    needId: optionalText(191),
    category: z.enum(ContributionCategory).default(ContributionCategory.OTHER),
    description: optionalText(500),
    unit: optionalText(32),
    citizenName: z.preprocess(
      (value) =>
        value === null || (typeof value === "string" && value.trim() === "")
          ? undefined
          : value,
      z.string().trim().min(2, "Indica un nombre válido").max(120).optional(),
    ),
    citizenPhone: z.preprocess(
      (value) =>
        value === null || (typeof value === "string" && value.trim() === "")
          ? undefined
          : value,
      citizenPhoneSchema,
    ),
    citizenEmail: optionalEmail,
    quantity: optionalQuantity,
    eta: optionalText(32),
    etaOccurrence: z.enum(["reject", "earlier", "later"]).default("reject"),
    notes: optionalText(500),
    privacyConsent: z.boolean().default(false),
    followUpConsent: z.boolean().default(false),
    companyWebsite: optionalText(200),
  })
  .superRefine((value, context) => {
    if (!value.needId && (!value.incidentId || !value.safePointId)) {
      context.addIssue({
        code: "custom",
        message: "Selecciona un punto de entrega activo.",
      });
    }
    if (!value.needId && !value.description) {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "Describe brevemente qué puedes aportar.",
      });
    }
    const hasPersonalData = Boolean(
      value.citizenName || value.citizenPhone || value.citizenEmail,
    );
    if (hasPersonalData && !value.privacyConsent) {
      context.addIssue({
        code: "custom",
        path: ["privacyConsent"],
        message: "Acepta el tratamiento de los datos de contacto facilitados.",
      });
    }
    if (value.followUpConsent && !value.citizenEmail) {
      context.addIssue({
        code: "custom",
        path: ["followUpConsent"],
        message: "Indica un email para recibir el agradecimiento posterior.",
      });
    }
  });

export type ContributionFormState = {
  ok: boolean;
  message: string;
  publicCode?: string;
  cancelToken?: string;
};

const outstandingStatuses = [
  ContributionStatus.PLEDGED,
  ContributionStatus.EN_ROUTE,
  ContributionStatus.PARTIALLY_DELIVERED,
];
class ContributionActionError extends Error {}

function contributionCategoryForNeed(type: NeedType): ContributionCategory {
  switch (type) {
    case NeedType.WATER:
      return ContributionCategory.WATER;
    case NeedType.FOOD:
      return ContributionCategory.FOOD;
    case NeedType.MEDICAL_SUPPLIES:
      return ContributionCategory.MEDICAL_SUPPLIES;
    case NeedType.TOOLS:
      return ContributionCategory.TOOLS;
    case NeedType.TRANSPORT:
      return ContributionCategory.TRANSPORT;
    case NeedType.SHELTER:
      return ContributionCategory.ACCOMMODATION;
    default:
      return ContributionCategory.OTHER;
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function contributionFingerprint(idempotencyKey: string) {
  return idempotencyKey;
}

function contributionPayloadFingerprint(input: {
  incidentId?: string;
  safePointId?: string;
  needId?: string;
  category: ContributionCategory;
  description?: string;
  unit?: string;
  citizenName?: string;
  normalizedPhone?: string;
  citizenEmail?: string;
  quantity: number;
  eta?: string;
  etaOccurrence: "reject" | "earlier" | "later";
  notes?: string;
  followUpConsent: boolean;
}) {
  return createHmac("sha256", getIdempotencySecret())
    .update(
      JSON.stringify({
        ...input,
        citizenEmail: input.citizenEmail?.toLowerCase(),
      }),
    )
    .digest("hex");
}

function createPrivateIdentifiers(fingerprint: string) {
  const secret = getIdempotencySecret();
  const publicCode = `AN-${createHmac("sha256", secret)
    .update(`code:${fingerprint}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase()}`;
  const cancelToken = createHmac("sha256", secret)
    .update(`access:${fingerprint}`)
    .digest("base64url");
  return { publicCode, cancelToken };
}

async function rememberContributionAccess(
  publicCode: string,
  cancelToken: string,
) {
  const cookieStore = await cookies();
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: getContributionAccessCookiePath(),
    maxAge: CONTRIBUTION_ACCESS_COOKIE_MAX_AGE,
    priority: "high" as const,
  };

  cookieStore.set({
    ...options,
    name: getContributionAccessCookieName(publicCode),
    value: cancelToken,
  });
  cookieStore.set({
    ...options,
    name: LAST_CONTRIBUTION_COOKIE_NAME,
    value: publicCode,
  });
}

async function serializableWithRetry<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  return runWholeTransactionWithRetry(() =>
    prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }),
  );
}

export async function pledgeContribution(
  _state: ContributionFormState,
  formData: FormData,
): Promise<ContributionFormState> {
  const parsed = contributionSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    incidentId: formData.get("incidentId"),
    safePointId: formData.get("safePointId"),
    needId: formData.get("needId"),
    category:
      String(formData.get("category") ?? "OTHER").toUpperCase() || "OTHER",
    description: formData.get("description"),
    unit: formData.get("unit"),
    citizenName: formData.get("citizenName"),
    citizenPhone: formData.get("citizenPhone"),
    citizenEmail: formData.get("citizenEmail"),
    quantity: formData.get("quantity"),
    eta: formData.get("eta"),
    etaOccurrence: formData.get("etaOccurrence") || "reject",
    notes: formData.get("notes") || undefined,
    privacyConsent: formData.has("privacyConsent"),
    followUpConsent: formData.has("followUpConsent"),
    companyWebsite: formData.get("companyWebsite"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Revisa los datos.",
    };
  }

  if (
    getContributionAntiAutomationConfig().mode === "honeypot" &&
    parsed.data.companyWebsite
  ) {
    return {
      ok: false,
      message: "No se ha podido registrar la aportación.",
    };
  }

  const requestHeaders = await headers();
  const requestIp = getClientIp(requestHeaders);
  const normalizedPhone = parsed.data.citizenPhone;
  const payloadFingerprint = contributionPayloadFingerprint({
    incidentId: parsed.data.incidentId,
    safePointId: parsed.data.safePointId,
    needId: parsed.data.needId,
    category: parsed.data.category,
    description: parsed.data.description,
    unit: parsed.data.unit,
    citizenName: parsed.data.citizenName,
    normalizedPhone,
    citizenEmail: parsed.data.citizenEmail,
    quantity: parsed.data.quantity,
    eta: parsed.data.eta,
    etaOccurrence: parsed.data.etaOccurrence,
    notes: parsed.data.notes,
    followUpConsent: parsed.data.followUpConsent,
  });
  const ipAllowed = await consumeRateLimit({
    action: "pledge-contribution-ip",
    identity: requestIp,
    limit: 20,
    windowMinutes: 10,
  });

  // Stop at the bounded IP bucket before deriving per-need or per-phone
  // entries. Otherwise an attacker behind a blocked IP can grow the throttle
  // table by rotating those finer identifiers.
  if (!ipAllowed) {
    return {
      ok: false,
      message:
        "Se han realizado demasiados intentos. Prueba de nuevo más tarde.",
    };
  }

  const targetIdentity = parsed.data.needId ?? parsed.data.safePointId!;
  const [targetAllowed, identityAllowed] = await Promise.all([
    consumeRateLimit({
      action: "pledge-contribution-ip-need",
      identity: `${requestIp}:${targetIdentity}`,
      limit: 5,
      windowMinutes: 10,
    }),
    consumeRateLimit({
      action: "pledge-contribution-identity",
      identity: `${requestIp}:${normalizedPhone ?? `anonymous:${parsed.data.category}`}`,
      limit: 5,
      windowMinutes: 10,
    }),
  ]);

  if (!targetAllowed || !identityAllowed) {
    return {
      ok: false,
      message:
        "Se han realizado demasiados intentos. Prueba de nuevo más tarde.",
    };
  }

  const { cancelToken, publicCode } = createPrivateIdentifiers(
    contributionFingerprint(parsed.data.idempotencyKey),
  );
  try {
    await serializableWithRetry(async (transaction) => {
      const need = parsed.data.needId
        ? await transaction.need.findUnique({
            where: { id: parsed.data.needId },
            include: { incident: true, safePoint: true },
          })
        : null;
      const directPoint =
        !need && parsed.data.incidentId && parsed.data.safePointId
          ? await transaction.safePoint.findFirst({
              where: {
                id: parsed.data.safePointId,
                incidentId: parsed.data.incidentId,
              },
              include: { incident: true },
            })
          : null;

      if (
        parsed.data.needId &&
        (!need ||
          need.status !== NeedStatus.ACTIVE ||
          need.safePoint.incidentId !== need.incidentId ||
          (need.safePoint.municipalityId !== null &&
            need.incident.municipalityId !== null &&
            need.safePoint.municipalityId !== need.incident.municipalityId) ||
          !need.safePoint.isActive ||
          !need.safePoint.validatedAt ||
          !need.safePoint.validatedById ||
          !isIncidentPubliclyEligible(need.incident) ||
          !need.validatedAt ||
          !need.validatedById ||
          !need.publishedAt ||
          (need.deadline !== null && need.deadline <= new Date()))
      ) {
        throw new ContributionActionError(
          "Esta necesidad ya no admite aportaciones.",
        );
      }
      if (
        !need &&
        (!directPoint ||
          !directPoint.isActive ||
          directPoint.pointStatus !== "ACTIVE" ||
          !directPoint.publishedAt ||
          !directPoint.validatedAt ||
          !directPoint.validatedById ||
          !isIncidentPubliclyEligible(directPoint.incident))
      ) {
        throw new ContributionActionError(
          "Este punto de entrega ya no admite aportaciones.",
        );
      }

      const incident = need?.incident ?? directPoint!.incident;
      const safePoint = need?.safePoint ?? directPoint!;

      if (need) {
        const commitments = await transaction.contribution.aggregate({
          where: { needId: need.id, status: { in: outstandingStatuses } },
          _sum: { quantity: true, deliveredQuantity: true },
        });
        const committed = Math.max(
          0,
          Number(commitments._sum.quantity ?? 0) -
            Number(commitments._sum.deliveredQuantity ?? 0),
        );
        const remaining = Math.max(
          0,
          need.quantityNeeded - need.quantityReceived - committed,
        );
        if (remaining === 0) {
          throw new ContributionActionError(
            "La cantidad necesaria ya está comprometida. Gracias por ayudar.",
          );
        }
        if (parsed.data.quantity > remaining) {
          throw new ContributionActionError(
            `Ahora mismo solo faltan ${remaining} ${need.unit}.`,
          );
        }
      }

      let eta: Date | null = null;
      if (parsed.data.eta) {
        try {
          eta = zonedDateTimeLocalToUtc(parsed.data.eta, incident.timeZone, {
            disambiguation: parsed.data.etaOccurrence,
          });
        } catch (error) {
          if (error instanceof TimeZoneError) {
            throw new ContributionActionError(error.message);
          }
          throw error;
        }
        if (eta <= new Date()) {
          throw new ContributionActionError(
            "La llegada estimada debe ser futura.",
          );
        }
        if (need?.deadline && eta > need.deadline) {
          throw new ContributionActionError(
            "La llegada estimada debe ser anterior a la fecha límite.",
          );
        }
      }

      const now = new Date();
      const hasPersonalData = Boolean(
        parsed.data.citizenName || normalizedPhone || parsed.data.citizenEmail,
      );
      const retentionDays = getPrivacyConfig().retentionDays;
      const contribution = await transaction.contribution.create({
        data: {
          publicCode,
          cancelTokenHash: hashToken(cancelToken),
          incidentId: incident.id,
          needId: need?.id ?? null,
          safePointId: safePoint.id,
          category: need
            ? contributionCategoryForNeed(need.type)
            : parsed.data.category,
          origin: ContributionOrigin.PUBLIC_ANONYMOUS,
          description:
            parsed.data.description ?? need?.title ?? "Aportación ciudadana",
          unit: parsed.data.unit ?? need?.unit ?? "aportación",
          citizenName: parsed.data.citizenName ?? "Anónimo",
          citizenPhone: normalizedPhone,
          citizenEmail: parsed.data.citizenEmail?.toLowerCase(),
          quantity: parsed.data.quantity,
          eta,
          notes: parsed.data.notes || null,
          consentAt: now,
          personalDataConsentAt: hasPersonalData ? now : null,
          followUpConsentAt: parsed.data.followUpConsent ? now : null,
          piiExpiresAt: hasPersonalData
            ? new Date(now.getTime() + retentionDays * 86_400_000)
            : null,
        },
      });

      await transaction.incident.update({
        where: { id: incident.id },
        data: { lastActivityAt: now },
      });
      await transaction.auditLog.create({
        data: {
          incidentId: incident.id,
          municipalityId: incident.municipalityId,
          action: "contribution.pledged_by_citizen",
          entityType: "Contribution",
          entityId: contribution.id,
          metadata: {
            publicCode,
            needId: need?.id ?? null,
            safePointId: safePoint.id,
            category: contribution.category,
            direct: need === null,
            quantity: parsed.data.quantity,
            unit: contribution.unit,
            etaProvided: eta !== null,
            idempotencyFingerprint: payloadFingerprint,
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof ContributionActionError) {
      return { ok: false, message: error.message };
    }

    const duplicate =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002";
    if (duplicate) {
      const existing = await prisma.contribution.findUnique({
        where: { publicCode },
        select: {
          id: true,
          incidentId: true,
          needId: true,
          safePointId: true,
          cancelTokenHash: true,
        },
      });
      const audit = existing
        ? await prisma.auditLog.findFirst({
            where: {
              action: "contribution.pledged_by_citizen",
              entityType: "Contribution",
              entityId: existing.id,
            },
            select: { metadata: true },
          })
        : null;
      const auditMetadata = audit?.metadata;
      const samePayload = Boolean(
        auditMetadata &&
        typeof auditMetadata === "object" &&
        !Array.isArray(auditMetadata) &&
        (auditMetadata as Record<string, unknown>).idempotencyFingerprint ===
          payloadFingerprint,
      );
      if (
        existing &&
        existing.needId === parsed.data.needId &&
        (!parsed.data.incidentId ||
          existing.incidentId === parsed.data.incidentId) &&
        (!parsed.data.safePointId ||
          existing.safePointId === parsed.data.safePointId) &&
        existing.cancelTokenHash === hashToken(cancelToken) &&
        samePayload
      ) {
        await rememberContributionAccess(publicCode, cancelToken);
        return {
          ok: true,
          message: "La aportación ya estaba registrada.",
          publicCode,
          cancelToken,
        };
      }
      if (existing) {
        return {
          ok: false,
          message:
            "Este envío ya se utilizó con otros datos. Recarga el formulario antes de intentarlo de nuevo.",
        };
      }
    }

    logServerError("Contribution creation failed", error);
    return {
      ok: false,
      message: "No se ha podido registrar la aportación. Inténtalo de nuevo.",
    };
  }

  // Persist private recovery before returning to the public Server Action.
  // That action expires the aggregate public projection synchronously before
  // it redirects to the authoritative private status page.
  await rememberContributionAccess(publicCode, cancelToken);
  return {
    ok: true,
    message:
      "Aportación registrada. Conserva el código para consultar o cancelar.",
    publicCode,
    cancelToken,
  };
}
