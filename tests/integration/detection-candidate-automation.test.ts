import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DetectionSource,
  ExternalDetectionStatus,
  IncidentOrigin,
  IncidentStatus,
  NotificationKind,
  OrganizationVerificationStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { publicIncidentEligibilityWhere } from "@/lib/public-incident-eligibility";
import { planDetectionCandidates } from "@/services/detection-candidates";

describe("safe detection candidate and digest automation", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date("2026-07-16T12:00:00.000Z");
  const candidateIds: string[] = [];
  const detectionIds: string[] = [];
  let municipalityId = "";
  let organizationId = "";

  async function createThermalCluster(
    label: string,
    latitude: number,
    longitude: number,
    detectedAt = new Date(now.getTime() - 20 * 60_000),
  ) {
    const detections = await Promise.all(
      [0, 1, 2].map((index) =>
        prisma.externalDetection.create({
          data: {
            source: DetectionSource.NASA_FIRMS,
            provider: "NASA VIIRS TEST",
            externalId: `candidate-${label}-${index}-${suffix}`,
            latitude: latitude + index * 0.0002,
            longitude: longitude + index * 0.0002,
            detectedAt: new Date(detectedAt.getTime() + index * 60_000),
            status: ExternalDetectionStatus.PENDING,
            municipalityId,
          },
        }),
      ),
    );
    detectionIds.push(...detections.map(({ id }) => id));
    return detections;
  }

  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: {
        name: `TEST automatización ${suffix}`,
        latitude: 38.123,
        longitude: -3.123,
      },
    });
    municipalityId = municipality.id;
    const organization = await prisma.organization.create({
      data: {
        name: `TEST entidad verificada ${suffix}`,
        municipalityId,
        verificationStatus: OrganizationVerificationStatus.VERIFIED,
        verifiedAt: now,
        notificationEnabled: true,
        notificationRadiusMeters: 20_000,
        notificationCooldownMinutes: 180,
        contactEmail: `alerts-${suffix}@example.test`,
      },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { municipalityId } });
    await prisma.notificationOutbox.deleteMany({
      where: { organizationId },
    });
    await prisma.externalDetection.deleteMany({
      where: { id: { in: detectionIds } },
    });
    await prisma.incident.deleteMany({
      where: {
        OR: [
          { id: { in: candidateIds } },
          { municipalityId, origin: IncidentOrigin.DETECTION_CANDIDATE },
        ],
      },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.municipality.deleteMany({ where: { id: municipalityId } });
  });

  it("groups three thermal signals into one internal, unconfirmed candidate", async () => {
    await createThermalCluster("first", 38.123, -3.123);

    const result = await planDetectionCandidates({
      now,
      createCandidates: true,
      enqueueNotifications: true,
      radiusMeters: 2_000,
      windowMinutes: 120,
      minimumThermalSignals: 3,
    });

    expect(result).toMatchObject({
      status: "completed",
      qualifyingClusters: 1,
      candidatesCreated: 1,
      detectionsLinked: 3,
      notificationsQueued: 1,
    });
    const candidate = await prisma.incident.findFirstOrThrow({
      where: {
        municipalityId,
        origin: IncidentOrigin.DETECTION_CANDIDATE,
      },
      orderBy: { createdAt: "desc" },
    });
    candidateIds.push(candidate.id);
    expect(candidate).toMatchObject({
      status: IncidentStatus.PENDING_VALIDATION,
      verifiedAt: null,
      verifiedById: null,
      publicLocationApprovedAt: null,
      publicLocationApprovedById: null,
    });
    expect(
      await prisma.incident.count({
        where: { id: candidate.id, ...publicIncidentEligibilityWhere },
      }),
    ).toBe(0);

    const outbox = await prisma.notificationOutbox.findFirstOrThrow({
      where: {
        organizationId,
        kind: NotificationKind.DETECTION_DIGEST,
      },
    });
    const serializedPayload = JSON.stringify(outbox.payload);
    expect(serializedPayload).toContain(
      "possible-fire-signal-requires-human-review",
    );
    expect(serializedPayload).not.toMatch(
      /latitude|longitude|coordinate|tactical/i,
    );
    expect(serializedPayload).not.toContain("38.123");
  });

  it("is idempotent and suppresses a second nearby digest during cooldown", async () => {
    const exactReplay = await planDetectionCandidates({
      now,
      createCandidates: true,
      enqueueNotifications: true,
      radiusMeters: 2_000,
      windowMinutes: 120,
      minimumThermalSignals: 3,
    });
    expect(exactReplay.candidatesCreated).toBe(0);
    expect(exactReplay.notificationsQueued).toBe(0);

    await createThermalCluster(
      "cooldown",
      38.124,
      -3.124,
      new Date(now.getTime() - 10 * 60_000),
    );
    const cooldown = await planDetectionCandidates({
      now,
      createCandidates: true,
      enqueueNotifications: true,
      radiusMeters: 2_000,
      windowMinutes: 120,
      minimumThermalSignals: 3,
    });

    expect(cooldown).toMatchObject({
      candidatesCreated: 0,
      linkedToExisting: 1,
      detectionsLinked: 3,
      notificationsQueued: 0,
      notificationsSuppressedByCooldown: 1,
    });
    expect(
      await prisma.notificationOutbox.count({
        where: {
          organizationId,
          kind: NotificationKind.DETECTION_DIGEST,
        },
      }),
    ).toBe(1);
  });

  it("leaves an isolated thermal focus as a detection instead of an incident", async () => {
    const single = await prisma.externalDetection.create({
      data: {
        source: DetectionSource.NASA_FIRMS,
        provider: "NASA VIIRS TEST",
        externalId: `candidate-single-${suffix}`,
        latitude: 39.3,
        longitude: -1.3,
        detectedAt: new Date(now.getTime() - 5 * 60_000),
        status: ExternalDetectionStatus.PENDING,
        municipalityId,
      },
    });
    detectionIds.push(single.id);

    const result = await planDetectionCandidates({
      now,
      createCandidates: true,
      enqueueNotifications: true,
      radiusMeters: 1_000,
      windowMinutes: 120,
      minimumThermalSignals: 3,
    });

    expect(result.qualifyingClusters).toBe(0);
    expect(result.candidatesCreated).toBe(0);
    await expect(
      prisma.externalDetection.findUniqueOrThrow({ where: { id: single.id } }),
    ).resolves.toMatchObject({
      status: ExternalDetectionStatus.PENDING,
      linkedIncidentId: null,
    });
  });
});
