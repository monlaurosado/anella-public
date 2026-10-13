import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ContributionCategory,
  DropOffPointStatus,
  IncidentStatus,
  IncidentType,
  NotificationKind,
  NotificationOutboxStatus,
  OrganizationClaimStatus,
  Priority,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  ANONYMIZED_CLAIMANT_EMAIL,
  ANONYMIZED_CLAIMANT_NAME,
  ANONYMIZED_CONTRIBUTOR_NAME,
  runOperationalMaintenance,
} from "@/lib/privacy-retention";

describe("PII expiry in the contribution-first domain", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date("2035-07-16T12:00:00.000Z");
  let municipalityId = "";
  let organizationId = "";
  let coordinatorId = "";
  let incidentId = "";
  let claimId = "";
  let outboxId = "";
  let contributionId = "";

  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: `TEST retención emergencia ${suffix}` },
    });
    municipalityId = municipality.id;
    const organization = await prisma.organization.create({
      data: {
        name: `TEST retención entidad ${suffix}`,
        municipalityId,
      },
    });
    organizationId = organization.id;
    const coordinator = await prisma.user.create({
      data: {
        name: "Coordinación TEST retención",
        email: `retention-${suffix}@example.test`,
        role: UserRole.COORDINATOR,
        municipalityId,
        organizationId,
      },
    });
    coordinatorId = coordinator.id;
    const incident = await prisma.incident.create({
      data: {
        publicCode: `RET-${suffix}`.slice(0, 32),
        title: "SIMULACRO · Retención en emergencia activa",
        type: IncidentType.OTHER,
        status: IncidentStatus.ACTIVE,
        priority: Priority.LOW,
        municipalityId,
        organizationId,
        createdById: coordinatorId,
        operationalLatitude: 40,
        operationalLongitude: -3,
      },
    });
    incidentId = incident.id;
    const point = await prisma.safePoint.create({
      data: {
        incidentId,
        municipalityId,
        name: "Punto TEST retención",
        latitude: 40,
        longitude: -3,
        qrToken: `retention-${suffix}`,
        isActive: true,
        pointStatus: DropOffPointStatus.ACTIVE,
        publishedAt: now,
        validatedAt: now,
        validatedById: coordinatorId,
      },
    });
    const contribution = await prisma.contribution.create({
      data: {
        publicCode: `PII-${suffix}`.slice(0, 20),
        cancelTokenHash: suffix.padEnd(64, "a").slice(0, 64),
        incidentId,
        safePointId: point.id,
        category: ContributionCategory.FOOD,
        description: "Descripción potencialmente identificativa",
        citizenName: "Persona TEST con PII",
        citizenPhone: "+34600000001",
        citizenEmail: `citizen-${suffix}@example.test`,
        notes: "Nota libre potencialmente identificativa",
        consentAt: new Date("2034-01-01T00:00:00.000Z"),
        personalDataConsentAt: new Date("2034-01-01T00:00:00.000Z"),
        piiExpiresAt: new Date("2035-07-15T00:00:00.000Z"),
      },
    });
    contributionId = contribution.id;
    const claim = await prisma.organizationClaim.create({
      data: {
        organizationId,
        municipalityId,
        claimantName: "Representante TEST con PII",
        claimantEmail: `claim-${suffix}@example.test`,
        emailDomain: "example.test",
        verificationTokenHash: suffix.padEnd(64, "b").slice(0, 64),
        verificationTokenCiphertext: "encrypted-test-token",
        status: OrganizationClaimStatus.PENDING_REVIEW,
        reviewReason: "Texto de revisión potencialmente identificativo",
        expiresAt: new Date("2034-01-02T00:00:00.000Z"),
        piiExpiresAt: new Date("2035-07-15T00:00:00.000Z"),
      },
    });
    claimId = claim.id;
    const old = new Date(now.getTime() - 100 * 86_400_000);
    const outbox = await prisma.notificationOutbox.create({
      data: {
        idempotencyKey: `retention-${suffix}`,
        kind: NotificationKind.ORGANIZATION_CLAIM_DECISION,
        status: NotificationOutboxStatus.SENT,
        municipalityId,
        organizationId,
        organizationClaimId: claimId,
        templateKey: "organization-claim-rejected-v1",
        payload: { claimId, legacyFreeText: "PII histórica" },
        sentAt: old,
        createdAt: old,
        updatedAt: old,
      },
    });
    outboxId = outbox.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { municipalityId } });
    await prisma.notificationOutbox.deleteMany({ where: { id: outboxId } });
    await prisma.organizationClaim.deleteMany({ where: { id: claimId } });
    await prisma.incident.deleteMany({ where: { id: incidentId } });
    await prisma.user.deleteMany({ where: { id: coordinatorId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.municipality.deleteMany({ where: { id: municipalityId } });
  });

  it("anonymizes expired contribution and claim PII and redacts old outbox payloads", async () => {
    const result = await runOperationalMaintenance(now);

    expect(result.anonymizedContributions).toBeGreaterThanOrEqual(1);
    expect(result.anonymizedOrganizationClaims).toBeGreaterThanOrEqual(1);
    expect(result.redactedNotificationOutbox).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.contribution.findUniqueOrThrow({
        where: { id: contributionId },
      }),
    ).resolves.toMatchObject({
      citizenName: ANONYMIZED_CONTRIBUTOR_NAME,
      citizenPhone: null,
      citizenEmail: null,
      description: null,
      notes: null,
      cancelTokenHash: null,
    });
    await expect(
      prisma.organizationClaim.findUniqueOrThrow({ where: { id: claimId } }),
    ).resolves.toMatchObject({
      claimantName: ANONYMIZED_CLAIMANT_NAME,
      claimantEmail: ANONYMIZED_CLAIMANT_EMAIL,
      emailDomain: "invalid.local",
      verificationTokenHash: null,
      verificationTokenCiphertext: null,
      reviewReason: null,
      status: OrganizationClaimStatus.EXPIRED,
    });
    const outbox = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outboxId },
    });
    expect(outbox.payload).toMatchObject({ retentionRedacted: true });
    expect(JSON.stringify(outbox.payload)).not.toContain("PII histórica");
  });
});
