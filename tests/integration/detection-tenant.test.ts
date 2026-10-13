import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type TestCoordinator = {
  id: string;
  name: string;
  email: string;
  role: "COORDINATOR" | "MUNICIPAL_ADMIN" | "SUPER_ADMIN";
  municipalityId: string | null;
  municipalityName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  mustChangePassword: boolean;
  sessionVersion: number;
};

const auth = vi.hoisted(() => ({
  coordinator: null as TestCoordinator | null,
  redirect: vi.fn((url: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: auth.revalidatePath,
  updateTag: auth.updateTag,
}));
vi.mock("next/navigation", () => ({ redirect: auth.redirect }));
vi.mock("@/lib/dal", () => ({
  requireCoordinator: async () => {
    if (!auth.coordinator) throw new Error("UNAUTHORIZED");
    return auth.coordinator;
  },
  assertCoordinator: async () => {
    if (!auth.coordinator) throw new Error("UNAUTHORIZED");
    return auth.coordinator;
  },
}));

import {
  createIncidentFromDetection,
  dismissDetection,
  linkDetection,
  syncFirms,
} from "@/actions/detections";
import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import {
  DetectionSource,
  ExternalDetectionStatus,
  IncidentStatus,
  IncidentType,
  Priority,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { FIRMS_RESPONSE_LIMITS } from "@/lib/firms";
import { getDetectionQueue } from "@/services/detections";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const firmsCsv = `latitude,longitude,bright_ti4,acq_date,acq_time,satellite,instrument,confidence,frp,daynight
41.6082,2.2864,341.2,2026-07-13,1840,N20,VIIRS,n,8.4,N`;

async function expectRedirect(
  operation: () => Promise<unknown>,
  expectedText: string,
) {
  auth.redirect.mockClear();
  await expect(operation()).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
  const destination = String(auth.redirect.mock.lastCall?.[0] ?? "");
  const query = new URL(destination, "http://anella.test").searchParams;
  expect(query.get("error") ?? query.get("notice") ?? destination).toContain(
    expectedText,
  );
}

describe("external detection isolation through production services and actions", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userIds: string[] = [];
  const incidentIds: string[] = [];
  const detectionIds: string[] = [];
  let municipalityAId = "";
  let municipalityBId = "";
  let coordinatorAId = "";
  let superAdminId = "";
  let incidentAId = "";
  let incidentBId = "";
  let queueDetectionAId = "";
  let queueDetectionBId = "";
  let globalDetectionId = "";
  let foreignDismissDetectionId = "";
  let foreignLinkDetectionId = "";
  let foreignCreateDetectionId = "";
  let ownDismissDetectionId = "";
  let superDismissDetectionId = "";

  function actAsCoordinatorA() {
    auth.coordinator = {
      id: coordinatorAId,
      name: "Coordinación A",
      email: `coordinator-a-${suffix}@anella.test`,
      role: "COORDINATOR",
      municipalityId: municipalityAId,
      municipalityName: "Municipio A",
      organizationId: null,
      organizationName: null,
      mustChangePassword: false,
      sessionVersion: 1,
    };
  }

  function actAsSuperAdmin() {
    auth.coordinator = {
      id: superAdminId,
      name: "Administración global",
      email: `super-${suffix}@anella.test`,
      role: "SUPER_ADMIN",
      municipalityId: null,
      municipalityName: null,
      organizationId: null,
      organizationName: null,
      mustChangePassword: false,
      sessionVersion: 1,
    };
  }

  beforeAll(async () => {
    const [municipalityA, municipalityB] = await Promise.all([
      prisma.municipality.create({
        data: { name: `TEST señales servicio A ${suffix}` },
      }),
      prisma.municipality.create({
        data: { name: `TEST señales servicio B ${suffix}` },
      }),
    ]);
    municipalityAId = municipalityA.id;
    municipalityBId = municipalityB.id;

    const [coordinatorA, superAdmin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Coordinación A",
          email: `coordinator-a-${suffix}@anella.test`,
          role: UserRole.COORDINATOR,
          municipalityId: municipalityAId,
        },
      }),
      prisma.user.create({
        data: {
          name: "Administración global",
          email: `super-${suffix}@anella.test`,
          role: UserRole.SUPER_ADMIN,
        },
      }),
    ]);
    coordinatorAId = coordinatorA.id;
    superAdminId = superAdmin.id;
    userIds.push(coordinatorA.id, superAdmin.id);

    const [incidentA, incidentB] = await Promise.all([
      prisma.incident.create({
        data: {
          publicCode: `DET-A-${suffix}`.slice(0, 32),
          title: "Incidente municipal A para señales",
          type: IncidentType.WILDFIRE,
          status: IncidentStatus.ACTIVE,
          priority: Priority.MEDIUM,
          operationalLatitude: 41.5,
          operationalLongitude: 2.2,
          publicLocationLabel: municipalityA.name,
          publicLocationApprovedAt: new Date(),
          publicLocationApprovedById: coordinatorAId,
          verifiedAt: new Date(),
          verifiedById: coordinatorAId,
          municipalityId: municipalityAId,
          createdById: coordinatorAId,
        },
      }),
      prisma.incident.create({
        data: {
          publicCode: `DET-B-${suffix}`.slice(0, 32),
          title: "Incidente municipal B para señales",
          type: IncidentType.FLOOD,
          status: IncidentStatus.DRAFT,
          priority: Priority.MEDIUM,
          operationalLatitude: 41.6,
          operationalLongitude: 2.3,
          municipalityId: municipalityBId,
        },
      }),
    ]);
    incidentAId = incidentA.id;
    incidentBId = incidentB.id;
    incidentIds.push(incidentA.id, incidentB.id);

    const createDetection = async (
      municipalityId: string | null,
      offset: number,
    ) =>
      prisma.externalDetection.create({
        data: {
          source: DetectionSource.MANUAL,
          latitude: 41.5 + offset / 100,
          longitude: 2.2 + offset / 100,
          detectedAt: new Date(Date.now() + offset),
          municipalityId,
        },
      });

    const detections = await Promise.all([
      createDetection(municipalityAId, 1),
      createDetection(municipalityBId, 2),
      createDetection(null, 3),
      createDetection(municipalityBId, 4),
      createDetection(municipalityBId, 5),
      createDetection(municipalityBId, 6),
      createDetection(municipalityAId, 7),
      createDetection(municipalityBId, 8),
    ]);
    [
      queueDetectionAId,
      queueDetectionBId,
      globalDetectionId,
      foreignDismissDetectionId,
      foreignLinkDetectionId,
      foreignCreateDetectionId,
      ownDismissDetectionId,
      superDismissDetectionId,
    ] = detections.map((detection) => detection.id);
    detectionIds.push(...detections.map((detection) => detection.id));
  });

  beforeEach(async () => {
    auth.coordinator = null;
    auth.redirect.mockClear();
    auth.revalidatePath.mockClear();
    auth.updateTag.mockClear();
    await prisma.auditLog.deleteMany({
      where: {
        actorId: coordinatorAId,
        municipalityId: municipalityAId,
        action: {
          in: [
            "external_detection.sync_completed",
            "external_detection.sync_failed",
            "external_detection.sync_rate_limited",
          ],
        },
      },
    });
    await prisma.externalDetection.deleteMany({
      where: {
        municipalityId: municipalityAId,
        source: DetectionSource.NASA_FIRMS,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { municipalityId: { in: [municipalityAId, municipalityBId] } },
          { entityId: { in: [...detectionIds, ...incidentIds] } },
        ],
      },
    });
    await prisma.externalDetection.deleteMany({
      where: {
        OR: [
          { id: { in: detectionIds } },
          {
            municipalityId: municipalityAId,
            source: DetectionSource.NASA_FIRMS,
          },
        ],
      },
    });
    await prisma.incident.deleteMany({ where: { id: { in: incidentIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.municipality.deleteMany({
      where: { id: { in: [municipalityAId, municipalityBId] } },
    });
    await prisma.$disconnect();
  });

  it("keeps a municipal queue inside the authenticated tenant", async () => {
    actAsCoordinatorA();

    const queue = await getDetectionQueue({
      municipalityId: municipalityBId,
      pageSize: 100,
    });
    const ids = queue.detections.map((detection) => detection.id);

    expect(queue.municipalityId).toBe(municipalityAId);
    expect(queue.selectionRequired).toBe(false);
    expect(queue.municipalities).toEqual([
      expect.objectContaining({ id: municipalityAId }),
    ]);
    expect(ids).toContain(queueDetectionAId);
    expect(ids).not.toContain(queueDetectionBId);
    expect(ids).not.toContain(globalDetectionId);
  });

  it("gives SUPER_ADMIN a complete national queue and keeps municipal filtering available", async () => {
    actAsSuperAdmin();

    const withoutSelection = await getDetectionQueue({ pageSize: 100 });
    const nationalIds = withoutSelection.detections.map(
      (detection) => detection.id,
    );
    expect(withoutSelection.selectionRequired).toBe(false);
    expect(withoutSelection.canUseNationalScope).toBe(true);
    expect(withoutSelection.isNationalScope).toBe(true);
    expect(nationalIds).toEqual(
      expect.arrayContaining([
        queueDetectionAId,
        queueDetectionBId,
        globalDetectionId,
      ]),
    );

    const municipalityBQueue = await getDetectionQueue({
      municipalityId: municipalityBId,
      pageSize: 100,
    });
    const ids = municipalityBQueue.detections.map((detection) => detection.id);
    expect(municipalityBQueue.selectionRequired).toBe(false);
    expect(municipalityBQueue.isNationalScope).toBe(false);
    expect(municipalityBQueue.municipalityId).toBe(municipalityBId);
    expect(ids).toContain(queueDetectionBId);
    expect(ids).not.toContain(queueDetectionAId);
    expect(ids).not.toContain(globalDetectionId);
  });

  it("invalidates the public snapshot after linking a signal to an active incident", async () => {
    actAsCoordinatorA();

    await expectRedirect(
      () =>
        linkDetection(
          form({
            detectionId: queueDetectionAId,
            incidentId: incidentAId,
            municipalityId: municipalityAId,
          }),
        ),
      "Señal vinculada al incidente",
    );

    await expect(
      prisma.externalDetection.findUniqueOrThrow({
        where: { id: queueDetectionAId },
        select: { status: true, linkedIncidentId: true },
      }),
    ).resolves.toEqual({
      status: ExternalDetectionStatus.LINKED,
      linkedIncidentId: incidentAId,
    });
    expect(auth.updateTag).toHaveBeenCalledTimes(1);
    expect(auth.updateTag).toHaveBeenCalledWith(PUBLIC_INCIDENTS_CACHE_TAG);
  });

  it("rejects every cross-tenant mutation without effects or audit rows", async () => {
    actAsCoordinatorA();

    await expectRedirect(
      () =>
        dismissDetection(
          form({
            detectionId: foreignDismissDetectionId,
            municipalityId: municipalityBId,
            reason: "Señal ajena usada para verificar el aislamiento",
            confirmed: "true",
          }),
        ),
      "Señal no encontrada en este municipio.",
    );

    await expectRedirect(
      () =>
        linkDetection(
          form({
            detectionId: foreignLinkDetectionId,
            incidentId: incidentBId,
            municipalityId: municipalityBId,
          }),
        ),
      "Señal no encontrada en este municipio.",
    );

    const incidentCountBefore = await prisma.incident.count({
      where: { municipalityId: municipalityBId },
    });
    await expectRedirect(
      () =>
        createIncidentFromDetection(
          form({
            detectionId: foreignCreateDetectionId,
            municipalityId: municipalityBId,
            title: "Incendio detectado fuera del municipio",
            type: "WILDFIRE",
            priority: "HIGH",
            publicSummary: "Señal pendiente de revisión humana y municipal.",
            safetyNotice: "No te acerques a la zona ni bloquees accesos.",
            radiusMeters: "1000",
          }),
        ),
      "Señal no encontrada en este municipio.",
    );

    const foreignDetections = await prisma.externalDetection.findMany({
      where: {
        id: {
          in: [
            foreignDismissDetectionId,
            foreignLinkDetectionId,
            foreignCreateDetectionId,
          ],
        },
      },
      select: { status: true, linkedIncidentId: true },
    });
    expect(foreignDetections).toHaveLength(3);
    expect(
      foreignDetections.every(
        (detection) =>
          detection.status === ExternalDetectionStatus.PENDING &&
          detection.linkedIncidentId === null,
      ),
    ).toBe(true);
    await expect(
      prisma.incident.count({ where: { municipalityId: municipalityBId } }),
    ).resolves.toBe(incidentCountBefore);
    await expect(
      prisma.auditLog.count({
        where: {
          entityId: {
            in: [
              foreignDismissDetectionId,
              foreignLinkDetectionId,
              foreignCreateDetectionId,
            ],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it("allows a municipality to mutate only its own signal and records the actor and tenant", async () => {
    actAsCoordinatorA();
    const reason = "Descarte municipal verificado con evidencia suficiente";

    await expectRedirect(
      () =>
        dismissDetection(
          form({
            detectionId: ownDismissDetectionId,
            municipalityId: municipalityBId,
            reason,
            confirmed: "true",
          }),
        ),
      "Señal descartada y auditada.",
    );

    await expect(
      prisma.externalDetection.findUniqueOrThrow({
        where: { id: ownDismissDetectionId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: ExternalDetectionStatus.DISMISSED });
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: {
          action: "external_detection.dismissed",
          entityId: ownDismissDetectionId,
        },
        select: {
          actorId: true,
          municipalityId: true,
          metadata: true,
        },
      }),
    ).resolves.toMatchObject({
      actorId: coordinatorAId,
      municipalityId: municipalityAId,
      metadata: {
        before: { status: ExternalDetectionStatus.PENDING },
        after: { status: ExternalDetectionStatus.DISMISSED },
        reason,
      },
    });
  });

  it("lets SUPER_ADMIN act in an explicitly selected tenant and audits that scope", async () => {
    actAsSuperAdmin();
    const reason = "Descarte global revisado dentro del municipio seleccionado";

    await expectRedirect(
      () =>
        dismissDetection(
          form({
            detectionId: superDismissDetectionId,
            municipalityId: municipalityBId,
            reason,
            confirmed: "true",
          }),
        ),
      "Señal descartada y auditada.",
    );

    await expect(
      prisma.externalDetection.findUniqueOrThrow({
        where: { id: superDismissDetectionId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: ExternalDetectionStatus.DISMISSED });
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: {
          action: "external_detection.dismissed",
          entityId: superDismissDetectionId,
        },
        select: {
          actorId: true,
          municipalityId: true,
          metadata: true,
        },
      }),
    ).resolves.toMatchObject({
      actorId: superAdminId,
      municipalityId: municipalityBId,
      metadata: {
        before: { status: ExternalDetectionStatus.PENDING },
        after: { status: ExternalDetectionStatus.DISMISSED },
        reason,
      },
    });
  });

  it("shows and audits the complete size-limit error without importing a prefix", async () => {
    actAsCoordinatorA();
    const previousMapKey = process.env.NASA_FIRMS_MAP_KEY;
    process.env.NASA_FIRMS_MAP_KEY = "integration-test-map-key";
    const reason =
      "La respuesta de NASA FIRMS supera el límite seguro de 2 MiB. No se ha importado ninguna señal.";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("cuerpo que no debe procesarse", {
        headers: {
          "content-length": String(FIRMS_RESPONSE_LIMITS.maxBytes + 1),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expectRedirect(
        () =>
          syncFirms(form({ municipalityId: municipalityAId, pageSize: "25" })),
        reason,
      );
      await expect(
        prisma.externalDetection.count({
          where: {
            municipalityId: municipalityAId,
            source: DetectionSource.NASA_FIRMS,
          },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.auditLog.findFirstOrThrow({
          where: {
            actorId: coordinatorAId,
            municipalityId: municipalityAId,
            action: "external_detection.sync_failed",
          },
          select: { metadata: true },
        }),
      ).resolves.toMatchObject({ metadata: { reason } });
    } finally {
      vi.unstubAllGlobals();
      if (previousMapKey === undefined) {
        delete process.env.NASA_FIRMS_MAP_KEY;
      } else {
        process.env.NASA_FIRMS_MAP_KEY = previousMapKey;
      }
    }
  });

  it("imports private pending signals without creating public records, then applies an audited cooldown", async () => {
    actAsCoordinatorA();
    const previousMapKey = process.env.NASA_FIRMS_MAP_KEY;
    process.env.NASA_FIRMS_MAP_KEY = "integration-test-map-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(firmsCsv));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const [incidentCountBefore, needCountBefore] = await Promise.all([
        prisma.incident.count({
          where: { municipalityId: municipalityAId },
        }),
        prisma.need.count({
          where: { incident: { municipalityId: municipalityAId } },
        }),
      ]);

      await expectRedirect(
        () =>
          syncFirms(
            form({
              municipalityId: municipalityAId,
              page: "1",
              pageSize: "25",
            }),
          ),
        "señales nuevas importadas",
      );

      const [importedSignals, incidentCountAfter, needCountAfter] =
        await Promise.all([
          prisma.externalDetection.findMany({
            where: {
              municipalityId: municipalityAId,
              source: DetectionSource.NASA_FIRMS,
            },
            select: {
              externalId: true,
              linkedIncidentId: true,
              municipalityId: true,
              status: true,
            },
          }),
          prisma.incident.count({
            where: { municipalityId: municipalityAId },
          }),
          prisma.need.count({
            where: { incident: { municipalityId: municipalityAId } },
          }),
        ]);
      expect(importedSignals).toHaveLength(1);
      expect(importedSignals[0]).toMatchObject({
        linkedIncidentId: null,
        municipalityId: municipalityAId,
        status: ExternalDetectionStatus.PENDING,
      });
      expect(importedSignals[0]?.externalId).toContain(`${municipalityAId}:`);
      expect(incidentCountAfter).toBe(incidentCountBefore);
      expect(needCountAfter).toBe(needCountBefore);

      await expectRedirect(
        () =>
          syncFirms(
            form({
              municipalityId: municipalityAId,
              page: "1",
              pageSize: "25",
            }),
          ),
        "Vuelve a intentarlo dentro de",
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(
        prisma.auditLog.findFirstOrThrow({
          where: {
            actorId: coordinatorAId,
            municipalityId: municipalityAId,
            action: "external_detection.sync_rate_limited",
          },
          select: { metadata: true },
        }),
      ).resolves.toMatchObject({
        metadata: { reason: "cooldown" },
      });
    } finally {
      vi.unstubAllGlobals();
      if (previousMapKey === undefined) {
        delete process.env.NASA_FIRMS_MAP_KEY;
      } else {
        process.env.NASA_FIRMS_MAP_KEY = previousMapKey;
      }
    }
  });

  it("rejects and audits a second synchronization while another one is running", async () => {
    actAsCoordinatorA();
    const previousMapKey = process.env.NASA_FIRMS_MAP_KEY;
    process.env.NASA_FIRMS_MAP_KEY = "integration-test-map-key";
    let releaseFetch!: () => void;
    let markFetchStarted!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchMock = vi.fn(async () => {
      markFetchStarted();
      await fetchGate;
      return new Response(firmsCsv);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const firstAttempt = syncFirms(
        form({ municipalityId: municipalityAId, pageSize: "25" }),
      ).catch((error: unknown) => error);
      await fetchStarted;

      await expectRedirect(
        () =>
          syncFirms(form({ municipalityId: municipalityAId, pageSize: "25" })),
        "Ya hay una importación de NASA FIRMS en curso",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const overlapAudit = await prisma.auditLog.findFirstOrThrow({
        where: {
          actorId: coordinatorAId,
          municipalityId: municipalityAId,
          action: "external_detection.sync_rate_limited",
        },
        select: { metadata: true },
      });
      expect(overlapAudit.metadata).toMatchObject({ reason: "overlap" });

      releaseFetch();
      await expect(firstAttempt).resolves.toMatchObject({
        message: "NEXT_REDIRECT",
      });
    } finally {
      releaseFetch();
      vi.unstubAllGlobals();
      if (previousMapKey === undefined) {
        delete process.env.NASA_FIRMS_MAP_KEY;
      } else {
        process.env.NASA_FIRMS_MAP_KEY = previousMapKey;
      }
    }
  });
});
