import "server-only";

import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";
import { requireCoordinator } from "@/lib/dal";
import { prisma } from "@/lib/db";

const manageableRoles = [UserRole.COORDINATOR, UserRole.MUNICIPAL_ADMIN];
const teamPageSizes = new Set([10, 25, 50, 100]);
const directoryPageSizes = new Set([10, 25, 50]);

type PageOptions = {
  page?: number;
  pageSize?: number;
};

export type TeamOptions = PageOptions & {
  query?: string;
  municipalityId?: string;
};

export type MunicipalityDirectoryOptions = PageOptions & {
  query?: string;
};

export type OrganizationDirectoryOptions = PageOptions & {
  municipalityId: string;
  query?: string;
  selectedOrganizationId?: string;
};

function requestedPage(value: number | undefined) {
  return Number.isSafeInteger(value) && value! > 0 ? value! : 1;
}

function requestedPageSize(
  value: number | undefined,
  allowed: Set<number>,
  fallback: number,
) {
  return Number.isSafeInteger(value) && allowed.has(value!) ? value! : fallback;
}

function pagination(total: number, requested: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, pageCount);
  return { page, pageSize, pageCount, total };
}

function normalizedQuery(value: string | undefined) {
  return value?.trim() ?? "";
}

function normalizedId(value: string | undefined) {
  const id = value?.trim();
  return id ? id : undefined;
}

async function requireTeamAdmin() {
  const coordinator = await requireCoordinator();
  if (
    coordinator.role !== UserRole.MUNICIPAL_ADMIN &&
    coordinator.role !== UserRole.SUPER_ADMIN
  ) {
    redirect("/coordinacion");
  }
  return coordinator;
}

async function requireSuperAdmin() {
  const coordinator = await requireTeamAdmin();
  if (coordinator.role !== UserRole.SUPER_ADMIN) {
    redirect("/coordinacion/equipo");
  }
  return coordinator;
}

export async function getTeam(options: TeamOptions = {}) {
  const coordinator = await requireTeamAdmin();
  const query = normalizedQuery(options.query);
  const requested = requestedPage(options.page);
  const pageSize = requestedPageSize(options.pageSize, teamPageSizes, 25);
  const selectedMunicipalityId =
    coordinator.role === UserRole.SUPER_ADMIN
      ? normalizedId(options.municipalityId)
      : (coordinator.municipalityId ?? undefined);
  const selectedMunicipality = selectedMunicipalityId
    ? await prisma.municipality.findUnique({
        where: { id: selectedMunicipalityId },
        select: {
          id: true,
          name: true,
          province: true,
          region: true,
          country: true,
        },
      })
    : null;
  const requiresMunicipalitySelection =
    coordinator.role === UserRole.SUPER_ADMIN && !selectedMunicipalityId;
  const municipalitySelectionInvalid =
    coordinator.role === UserRole.SUPER_ADMIN &&
    Boolean(selectedMunicipalityId) &&
    !selectedMunicipality;

  if (!selectedMunicipality) {
    return {
      coordinator,
      users: [],
      selectedMunicipality: null,
      requiresMunicipalitySelection,
      municipalitySelectionInvalid,
      filters: { query, municipalityId: selectedMunicipalityId ?? "" },
      pagination: pagination(0, requested, pageSize),
    };
  }

  const where = {
    municipalityId: selectedMunicipality.id,
    role: { in: manageableRoles },
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { email: { contains: query } },
            { phone: { contains: query } },
            { organization: { name: { contains: query } } },
          ],
        }
      : {}),
  } satisfies Prisma.UserWhereInput;
  const total = await prisma.user.count({ where });
  const page = pagination(total, requested, pageSize);
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      disabledAt: true,
      lastLoginAt: true,
      organization: { select: { name: true } },
      createdAt: true,
    },
    orderBy: [
      { isActive: "desc" },
      { name: "asc" },
      { email: "asc" },
      { id: "asc" },
    ],
    skip: (page.page - 1) * page.pageSize,
    take: page.pageSize,
  });

  return {
    coordinator,
    selectedMunicipality,
    requiresMunicipalitySelection,
    municipalitySelectionInvalid,
    filters: { query, municipalityId: selectedMunicipality.id },
    pagination: page,
    users: users.map((user) => ({
      ...user,
      disabledAt: user.disabledAt?.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString(),
      createdAt: user.createdAt.toISOString(),
      municipalityName: selectedMunicipality.name,
      organizationName: user.organization?.name,
    })),
  };
}

export async function getMunicipalityDirectory(
  options: MunicipalityDirectoryOptions = {},
) {
  await requireSuperAdmin();
  const query = normalizedQuery(options.query);
  const requested = requestedPage(options.page);
  const pageSize = requestedPageSize(options.pageSize, directoryPageSizes, 10);
  const where = {
    id: { startsWith: "es-" },
    country: "ES",
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { province: { contains: query } },
            { region: { contains: query } },
            { country: { contains: query } },
          ],
        }
      : {}),
  } satisfies Prisma.MunicipalityWhereInput;
  const total = await prisma.municipality.count({ where });
  const page = pagination(total, requested, pageSize);
  const municipalities = await prisma.municipality.findMany({
    where,
    select: {
      id: true,
      name: true,
      province: true,
      region: true,
      country: true,
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page.page - 1) * page.pageSize,
    take: page.pageSize,
  });

  return { municipalities, filters: { query }, pagination: page };
}

export async function getOrganizationDirectory(
  options: OrganizationDirectoryOptions,
) {
  await requireSuperAdmin();
  const municipalityId = normalizedId(options.municipalityId);
  const query = normalizedQuery(options.query);
  const requested = requestedPage(options.page);
  const pageSize = requestedPageSize(options.pageSize, directoryPageSizes, 10);

  if (!municipalityId) {
    return {
      organizations: [],
      selectedOrganization: null,
      organizationSelectionInvalid: Boolean(options.selectedOrganizationId),
      filters: { query, municipalityId: "" },
      pagination: pagination(0, requested, pageSize),
    };
  }

  const where = {
    municipalityId,
    ...(query ? { name: { contains: query } } : {}),
  } satisfies Prisma.OrganizationWhereInput;
  const total = await prisma.organization.count({ where });
  const page = pagination(total, requested, pageSize);
  const selectedOrganizationId = normalizedId(options.selectedOrganizationId);
  const [organizations, selectedOrganization] = await Promise.all([
    prisma.organization.findMany({
      where,
      select: { id: true, name: true, kind: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    selectedOrganizationId
      ? prisma.organization.findFirst({
          where: { id: selectedOrganizationId, municipalityId },
          select: { id: true, name: true, kind: true },
        })
      : null,
  ]);

  return {
    organizations,
    selectedOrganization,
    organizationSelectionInvalid:
      Boolean(selectedOrganizationId) && !selectedOrganization,
    filters: { query, municipalityId },
    pagination: page,
  };
}

export async function getAccount() {
  return requireCoordinator({ allowPasswordChangeRequired: true });
}
