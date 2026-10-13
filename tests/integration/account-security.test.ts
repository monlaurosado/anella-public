import { compare, hash } from "bcryptjs";
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
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("@/lib/dal", () => ({
  assertCoordinator: async () => {
    if (!state.actor) throw new Error("UNAUTHORIZED");
    return state.actor;
  },
}));

import {
  changeOwnPassword,
  createCoordinator,
  resetCoordinatorPassword,
  setCoordinatorStatus,
} from "@/actions/users";
import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function confirmedForm(
  entries: Record<string, string>,
  reason = "Solicitud verificada por administración",
) {
  return form({
    currentPassword: "Initial-Account-2026!",
    ...entries,
    reason,
    confirmSensitiveAction: "confirmed",
  });
}

async function expectRedirect(operation: Promise<unknown>, path: string) {
  await expect(operation).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
  expect(state.redirect).toHaveBeenLastCalledWith(
    expect.stringContaining(path),
  );
}

describe("account lifecycle and session revocation", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ids: string[] = [];
  let municipalityAId = "";
  let municipalityBId = "";
  let adminId = "";
  let disableTargetId = "";
  let resetTargetId = "";
  let changeTargetId = "";
  let crossTenantTargetId = "";
  let initialPasswordHash = "";
  const basePassword = "Initial-Account-2026!";

  beforeAll(async () => {
    const [municipalityA, municipalityB] = await Promise.all([
      prisma.municipality.create({
        data: { name: `TEST cuentas A ${suffix}` },
      }),
      prisma.municipality.create({
        data: { name: `TEST cuentas B ${suffix}` },
      }),
    ]);
    municipalityAId = municipalityA.id;
    municipalityBId = municipalityB.id;
    const passwordHash = await hash(basePassword, 4);
    initialPasswordHash = passwordHash;

    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: "Administración de pruebas",
          email: `admin-${suffix}@example.com`,
          passwordHash,
          role: UserRole.MUNICIPAL_ADMIN,
          municipalityId: municipalityAId,
          mustChangePassword: false,
          sessionVersion: 10,
        },
      }),
      ...["disable", "reset", "change"].map((label) =>
        prisma.user.create({
          data: {
            name: `Coordinación ${label}`,
            email: `${label}-${suffix}@example.com`,
            passwordHash,
            role: UserRole.COORDINATOR,
            municipalityId: municipalityAId,
            mustChangePassword: false,
            sessionVersion: 10,
          },
        }),
      ),
      prisma.user.create({
        data: {
          name: "Coordinación de otro municipio",
          email: `cross-${suffix}@example.com`,
          passwordHash,
          role: UserRole.COORDINATOR,
          municipalityId: municipalityBId,
          mustChangePassword: false,
          sessionVersion: 10,
        },
      }),
    ]);

    [
      adminId,
      disableTargetId,
      resetTargetId,
      changeTargetId,
      crossTenantTargetId,
    ] = users.map((user) => user.id);
    ids.push(...users.map((user) => user.id));
  });

  beforeEach(async () => {
    state.redirect.mockClear();
    state.revalidatePath.mockClear();
    await prisma.auditLog.deleteMany({
      where: {
        entityType: "User",
        entityId: {
          in: [
            disableTargetId,
            resetTargetId,
            changeTargetId,
            crossTenantTargetId,
          ],
        },
      },
    });
    await prisma.user.updateMany({
      where: {
        id: {
          in: [
            disableTargetId,
            resetTargetId,
            changeTargetId,
            crossTenantTargetId,
          ],
        },
      },
      data: {
        passwordHash: initialPasswordHash,
        isActive: true,
        disabledAt: null,
        mustChangePassword: false,
        credentialsChangedAt: null,
        sessionVersion: 10,
      },
    });
    state.actor = {
      id: adminId,
      name: "Administración de pruebas",
      email: `admin-${suffix}@example.com`,
      role: "MUNICIPAL_ADMIN",
      municipalityId: municipalityAId,
      municipalityName: "Municipio A",
      organizationId: null,
      organizationName: null,
      mustChangePassword: false,
      sessionVersion: 10,
    };
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.municipality.deleteMany({
      where: { id: { in: [municipalityAId, municipalityBId] } },
    });
  });

  it("creates a municipal account with a temporary password and audited forced change", async () => {
    const email = `created-${suffix}@example.com`;
    await expectRedirect(
      createCoordinator(
        form({
          name: "Nueva coordinación",
          email,
          phone: "+34600111222",
          password: "Temporary-New-2026!",
          currentPassword: basePassword,
          role: "COORDINATOR",
        }),
      ),
      "/coordinacion/equipo?notice=",
    );

    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    ids.push(created.id);
    expect(created).toMatchObject({
      municipalityId: municipalityAId,
      role: UserRole.COORDINATOR,
      mustChangePassword: true,
      sessionVersion: 1,
    });
    expect(await compare("Temporary-New-2026!", created.passwordHash!)).toBe(
      true,
    );
    await expect(
      prisma.auditLog.count({
        where: {
          action: "user.created",
          entityId: created.id,
          actorId: adminId,
        },
      }),
    ).resolves.toBe(1);
  });

  it("invalidates existing sessions whenever an account is disabled", async () => {
    const reason = "Baja autorizada por administración municipal";
    await expectRedirect(
      setCoordinatorStatus(
        confirmedForm(
          { userId: disableTargetId, statusAction: "deactivate" },
          reason,
        ),
      ),
      "/coordinacion/equipo?notice=",
    );

    const disabled = await prisma.user.findUniqueOrThrow({
      where: { id: disableTargetId },
    });
    expect(disabled.isActive).toBe(false);
    expect(disabled.disabledAt).toBeInstanceOf(Date);
    expect(disabled.sessionVersion).toBe(11);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "user.disabled",
        entityId: disableTargetId,
        actorId: adminId,
      },
    });
    expect(audit.metadata).toEqual({
      reason,
      explicitlyConfirmed: true,
      before: {
        isActive: true,
        disabledAt: null,
        sessionVersion: 10,
      },
      after: {
        isActive: false,
        disabledAt: disabled.disabledAt?.toISOString(),
        sessionVersion: 11,
      },
    });

    await expectRedirect(
      setCoordinatorStatus(
        confirmedForm({
          userId: disableTargetId,
          statusAction: "deactivate",
        }),
      ),
      "/coordinacion/equipo?error=",
    );
    await expect(
      prisma.auditLog.count({
        where: { action: "user.disabled", entityId: disableTargetId },
      }),
    ).resolves.toBe(1);
  });

  it("rejects account status changes without both a reason and explicit confirmation", async () => {
    await expectRedirect(
      setCoordinatorStatus(
        form({
          userId: disableTargetId,
          statusAction: "deactivate",
          currentPassword: basePassword,
          confirmSensitiveAction: "confirmed",
        }),
      ),
      "/coordinacion/equipo?error=",
    );
    await expectRedirect(
      setCoordinatorStatus(
        form({
          userId: disableTargetId,
          statusAction: "deactivate",
          reason: "Baja autorizada por administración municipal",
          currentPassword: basePassword,
        }),
      ),
      "/coordinacion/equipo?error=",
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: disableTargetId } }),
    ).resolves.toMatchObject({
      isActive: true,
      disabledAt: null,
      sessionVersion: 10,
    });
    await expect(
      prisma.auditLog.count({ where: { entityId: disableTargetId } }),
    ).resolves.toBe(0);
  });

  it("uses an explicit target state when reactivating and audits the full transition", async () => {
    await expectRedirect(
      setCoordinatorStatus(
        confirmedForm({
          userId: disableTargetId,
          statusAction: "deactivate",
        }),
      ),
      "/coordinacion/equipo?notice=",
    );
    const reason = "Reincorporación autorizada por administración";
    await expectRedirect(
      setCoordinatorStatus(
        confirmedForm(
          { userId: disableTargetId, statusAction: "activate" },
          reason,
        ),
      ),
      "/coordinacion/equipo?notice=",
    );

    const enabled = await prisma.user.findUniqueOrThrow({
      where: { id: disableTargetId },
    });
    expect(enabled).toMatchObject({
      isActive: true,
      disabledAt: null,
      sessionVersion: 12,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.enabled", entityId: disableTargetId },
    });
    expect(audit.metadata).toMatchObject({
      reason,
      explicitlyConfirmed: true,
      before: { isActive: false, sessionVersion: 11 },
      after: {
        isActive: true,
        disabledAt: null,
        sessionVersion: 12,
      },
    });
  });

  it("resets a password, revokes sessions and requires a first-access change", async () => {
    const temporaryPassword = "Temporary-Reset-2026!";
    const reason = "Identidad verificada tras pérdida de credenciales";
    await expectRedirect(
      resetCoordinatorPassword(
        confirmedForm(
          { userId: resetTargetId, password: temporaryPassword },
          reason,
        ),
      ),
      "/coordinacion/equipo?notice=",
    );

    const reset = await prisma.user.findUniqueOrThrow({
      where: { id: resetTargetId },
    });
    expect(reset.mustChangePassword).toBe(true);
    expect(reset.sessionVersion).toBe(11);
    expect(await compare(temporaryPassword, reset.passwordHash!)).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "user.password_reset",
        entityId: resetTargetId,
        actorId: adminId,
      },
    });
    expect(audit.metadata).toEqual({
      reason,
      explicitlyConfirmed: true,
      passwordReplaced: true,
      before: {
        mustChangePassword: false,
        credentialsChangedAt: null,
        sessionVersion: 10,
      },
      after: {
        mustChangePassword: true,
        credentialsChangedAt: reset.credentialsChangedAt?.toISOString(),
        sessionVersion: 11,
      },
    });
  });

  it("does not reset credentials without both a reason and explicit confirmation", async () => {
    await expectRedirect(
      resetCoordinatorPassword(
        form({
          userId: resetTargetId,
          password: "Temporary-Reset-2026!",
          reason: "Solicitud verificada por administración",
          currentPassword: basePassword,
        }),
      ),
      "/coordinacion/equipo?error=",
    );

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { id: resetTargetId },
    });
    expect(untouched).toMatchObject({
      mustChangePassword: false,
      sessionVersion: 10,
    });
    expect(await compare(basePassword, untouched.passwordHash!)).toBe(true);
    await expect(
      prisma.auditLog.count({ where: { entityId: resetTargetId } }),
    ).resolves.toBe(0);
  });

  it("cannot manage a coordinator belonging to another municipality", async () => {
    await expectRedirect(
      setCoordinatorStatus(
        confirmedForm({
          userId: crossTenantTargetId,
          statusAction: "deactivate",
        }),
      ),
      "/coordinacion/equipo?error=",
    );

    await expectRedirect(
      resetCoordinatorPassword(
        confirmedForm({
          userId: crossTenantTargetId,
          password: "Temporary-Cross-2026!",
        }),
      ),
      "/coordinacion/equipo?error=",
    );

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { id: crossTenantTargetId },
    });
    expect(untouched).toMatchObject({
      isActive: true,
      mustChangePassword: false,
      sessionVersion: 10,
    });
    expect(await compare(basePassword, untouched.passwordHash!)).toBe(true);
    await expect(
      prisma.auditLog.count({ where: { entityId: crossTenantTargetId } }),
    ).resolves.toBe(0);
  });

  it("requires the administrator password again for sensitive account actions", async () => {
    await expectRedirect(
      setCoordinatorStatus(
        confirmedForm({
          userId: disableTargetId,
          statusAction: "deactivate",
          currentPassword: "Wrong-Administrator-Password-2026!",
        }),
      ),
      "/coordinacion/equipo?error=",
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: disableTargetId } }),
    ).resolves.toMatchObject({ isActive: true, sessionVersion: 10 });
    await expect(
      prisma.auditLog.count({
        where: {
          action: "auth.sensitive_step_up_failed",
          actorId: adminId,
        },
      }),
    ).resolves.toBeGreaterThan(0);
  });

  it("changes the current password, clears the temporary flag and revokes the old session", async () => {
    state.actor = {
      ...state.actor!,
      id: changeTargetId,
      email: `change-${suffix}@example.com`,
      role: "COORDINATOR",
      sessionVersion: 10,
      mustChangePassword: true,
    };
    const newPassword = "Changed-Account-2026!";

    await expectRedirect(
      changeOwnPassword(
        form({
          currentPassword: basePassword,
          newPassword,
          confirmation: newPassword,
        }),
      ),
      "/login?notice=",
    );

    const changed = await prisma.user.findUniqueOrThrow({
      where: { id: changeTargetId },
    });
    expect(changed.mustChangePassword).toBe(false);
    expect(changed.sessionVersion).toBe(11);
    expect(await compare(newPassword, changed.passwordHash!)).toBe(true);
    expect(await compare(basePassword, changed.passwordHash!)).toBe(false);
    await expect(
      prisma.auditLog.count({
        where: { action: "user.password_changed", entityId: changeTargetId },
      }),
    ).resolves.toBe(1);
  });
});
