import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { getIdempotencySecret, getPrivacyConfig } from "@/config/env";
import {
  NotificationKind,
  OrganizationClaimStatus,
  OrganizationVerificationStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { requireCoordinator } from "@/lib/dal";
import { prisma } from "@/lib/db";

const openClaimStatuses = [
  OrganizationClaimStatus.EMAIL_PENDING,
  OrganizationClaimStatus.PENDING_REVIEW,
];

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenEncryptionKey() {
  return createHash("sha256")
    .update(`organization-claim:${getIdempotencySecret()}`)
    .digest();
}

export function encryptOrganizationClaimToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptOrganizationClaimToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted)
    throw new Error("INVALID_CIPHERTEXT");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    tokenEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function emailDomain(email: string) {
  const domain = email.trim().toLowerCase().split("@").at(-1);
  if (
    !domain ||
    !/^[a-z0-9.-]+$/.test(domain) ||
    domain.startsWith(".") ||
    domain.endsWith(".")
  ) {
    throw new Error("INVALID_EMAIL_DOMAIN");
  }
  return domain;
}

export async function listClaimableOrganizations() {
  const organizations = await prisma.organization.findMany({
    where: {
      verificationStatus: { not: OrganizationVerificationStatus.SUSPENDED },
    },
    select: {
      id: true,
      name: true,
      kind: true,
      verificationStatus: true,
      municipality: { select: { name: true, province: true } },
    },
    orderBy: [{ municipality: { name: "asc" } }, { name: "asc" }],
    take: 2_000,
  });
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    kind: organization.kind,
    verificationStatus: organization.verificationStatus,
    municipalityName:
      organization.municipality?.name ?? "Ámbito supramunicipal",
    province: organization.municipality?.province ?? undefined,
  }));
}

export async function createOrganizationClaim(input: {
  organizationId: string;
  claimantName: string;
  claimantEmail: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const normalizedEmail = input.claimantEmail.trim().toLowerCase();
  const domain = emailDomain(normalizedEmail);
  const token = randomBytes(32).toString("base64url");
  const retentionDays = getPrivacyConfig().retentionDays;

  return prisma.$transaction(async (transaction) => {
    const organization = await transaction.organization.findFirst({
      where: {
        id: input.organizationId,
        verificationStatus: { not: OrganizationVerificationStatus.SUSPENDED },
      },
      select: { id: true, name: true, municipalityId: true },
    });
    if (!organization) throw new Error("ORGANIZATION_NOT_CLAIMABLE");
    const duplicate = await transaction.organizationClaim.findFirst({
      where: {
        organizationId: organization.id,
        claimantEmail: normalizedEmail,
        status: { in: openClaimStatuses },
      },
      select: { id: true },
    });
    if (duplicate) throw new Error("CLAIM_ALREADY_OPEN");
    const allowedDomain = await transaction.organizationDomain.findUnique({
      where: { domain },
      select: { organizationId: true, isVerified: true },
    });

    const claim = await transaction.organizationClaim.create({
      data: {
        organizationId: organization.id,
        municipalityId: organization.municipalityId,
        claimantName: input.claimantName.trim(),
        claimantEmail: normalizedEmail,
        emailDomain: domain,
        verificationTokenHash: hashToken(token),
        verificationTokenCiphertext: encryptOrganizationClaimToken(token),
        expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1_000),
        piiExpiresAt: new Date(now.getTime() + retentionDays * 86_400_000),
      },
    });
    await transaction.notificationOutbox.create({
      data: {
        idempotencyKey: `organization-claim-verification:${claim.id}`,
        kind: NotificationKind.ORGANIZATION_CLAIM_VERIFICATION,
        organizationId: organization.id,
        organizationClaimId: claim.id,
        municipalityId: organization.municipalityId,
        templateKey: "organization-claim-verification-v1",
        payload: { claimId: claim.id },
      },
    });
    await transaction.auditLog.create({
      data: {
        municipalityId: organization.municipalityId,
        action: "organization_claim.requested",
        entityType: "OrganizationClaim",
        entityId: claim.id,
        metadata: {
          organizationId: organization.id,
          institutionalDomainMatched: Boolean(
            allowedDomain?.isVerified &&
            allowedDomain.organizationId === organization.id,
          ),
        },
      },
    });
    return { claimId: claim.id, verificationToken: token };
  });
}

export async function verifyOrganizationClaimToken(
  token: string,
  now = new Date(),
) {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return { ok: false as const };
  return prisma.$transaction(async (transaction) => {
    const claim = await transaction.organizationClaim.findUnique({
      where: { verificationTokenHash: hashToken(token) },
      include: { organization: { select: { id: true } } },
    });
    if (
      !claim ||
      claim.status !== OrganizationClaimStatus.EMAIL_PENDING ||
      claim.expiresAt <= now
    ) {
      if (claim?.status === OrganizationClaimStatus.EMAIL_PENDING) {
        await transaction.organizationClaim.update({
          where: { id: claim.id },
          data: {
            status: OrganizationClaimStatus.EXPIRED,
            verificationTokenHash: null,
            verificationTokenCiphertext: null,
          },
        });
      }
      return { ok: false as const };
    }
    const domain = await transaction.organizationDomain.findUnique({
      where: { domain: claim.emailDomain },
      select: { organizationId: true, isVerified: true },
    });
    const institutionalDomainMatched = Boolean(
      domain?.isVerified && domain.organizationId === claim.organizationId,
    );
    await transaction.organizationClaim.update({
      where: { id: claim.id },
      data: {
        status: OrganizationClaimStatus.PENDING_REVIEW,
        emailVerifiedAt: now,
        verificationTokenHash: null,
        verificationTokenCiphertext: null,
      },
    });
    await transaction.auditLog.create({
      data: {
        municipalityId: claim.municipalityId,
        action: "organization_claim.email_verified",
        entityType: "OrganizationClaim",
        entityId: claim.id,
        metadata: {
          organizationId: claim.organizationId,
          institutionalDomainMatched,
        },
      },
    });
    return { ok: true as const, institutionalDomainMatched };
  });
}

