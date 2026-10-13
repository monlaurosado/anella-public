import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  NotificationKind,
  NotificationOutboxStatus,
  OrganizationVerificationStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { processNotificationOutbox } from "@/services/notification-outbox";

describe("notification outbox delivery controls", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const outboxIds: string[] = [];
  let municipalityId = "";
  let organizationId = "";

  function payload() {
    return {
      clusterCount: 1,
      signalCount: 3,
      sources: ["NASA VIIRS TEST"],
      incidentIds: [],
      firstDetectedAt: "2030-01-01T09:00:00.000Z",
      lastDetectedAt: "2030-01-01T09:05:00.000Z",
      statement: "possible-fire-signal-requires-human-review",
    } as const;
  }

  async function createOutbox(label: string, notBefore: Date) {
    const outbox = await prisma.notificationOutbox.create({
      data: {
        idempotencyKey: `outbox-test-${label}-${suffix}`,
        kind: NotificationKind.DETECTION_DIGEST,
        municipalityId,
        organizationId,
        templateKey: "possible-fire-detection-digest-v1",
        payload: payload(),
        notBefore,
        maxAttempts: 3,
      },
    });
    outboxIds.push(outbox.id);
    return outbox;
  }

  beforeAll(async () => {
    const municipality = await prisma.municipality.create({
      data: { name: `TEST outbox ${suffix}` },
    });
    municipalityId = municipality.id;
    const organization = await prisma.organization.create({
      data: {
        name: `TEST notificaciones ${suffix}`,
        municipalityId,
        verificationStatus: OrganizationVerificationStatus.VERIFIED,
        contactEmail: `notifications-${suffix}@example.test`,
      },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        entityType: "NotificationOutbox",
        entityId: { in: outboxIds },
      },
    });
    await prisma.notificationOutbox.deleteMany({
      where: { id: { in: outboxIds } },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.municipality.deleteMany({ where: { id: municipalityId } });
  });

  it("discards in drill mode without invoking any real provider", async () => {
    const now = new Date("2030-01-01T10:00:00.000Z");
    const outbox = await createOutbox("drill", now);
    const provider = { send: vi.fn(async () => ({})) };

    const result = await processNotificationOutbox({
      now,
      deliveryEnabled: true,
      drillMode: true,
      provider,
      limit: 1,
    });

    expect(result).toMatchObject({ status: "drill", selected: 1, sent: 0 });
    expect(provider.send).not.toHaveBeenCalled();
    await expect(
      prisma.notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
      }),
    ).resolves.toMatchObject({
      status: NotificationOutboxStatus.DISCARDED,
      attempts: 1,
      lastError: "drill-mode-no-delivery",
    });
  });

  it("retries with backoff, sends once and remains idempotent afterwards", async () => {
    const now = new Date("2040-01-01T10:00:00.000Z");
    const outbox = await createOutbox("retry", now);
    const provider = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockResolvedValue({ providerMessageId: "provider-test-1" }),
    };

    const failed = await processNotificationOutbox({
      now,
      deliveryEnabled: true,
      drillMode: false,
      provider,
      limit: 1,
    });
    expect(failed).toMatchObject({ selected: 1, failed: 1, sent: 0 });
    await expect(
      prisma.notificationOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
      }),
    ).resolves.toMatchObject({
      status: NotificationOutboxStatus.FAILED,
      attempts: 1,
      lastError: "provider-error",
    });

    const tooEarly = await processNotificationOutbox({
      now: new Date(now.getTime() + 4 * 60_000),
      deliveryEnabled: true,
      drillMode: false,
      provider,
      limit: 1,
    });
    expect(tooEarly.selected).toBe(0);
    expect(provider.send).toHaveBeenCalledTimes(1);

    const sent = await processNotificationOutbox({
      now: new Date(now.getTime() + 5 * 60_000),
      deliveryEnabled: true,
      drillMode: false,
      provider,
      limit: 1,
    });
    expect(sent).toMatchObject({ selected: 1, sent: 1, failed: 0 });
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(provider.send.mock.calls[1][0]).toMatchObject({
      outboxId: outbox.id,
      to: `notifications-${suffix}@example.test`,
      data: { confirmationStatus: "unconfirmed" },
    });
    expect(JSON.stringify(provider.send.mock.calls[1][0])).not.toMatch(
      /latitude|longitude|coordinate/i,
    );

    const replay = await processNotificationOutbox({
      now: new Date(now.getTime() + 24 * 60 * 60_000),
      deliveryEnabled: true,
      drillMode: false,
      provider,
      limit: 1,
    });
    expect(replay.selected).toBe(0);
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it("fails closed when delivery is globally disabled", async () => {
    const provider = { send: vi.fn(async () => ({})) };
    const result = await processNotificationOutbox({
      deliveryEnabled: false,
      drillMode: false,
      provider,
    });
    expect(result).toEqual({
      status: "disabled",
      selected: 0,
      sent: 0,
      failed: 0,
      discarded: 0,
    });
    expect(provider.send).not.toHaveBeenCalled();
  });
});
