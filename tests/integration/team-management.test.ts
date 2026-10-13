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
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("@/lib/dal", () => ({
  requireCoordinator: async () => {
    if (!state.actor) return state.redirect("/login");
    return state.actor;
  },
  assertCoordinator: async () => {
    if (!state.actor) throw new Error("UNAUTHORIZED");
    return state.actor;
  },
}));

import { createCoordinator } from "@/actions/users";
import { OrganizationKind, UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  getMunicipalityDirectory,
  getOrganizationDirectory,
  getTeam,
} from "@/services/users";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

async function redirectedUrl(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    expect(error).toMatchObject({ message: "NEXT_REDIRECT" });
    return (error as Error & { url: string }).url;
  }
  throw new Error("La operación no redirigió.");
}

describe("team management pagination and tenant isolation", () => {
  const token = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const basePassword = "Team-Admin-Initial-2026!";
  const municipalityIds: string[] = [];
  let municipalityAId = "";
  let municipalityBId = "";
  let organizationAId = "";
  let organizationBId = "";
  let municipalAdminId = "";
  let superAdminId = "";

  function actAsMunicipalAdmin() {
    state.actor = {
      id: municipalAdminId,
      name: "Administración municipal TEST",
      email: `municipal-admin-${token}@example.test`,
      role: "MUNICIPAL_ADMIN",
      municipalityId: municipalityAId,
      municipalityName: `TEST directorio ${token} 00`,
      organizationId: organizationAId,
      organizationName: `TEST organización ${token} A 00`,
      mustChangePassword: false,
      sessionVersion: 7,
    };
  }

  function actAsSuperAdmin() {
    state.actor = {
      id: superAdminId,
      name: "Administración global TEST",
      email: `super-admin-${token}@example.test`,
      role: "SUPER_ADMIN",
      municipalityId: null,
      municipalityName: null,
      organizationId: null,
      organizationName: null,
      mustChangePassword: false,
      sessionVersion: 7,
    };
  }

  function createForm(
    email: string,
    tenant: { municipalityId?: string; organizationId?: string } = {},
  ) {
    return form({
      name: "Nueva coordinación TEST",
      email,
      password: "Temporary-Team-Account-2026!",
      currentPassword: basePassword,
      role: "COORDINATOR",
      ...tenant,
    });
  }

  beforeAll(async () => {
    const municipalities = await Promise.all(
      Array.from({ length: 23 }, (_, index) =>
        prisma.municipality.create({
          data: {
            id: `es-test-${token}-${String(index).padStart(2, "0")}`,
            name: `TEST directorio ${token} ${String(index).padStart(2, "0")}`,
            province: `Provincia ${index % 4}`,
            region: `Región ${index % 2}`,
          },
        }),
      ),
    );
    municipalityIds.push(
      ...municipalities.map((municipality) => municipality.id),
    );
    municipalityAId = municipalities[0]!.id;
    municipalityBId = municipalities[1]!.id;

    const organizationsA = await Promise.all(
      Array.from({ length: 13 }, (_, index) =>
        prisma.organization.create({
          data: {
            name: `TEST organización ${token} A ${String(index).padStart(2, "0")}`,
            kind: OrganizationKind.MUNICIPALITY,
            municipalityId: municipalityAId,
          },
        }),
      ),
    );
    organizationAId = organizationsA[0]!.id;
    const organizationB = await prisma.organization.create({
      data: {
        name: `TEST organización ${token} B 00`,
        kind: OrganizationKind.NGO,
        municipalityId: municipalityBId,
      },
    });
    organizationBId = organizationB.id;

    const passwordHash = await hash(basePassword, 4);
    const [municipalAdmin, superAdmin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Administración municipal TEST",
          email: `municipal-admin-${token}@example.test`,
          passwordHash,
          role: UserRole.MUNICIPAL_ADMIN,
          municipalityId: municipalityAId,
          organizationId: organizationAId,
          mustChangePassword: false,
          sessionVersion: 7,
        },
      }),
      prisma.user.create({
        data: {
          name: "Administración global TEST",
          email: `super-admin-${token}@example.test`,
          passwordHash,
          role: UserRole.SUPER_ADMIN,
          mustChangePassword: false,
          sessionVersion: 7,
        },
      }),
    ]);
    municipalAdminId = municipalAdmin.id;
    superAdminId = superAdmin.id;

    await prisma.user.createMany({
      data: [
        ...Array.from({ length: 31 }, (_, index) => ({
          name: `Cuenta A ${String(index).padStart(2, "0")}`,
          email: `account-a-${String(index).padStart(2, "0")}-${token}@example.test`,
          phone: `+34620${String(index).padStart(6, "0")}`,
          role: UserRole.COORDINATOR,
          municipalityId: municipalityAId,
          organizationId: organizationAId,
          mustChangePassword: false,
        })),
        ...Array.from({ length: 4 }, (_, index) => ({
          name: `Cuenta B ${String(index).padStart(2, "0")}`,
          email: `account-b-${String(index).padStart(2, "0")}-${token}@example.test`,
          phone: `+34630${String(index).padStart(6, "0")}`,
          role: UserRole.COORDINATOR,
          municipalityId: municipalityBId,
          organizationId: organizationBId,
          mustChangePassword: false,
        })),
      ],
    });
  });

  beforeEach(() => {
    state.redirect.mockClear();
    state.revalidatePath.mockClear();
    actAsMunicipalAdmin();
  });

  afterAll(async () => {
    state.actor = null;
    await prisma.auditLog.deleteMany({
      where: { municipalityId: { in: municipalityIds } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: token } },
    });
    await prisma.organization.deleteMany({
      where: { municipalityId: { in: municipalityIds } },
    });
    await prisma.municipality.deleteMany({
      where: { id: { in: municipalityIds } },
    });
  });

  it("keeps a municipal admin in its own tenant and clamps before OFFSET", async () => {
    const result = await getTeam({
      municipalityId: municipalityBId,
      page: Number.MAX_SAFE_INTEGER,
      pageSize: 10,
    });

    expect(result.selectedMunicipality?.id).toBe(municipalityAId);
    expect(result.pagination).toMatchObject({
      total: 32,
      page: 4,
      pageCount: 4,
      pageSize: 10,
    });
    expect(result.users).toHaveLength(2);
    expect(
      result.users.every((user) => user.municipalityName.includes("00")),
    ).toBe(true);
    expect(result.users.some((user) => user.email.includes("account-b"))).toBe(
      false,
    );
  });

  it("does not serialize global PII until a super admin selects a municipality", async () => {
    actAsSuperAdmin();
    const unscoped = await getTeam({ query: token, page: 2, pageSize: 100 });

    expect(unscoped).toMatchObject({
      users: [],
      requiresMunicipalitySelection: true,
      municipalitySelectionInvalid: false,
      pagination: { total: 0, page: 1, pageCount: 1 },
    });

    const scoped = await getTeam({
      municipalityId: municipalityBId,
      page: 1,
      pageSize: 10,
    });
    expect(scoped.requiresMunicipalitySelection).toBe(false);
    expect(scoped.pagination.total).toBe(4);
    expect(scoped.users).toHaveLength(4);
    expect(scoped.users.every((user) => user.email.includes("account-b"))).toBe(
      true,
    );
  });

  it("paginates municipality and organization directories without hidden truncation", async () => {
    actAsSuperAdmin();
    const municipalities = await getMunicipalityDirectory({
      query: `TEST directorio ${token}`,
      page: Number.MAX_SAFE_INTEGER,
      pageSize: 10,
    });
    expect(municipalities.pagination).toMatchObject({
      total: 23,
      page: 3,
      pageCount: 3,
    });
    expect(municipalities.municipalities).toHaveLength(3);

    const organizations = await getOrganizationDirectory({
      municipalityId: municipalityAId,
      query: `TEST organización ${token} A`,
      page: 2,
      pageSize: 10,
      selectedOrganizationId: organizationAId,
    });
    expect(organizations.pagination).toMatchObject({
      total: 13,
      page: 2,
      pageCount: 2,
    });
    expect(organizations.organizations).toHaveLength(3);
    expect(organizations.selectedOrganization?.id).toBe(organizationAId);
  });

  it("does not expose the global tenant directory to municipal admins", async () => {
    await expect(
      getMunicipalityDirectory({ query: token }),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(state.redirect).toHaveBeenLastCalledWith("/coordinacion/equipo");
  });

  it("requires an explicit valid tenant when a super admin creates an account", async () => {
    actAsSuperAdmin();
    const validEmail = `created-super-${token}@example.test`;
    const successUrl = await redirectedUrl(
      createCoordinator(
        form({
          ...Object.fromEntries(
            createForm(validEmail, {
              municipalityId: municipalityAId,
              organizationId: organizationAId,
            }).entries(),
          ),
          returnTo: `/coordinacion/equipo?municipalityId=${municipalityAId}&q=Cuenta&page=2`,
        }),
      ),
    );
    expect(successUrl).toContain(`municipalityId=${municipalityAId}`);
    expect(successUrl).toContain("q=Cuenta");
    expect(successUrl).toContain("notice=");
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email: validEmail } }),
    ).resolves.toMatchObject({
      municipalityId: municipalityAId,
      organizationId: organizationAId,
      role: UserRole.COORDINATOR,
    });

    const crossOrganizationEmail = `cross-org-${token}@example.test`;
    const crossOrganizationUrl = await redirectedUrl(
      createCoordinator(
        createForm(crossOrganizationEmail, {
          municipalityId: municipalityAId,
          organizationId: organizationBId,
        }),
      ),
    );
    expect(crossOrganizationUrl).toContain("error=");
    await expect(
      prisma.user.findUnique({ where: { email: crossOrganizationEmail } }),
    ).resolves.toBeNull();

    const noMunicipalityEmail = `no-municipality-${token}@example.test`;
    const noMunicipalityUrl = await redirectedUrl(
      createCoordinator(createForm(noMunicipalityEmail)),
    );
    expect(noMunicipalityUrl).toContain("error=");
    await expect(
      prisma.user.findUnique({ where: { email: noMunicipalityEmail } }),
    ).resolves.toBeNull();
  }, 60_000);

  it("rejects tenant overrides and derives a municipal admin tenant from session", async () => {
    const overrideEmail = `override-${token}@example.test`;
    const overrideUrl = await redirectedUrl(
      createCoordinator(
        createForm(overrideEmail, {
          municipalityId: municipalityBId,
          organizationId: organizationBId,
        }),
      ),
    );
    expect(overrideUrl).toContain("error=");
    await expect(
      prisma.user.findUnique({ where: { email: overrideEmail } }),
    ).resolves.toBeNull();

    const validEmail = `created-municipal-${token}@example.test`;
    const successUrl = await redirectedUrl(
      createCoordinator(createForm(validEmail)),
    );
    expect(successUrl).toContain("notice=");
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email: validEmail } }),
    ).resolves.toMatchObject({
      municipalityId: municipalityAId,
      organizationId: organizationAId,
    });
  }, 60_000);
});
