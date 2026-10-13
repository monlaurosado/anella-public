import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OrganizationClaimStatus,
  OrganizationVerificationStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  createOrganizationClaim,
  decideOrganizationClaim,
  verifyOrganizationClaimToken,
} from "@/services/organization-claims";

describe("audited organization claim and verification flow", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const claimIds: string[] = [];
  const claimantEmails: string[] = [];
  let municipalityId = "";
  let organizationId = "";
  let reviewerId = "";
  let usedVerificationToken = "";

  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: `TEST reclamaciones ${suffix}` },
    });
    municipalityId = municipality.id;
    const organization = await prisma.organization.create({
      data: {
        name: `Ajuntament TEST ${suffix}`,
        municipalityId,
        verificationStatus: OrganizationVerificationStatus.UNVERIFIED,
      },
    });
    organizationId = organization.id;
    await prisma.organizationDomain.create({
      data: {
        organizationId,
        domain: `ajuntament-${suffix}.example.test`,
        isVerified: true,
      },
    });
    const reviewer = await prisma.user.create({
      data: {
        name: "Superadministración TEST reclamaciones",
        email: `reviewer-${suffix}@example.test`,
        role: UserRole.SUPER_ADMIN,
      },
    });
    reviewerId = reviewer.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { municipalityId } });
    await prisma.notificationOutbox.deleteMany({
      where: { organizationClaimId: { in: claimIds } },
    });
    await prisma.organizationClaim.deleteMany({
      where: { id: { in: claimIds } },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [{ id: reviewerId }, { email: { in: claimantEmails } }],
      },
    });
    await prisma.organizationDomain.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.municipality.deleteMany({ where: { id: municipalityId } });
  });

  it("verifies an allowed institutional domain but still requires human approval", async () => {
    const email = `persona@ajuntament-${suffix}.example.test`;
    claimantEmails.push(email);
    const created = await createOrganizationClaim({
      organizationId,
      claimantName: "Representante TEST autorizada",
      claimantEmail: email,
    });
    usedVerificationToken = created.verificationToken;
    claimIds.push(created.claimId);

    const outboxBeforeVerification =
      await prisma.notificationOutbox.findFirstOrThrow({
        where: { organizationClaimId: created.claimId },
      });
    const outboxPayload = JSON.stringify(outboxBeforeVerification.payload);
    expect(outboxPayload).not.toContain(email);
    expect(outboxPayload).not.toContain(created.verificationToken);
    expect(outboxPayload).toBe(JSON.stringify({ claimId: created.claimId }));

    const verified = await verifyOrganizationClaimToken(
      created.verificationToken,
    );
    expect(verified).toEqual({
      ok: true,
      institutionalDomainMatched: true,
    });
    await expect(
      prisma.organizationClaim.findUniqueOrThrow({
        where: { id: created.claimId },
      }),
    ).resolves.toMatchObject({
      status: OrganizationClaimStatus.PENDING_REVIEW,
      verificationTokenHash: null,
      verificationTokenCiphertext: null,
    });
    expect(
      await prisma.user.count({ where: { email } }),
      "verificar el correo no concede acceso",
    ).toBe(0);

    const decision = await decideOrganizationClaim({
      claimId: created.claimId,
      reviewerId,
      decision: "approve",
      reason: "Identidad y representación institucional contrastadas.",
    });
    expect(decision.status).toBe(OrganizationClaimStatus.APPROVED);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email } }),
    ).resolves.toMatchObject({
      role: UserRole.COORDINATOR,
      municipalityId,
      organizationId,
      isActive: false,
      mustChangePassword: true,
    });
    await expect(
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    ).resolves.toMatchObject({
      verificationStatus: OrganizationVerificationStatus.VERIFIED,
      verifiedById: reviewerId,
    });
  });

  it("keeps an unknown domain in manual review and allows an audited rejection", async () => {
    const email = `persona-${suffix}@unknown-institution.example`;
    claimantEmails.push(email);
    const created = await createOrganizationClaim({
      organizationId,
      claimantName: "Representante TEST no acreditada",
      claimantEmail: email,
    });
    claimIds.push(created.claimId);

    const verified = await verifyOrganizationClaimToken(
      created.verificationToken,
    );
    expect(verified).toEqual({
      ok: true,
      institutionalDomainMatched: false,
    });
    expect(await prisma.user.count({ where: { email } })).toBe(0);

    const decision = await decideOrganizationClaim({
      claimId: created.claimId,
      reviewerId,
      decision: "reject",
      reason: "El dominio no pertenece a la entidad y falta acreditación.",
    });
    expect(decision.status).toBe(OrganizationClaimStatus.REJECTED);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          municipalityId,
          entityId: created.claimId,
          action: "organization_claim.rejected",
        },
      }),
    ).toBe(1);
  });

  it("rejects token replay after the one-time verification", async () => {
    await expect(
      verifyOrganizationClaimToken(usedVerificationToken),
    ).resolves.toEqual({ ok: false });
  });
});
