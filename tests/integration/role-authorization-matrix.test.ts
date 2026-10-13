import { hash } from "bcryptjs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  actor: null as null | {
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
  },
  redirect: vi.fn((url: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("next/cache", () => ({
  revalidatePath: state.revalidatePath,
  updateTag: vi.fn(),
}));
vi.mock("@/lib/dal", () => ({
  requireCoordinator: async () => {
    if (!state.actor) return state.redirect("/login");
    return state.actor;
  },
  assertCoordinator: async () => {
    if (!state.actor) throw new Error("UNAUTHORIZED");
    return state.actor;
  },
  incidentScopeWhere: (coordinator: {
    role: string;
    municipalityId: string | null;
  }) =>
    coordinator.role === "SUPER_ADMIN"
      ? {}
      : { municipalityId: coordinator.municipalityId ?? "__none__" },
}));

import { updateContributionStatus } from "@/actions/coordination";
import { setCoordinatorStatus } from "@/actions/users";
import {
  ContributionStatus,
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  Priority,
  PublicLocationMode,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getContributionQueue } from "@/services/incidents";

type OperationalRole = "COORDINATOR" | "MUNICIPAL_ADMIN" | "SUPER_ADMIN";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function contributionForm(incidentId: string, contributionId: string) {
  return form({
    incidentId,
    contributionId,
    revision: "1",
    status: "EN_ROUTE",
    deliveredQuantity: "0",
  });
}

function accountStatusForm(userId: string) {
  return form({
    userId,
    statusAction: "deactivate",
    reason: "Baja verificada para probar la matriz de autorización",
    currentPassword: "Matrix-Admin-Password-2026!",
    confirmSensitiveAction: "confirmed",
  });
}

async function expectRedirect(operation: Promise<unknown>, path: string) {
  await expect(operation).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
  expect(state.redirect).toHaveBeenLastCalledWith(
    expect.stringContaining(path),
  );
}

describe("role, tenant and PII authorization matrix", () => {
  const token = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const userIds: string[] = [];
  const contributionIds: string[] = [];
  const incidentIds: string[] = [];
  const needIds: string[] = [];
  let municipalityAId = "";
  let municipalityBId = "";
  let coordinatorAId = "";
  let municipalAdminAId = "";
  let superAdminId = "";
  let unassignedCoordinatorId = "";
  let accountTargetAId = "";
  let accountTargetBId = "";
  let incidentAId = "";
  let incidentBId = "";
  let contributionCoordinatorAId = "";
  let contributionCoordinatorBId = "";
  let contributionAdminAId = "";
  let contributionAdminBId = "";
  let contributionUnassignedAId = "";

  function actAs(role: OperationalRole) {
    const actor = {
      COORDINATOR: {
        id: coordinatorAId,
        email: `coordinator-${token}@example.com`,
        municipalityId: municipalityAId,
        municipalityName: "Municipio A",
      },
      MUNICIPAL_ADMIN: {
        id: municipalAdminAId,
        email: `admin-${token}@example.com`,
        municipalityId: municipalityAId,
        municipalityName: "Municipio A",
      },
      SUPER_ADMIN: {
        id: superAdminId,
        email: `super-${token}@example.com`,
        municipalityId: null,
        municipalityName: null,
      },
    }[role];

    state.actor = {
      ...actor,
      name: `Actor ${role}`,
      role,
      organizationId: null,
      organizationName: null,
      mustChangePassword: false,
      sessionVersion: 7,
    };
  }

  function actAsUnassignedCoordinator() {
    state.actor = {
      id: unassignedCoordinatorId,
      name: "Coordinación sin municipio",
      email: `unassigned-${token}@example.com`,
      role: "COORDINATOR",
      municipalityId: null,
      municipalityName: null,
      organizationId: null,
      organizationName: null,
      mustChangePassword: false,
      sessionVersion: 7,
    };
  }

  beforeAll(async () => {
    const administrativePasswordHash = await hash(
      "Matrix-Admin-Password-2026!",
      4,
    );
    const [municipalityA, municipalityB] = await Promise.all([
      prisma.municipality.create({
        data: { name: `TEST matriz roles A ${token}` },
      }),
      prisma.municipality.create({
        data: { name: `TEST matriz roles B ${token}` },
      }),
    ]);
    municipalityAId = municipalityA.id;
    municipalityBId = municipalityB.id;

    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: "Coordinación A",
          email: `coordinator-${token}@example.com`,
          role: UserRole.COORDINATOR,
          municipalityId: municipalityAId,
          mustChangePassword: false,
          sessionVersion: 7,
        },
      }),
      prisma.user.create({
        data: {
          name: "Administración municipal A",
          email: `admin-${token}@example.com`,
          role: UserRole.MUNICIPAL_ADMIN,
          passwordHash: administrativePasswordHash,
          municipalityId: municipalityAId,
          mustChangePassword: false,
          sessionVersion: 7,
        },
      }),
      prisma.user.create({
        data: {
          name: "Administración global",
          email: `super-${token}@example.com`,
          role: UserRole.SUPER_ADMIN,
          passwordHash: administrativePasswordHash,
          mustChangePassword: false,
          sessionVersion: 7,
        },
      }),
      prisma.user.create({
        data: {
          name: "Coordinación sin municipio",
          email: `unassigned-${token}@example.com`,
          role: UserRole.COORDINATOR,
          mustChangePassword: false,
          sessionVersion: 7,
        },
      }),
      prisma.user.create({
        data: {
          name: "Cuenta objetivo A",
          email: `target-a-${token}@example.com`,
          role: UserRole.COORDINATOR,
          municipalityId: municipalityAId,
          mustChangePassword: false,
          sessionVersion: 3,
        },
      }),
      prisma.user.create({
        data: {
          name: "Cuenta objetivo B",
          email: `target-b-${token}@example.com`,
          role: UserRole.COORDINATOR,
          municipalityId: municipalityBId,
          mustChangePassword: false,
          sessionVersion: 3,
        },
      }),
    ]);
    [
      coordinatorAId,
      municipalAdminAId,
      superAdminId,
      unassignedCoordinatorId,
      accountTargetAId,
      accountTargetBId,
    ] = users.map((user) => user.id);
    userIds.push(...users.map((user) => user.id));

    const now = new Date();
    const [incidentA, incidentB] = await Promise.all([
      prisma.incident.create({
        data: {
          publicCode: `IA-${token}`,
          title: `Incidente autorizado A ${token}`,
          type: IncidentType.OTHER,
          status: IncidentStatus.ACTIVE,
          priority: Priority.HIGH,
          operationalLatitude: 41.38,
          operationalLongitude: 2.17,
          publicLocationMode: PublicLocationMode.SAFE_POINTS_ONLY,
          publicLocationApprovedById: municipalAdminAId,
          publicLocationApprovedAt: now,
          municipalityId: municipalityAId,
          createdById: municipalAdminAId,
          verifiedById: municipalAdminAId,
          verifiedAt: now,
        },
      }),
      prisma.incident.create({
        data: {
          publicCode: `IB-${token}`,
          title: `Incidente autorizado B ${token}`,
          type: IncidentType.OTHER,
          status: IncidentStatus.ACTIVE,
          priority: Priority.HIGH,
          operationalLatitude: 40.42,
          operationalLongitude: -3.7,
          publicLocationMode: PublicLocationMode.SAFE_POINTS_ONLY,
          publicLocationApprovedById: superAdminId,
          publicLocationApprovedAt: now,
          municipalityId: municipalityBId,
          createdById: superAdminId,
          verifiedById: superAdminId,
          verifiedAt: now,
        },
      }),
    ]);
    incidentAId = incidentA.id;
    incidentBId = incidentB.id;
    incidentIds.push(incidentA.id, incidentB.id);

    const [safePointA, safePointB] = await Promise.all([
      prisma.safePoint.create({
        data: {
          incidentId: incidentAId,
          municipalityId: municipalityAId,
          name: `Punto seguro A ${token}`,
          latitude: 41.39,
          longitude: 2.18,
          qrToken: `qa-${token}`,
          validatedById: municipalAdminAId,
          validatedAt: now,
        },
      }),
      prisma.safePoint.create({
        data: {
          incidentId: incidentBId,
          municipalityId: municipalityBId,
          name: `Punto seguro B ${token}`,
          latitude: 40.43,
          longitude: -3.69,
          qrToken: `qb-${token}`,
          validatedById: superAdminId,
          validatedAt: now,
        },
      }),
    ]);

    const deadline = new Date("2099-01-01T00:00:00.000Z");
    const [needA, needB] = await Promise.all([
      prisma.need.create({
        data: {
          incidentId: incidentAId,
          safePointId: safePointA.id,
          type: NeedType.WATER,
          title: `Necesidad A ${token}`,
          priority: Priority.HIGH,
          quantityNeeded: 100,
          unit: "botellas",
          deadline,
          status: NeedStatus.ACTIVE,
          validatedById: municipalAdminAId,
          validatedAt: now,
          publishedAt: now,
        },
      }),
      prisma.need.create({
        data: {
          incidentId: incidentBId,
          safePointId: safePointB.id,
          type: NeedType.WATER,
          title: `Necesidad B ${token}`,
          priority: Priority.HIGH,
          quantityNeeded: 100,
          unit: "botellas",
          deadline,
          status: NeedStatus.ACTIVE,
          validatedById: superAdminId,
          validatedAt: now,
          publishedAt: now,
        },
      }),
    ]);
    needIds.push(needA.id, needB.id);

    const createContribution = (
      code: string,
      needId: string,
      safePointId: string,
      citizenName: string,
      tenant: "a" | "b",
    ) =>
      prisma.contribution.create({
        data: {
          publicCode: `${code}-${token}`,
          incidentId: tenant === "a" ? incidentAId : incidentBId,
          needId,
          safePointId,
          citizenName,
          citizenPhone: tenant === "a" ? "+34600000001" : "+34600000002",
          citizenEmail: `pii-${tenant}-${token}@example.com`,
          quantity: 10,
          status: ContributionStatus.PLEDGED,
          notes: `nota-privada-${tenant}-${token}`,
          consentAt: now,
        },
      });

    const contributions = await Promise.all([
      createContribution(
        "CA",
        needA.id,
        safePointA.id,
        `PII A coordinación ${token}`,
        "a",
      ),
      createContribution(
        "CB",
        needB.id,
        safePointB.id,
        `PII B coordinación ${token}`,
        "b",
      ),
      createContribution(
        "AA",
        needA.id,
        safePointA.id,
        `PII A administración ${token}`,
        "a",
      ),
      createContribution(
        "AB",
        needB.id,
        safePointB.id,
        `PII B administración ${token}`,
        "b",
      ),
      createContribution(
        "NA",
        needA.id,
        safePointA.id,
        `PII A sin municipio ${token}`,
        "a",
      ),
    ]);
    [
      contributionCoordinatorAId,
      contributionCoordinatorBId,
      contributionAdminAId,
      contributionAdminBId,
      contributionUnassignedAId,
    ] = contributions.map((contribution) => contribution.id);
    contributionIds.push(
      ...contributions.map((contribution) => contribution.id),
    );
  });

  beforeEach(async () => {
    state.actor = null;
    state.redirect.mockClear();
    state.revalidatePath.mockClear();
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { incidentId: { in: incidentIds } },
          { actorId: { in: userIds } },
          {
            entityId: {
              in: [...contributionIds, accountTargetAId, accountTargetBId],
            },
          },
        ],
      },
    });
    await prisma.contribution.updateMany({
      where: { id: { in: contributionIds } },
      data: {
        status: ContributionStatus.PLEDGED,
        deliveredQuantity: 0,
        statusReason: null,
        revision: 1,
        checkedInAt: null,
        cancelledAt: null,
      },
    });
    await prisma.need.updateMany({
      where: { id: { in: needIds } },
      data: { status: NeedStatus.ACTIVE, quantityReceived: 0 },
    });
    await prisma.user.updateMany({
      where: { id: { in: [accountTargetAId, accountTargetBId] } },
      data: {
        isActive: true,
        disabledAt: null,
        sessionVersion: 3,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { incidentId: { in: incidentIds } },
          { actorId: { in: userIds } },
          {
            entityId: {
              in: [...contributionIds, accountTargetAId, accountTargetBId],
            },
          },
        ],
      },
    });
    await prisma.incident.deleteMany({ where: { id: { in: incidentIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.municipality.deleteMany({
      where: { id: { in: [municipalityAId, municipalityBId] } },
    });
  });

  it("denies the citizen role access to the PII contribution queue", async () => {
    await expect(
      getContributionQueue({ query: token, pageSize: 100 }),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT", url: "/login" });
  });

  it.each(["COORDINATOR", "MUNICIPAL_ADMIN"] as const)(
    "shows %s only PII belonging to its municipality",
    async (role) => {
      actAs(role);
      const ownQueue = await getContributionQueue({
        incidentId: incidentAId,
        pageSize: 100,
      });
      const foreignQueue = await getContributionQueue({
        incidentId: incidentBId,
        pageSize: 100,
      });

      expect(ownQueue.total).toBe(3);
      expect(ownQueue.items.map((item) => item.citizenName)).toEqual(
        expect.arrayContaining([
          `PII A coordinación ${token}`,
          `PII A administración ${token}`,
          `PII A sin municipio ${token}`,
        ]),
      );
      expect(
        ownQueue.items.every(
          (item) =>
            item.citizenEmail === `pii-a-${token}@example.com` &&
            item.notes === `nota-privada-a-${token}`,
        ),
      ).toBe(true);
      expect(foreignQueue).toMatchObject({ total: 0, items: [] });
    },
  );

  it("shows the super admin PII from all municipalities", async () => {
    actAs("SUPER_ADMIN");
    const queue = await getContributionQueue({ query: token, pageSize: 100 });

    expect(queue.total).toBe(5);
    expect(queue.items.map((item) => item.citizenName)).toEqual(
      expect.arrayContaining([
        `PII A coordinación ${token}`,
        `PII B coordinación ${token}`,
      ]),
    );
    expect(new Set(queue.items.map((item) => item.citizenEmail))).toEqual(
      new Set([`pii-a-${token}@example.com`, `pii-b-${token}@example.com`]),
    );
  });

  it("returns no PII to an operational account without a municipality", async () => {
    actAsUnassignedCoordinator();
    const queue = await getContributionQueue({ query: token, pageSize: 100 });

    expect(queue).toMatchObject({ total: 0, items: [] });
  });

  it("rejects contribution actions for a citizen before reading PII", async () => {
    await expect(
      updateContributionStatus(
        { ok: false, message: "" },
        contributionForm(incidentAId, contributionUnassignedAId),
      ),
    ).rejects.toThrow("UNAUTHORIZED");
    await expect(
      prisma.contribution.findUniqueOrThrow({
        where: { id: contributionUnassignedAId },
      }),
    ).resolves.toMatchObject({
      status: ContributionStatus.PLEDGED,
      revision: 1,
    });
  });

  it.each([
    {
      role: "COORDINATOR" as const,
      ownContribution: () => contributionCoordinatorAId,
      foreignContribution: () => contributionCoordinatorBId,
    },
    {
      role: "MUNICIPAL_ADMIN" as const,
      ownContribution: () => contributionAdminAId,
      foreignContribution: () => contributionAdminBId,
    },
  ])(
    "allows $role to update its municipality and denies another one",
    async ({ role, ownContribution, foreignContribution }) => {
      actAs(role);
      const denied = await updateContributionStatus(
        { ok: false, message: "" },
        contributionForm(incidentBId, foreignContribution()),
      );
      const allowed = await updateContributionStatus(
        { ok: false, message: "" },
        contributionForm(incidentAId, ownContribution()),
      );

      expect(denied.ok).toBe(false);
      expect(allowed).toMatchObject({ ok: true, revision: 2 });
      const [foreign, own] = await Promise.all([
        prisma.contribution.findUniqueOrThrow({
          where: { id: foreignContribution() },
        }),
        prisma.contribution.findUniqueOrThrow({
          where: { id: ownContribution() },
        }),
      ]);
      expect(foreign).toMatchObject({
        status: ContributionStatus.PLEDGED,
        revision: 1,
      });
      expect(own).toMatchObject({
        status: ContributionStatus.EN_ROUTE,
        revision: 2,
      });
      await expect(
        prisma.auditLog.count({
          where: {
            action: "contribution.status_changed",
            actorId: state.actor!.id,
            entityId: ownContribution(),
          },
        }),
      ).resolves.toBe(1);
    },
  );

  it("allows the super admin to update a contribution in another municipality", async () => {
    actAs("SUPER_ADMIN");
    const result = await updateContributionStatus(
      { ok: false, message: "" },
      contributionForm(incidentBId, contributionCoordinatorBId),
    );

    expect(result).toMatchObject({ ok: true, revision: 2 });
    await expect(
      prisma.contribution.findUniqueOrThrow({
        where: { id: contributionCoordinatorBId },
      }),
    ).resolves.toMatchObject({
      status: ContributionStatus.EN_ROUTE,
      revision: 2,
    });
  });

  it("denies contribution actions when an operational account has no municipality", async () => {
    actAsUnassignedCoordinator();
    const result = await updateContributionStatus(
      { ok: false, message: "" },
      contributionForm(incidentAId, contributionUnassignedAId),
    );

    expect(result.ok).toBe(false);
    await expect(
      prisma.contribution.findUniqueOrThrow({
        where: { id: contributionUnassignedAId },
      }),
    ).resolves.toMatchObject({
      status: ContributionStatus.PLEDGED,
      revision: 1,
    });
  });

  it.each(["CITIZEN", "COORDINATOR"] as const)(
    "denies %s account-management actions",
    async (role) => {
      if (role === "COORDINATOR") actAs(role);

      await expect(
        setCoordinatorStatus(accountStatusForm(accountTargetAId)),
      ).rejects.toThrow(role === "CITIZEN" ? "UNAUTHORIZED" : "FORBIDDEN");
      await expect(
        prisma.user.findUniqueOrThrow({ where: { id: accountTargetAId } }),
      ).resolves.toMatchObject({ isActive: true, sessionVersion: 3 });
    },
  );

  it("allows a municipal admin to manage its tenant but not another one", async () => {
    actAs("MUNICIPAL_ADMIN");
    await expectRedirect(
      setCoordinatorStatus(accountStatusForm(accountTargetBId)),
      "/coordinacion/equipo?error=",
    );
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: accountTargetBId } }),
    ).resolves.toMatchObject({ isActive: true, sessionVersion: 3 });

    await expectRedirect(
      setCoordinatorStatus(accountStatusForm(accountTargetAId)),
      "/coordinacion/equipo?notice=",
    );
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: accountTargetAId } }),
    ).resolves.toMatchObject({ isActive: false, sessionVersion: 4 });
  });

  it("allows the super admin to manage an account in any municipality", async () => {
    actAs("SUPER_ADMIN");
    await expectRedirect(
      setCoordinatorStatus(accountStatusForm(accountTargetBId)),
      "/coordinacion/equipo?notice=",
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: accountTargetBId } }),
    ).resolves.toMatchObject({ isActive: false, sessionVersion: 4 });
    await expect(
      prisma.auditLog.count({
        where: {
          action: "user.disabled",
          actorId: superAdminId,
          entityId: accountTargetBId,
        },
      }),
    ).resolves.toBe(1);
  });
});