export async function decideOrganizationClaim(input: {
  claimId: string;
  reviewerId: string;
  decision: "approve" | "reject";
  reason: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const reviewer = await transaction.user.findFirst({
      where: {
        id: input.reviewerId,
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
      select: { id: true },
    });
    if (!reviewer) throw new Error("FORBIDDEN");
    const claim = await transaction.organizationClaim.findFirst({
      where: {
        id: input.claimId,
        status: OrganizationClaimStatus.PENDING_REVIEW,
      },
      include: { organization: true },
    });
    if (!claim || !claim.emailVerifiedAt)
      throw new Error("CLAIM_NOT_REVIEWABLE");

    if (input.decision === "approve") {
      const existing = await transaction.user.findUnique({
        where: { email: claim.claimantEmail },
      });
      if (
        existing &&
        existing.organizationId &&
        existing.organizationId !== claim.organizationId
      ) {
        throw new Error("ACCOUNT_SCOPE_CONFLICT");
      }
      if (existing?.role === UserRole.SUPER_ADMIN)
        throw new Error("ACCOUNT_SCOPE_CONFLICT");
      if (existing) {
        await transaction.user.update({
          where: { id: existing.id },
          data: {
            name: claim.claimantName,
            emailVerified: claim.emailVerifiedAt,
            role: UserRole.COORDINATOR,
            organizationId: claim.organizationId,
            municipalityId: claim.municipalityId,
            isActive: false,
            mustChangePassword: true,
            sessionVersion: { increment: 1 },
          },
        });
      } else {
        await transaction.user.create({
          data: {
            name: claim.claimantName,
            email: claim.claimantEmail,
            emailVerified: claim.emailVerifiedAt,
            role: UserRole.COORDINATOR,
            organizationId: claim.organizationId,
            municipalityId: claim.municipalityId,
            isActive: false,
            mustChangePassword: true,
          },
        });
      }
      await transaction.organization.update({
        where: { id: claim.organizationId },
        data: {
          verificationStatus: OrganizationVerificationStatus.VERIFIED,
          verifiedAt: now,
          verifiedById: reviewer.id,
        },
      });
    }

    const status =
      input.decision === "approve"
        ? OrganizationClaimStatus.APPROVED
        : OrganizationClaimStatus.REJECTED;
    await transaction.organizationClaim.update({
      where: { id: claim.id },
      data: {
        status,
        reviewedById: reviewer.id,
        reviewedAt: now,
        reviewReason: input.reason.trim(),
      },
    });
    await transaction.notificationOutbox.create({
      data: {
        idempotencyKey: `organization-claim-decision:${claim.id}:${status}`,
        kind: NotificationKind.ORGANIZATION_CLAIM_DECISION,
        organizationId: claim.organizationId,
        organizationClaimId: claim.id,
        municipalityId: claim.municipalityId,
        templateKey:
          input.decision === "approve"
            ? "organization-claim-approved-v1"
            : "organization-claim-rejected-v1",
        payload: { claimId: claim.id, decision: input.decision },
      },
    });
    await transaction.auditLog.create({
      data: {
        actorId: reviewer.id,
        municipalityId: claim.municipalityId,
        action: `organization_claim.${input.decision === "approve" ? "approved" : "rejected"}`,
        entityType: "OrganizationClaim",
        entityId: claim.id,
        metadata: { organizationId: claim.organizationId },
      },
    });
    return { status };
  });
}

export async function getOrganizationDashboard() {
  const coordinator = await requireCoordinator();
  const claimWhere =
    coordinator.role === UserRole.SUPER_ADMIN
      ? {}
      : { organizationId: coordinator.organizationId ?? "__none__" };
  const [organizations, claims] = await Promise.all([
    prisma.organization.findMany({
      where:
        coordinator.role === UserRole.SUPER_ADMIN
          ? {}
          : { id: coordinator.organizationId ?? "__none__" },
      include: { municipality: true, domains: { orderBy: { domain: "asc" } } },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.organizationClaim.findMany({
      where: claimWhere,
      include: { organization: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
    }),
  ]);
  return {
    canReview: coordinator.role === UserRole.SUPER_ADMIN,
    organizations,
    claims: claims.map((claim) => ({
      ...claim,
      claimantEmail:
        coordinator.role === UserRole.SUPER_ADMIN
          ? claim.claimantEmail
          : claim.claimantEmail.replace(/^(.{2}).*(@.*)$/, "$1•••$2"),
      verificationTokenHash: undefined,
      verificationTokenCiphertext: undefined,
    })),
  };
}
