import type { UserRole } from "@/generated/prisma/enums";

const coordinatorRoles: UserRole[] = [
  "COORDINATOR",
  "MUNICIPAL_ADMIN",
  "SUPER_ADMIN",
];

export function isCoordinatorRole(
  role: UserRole | null | undefined,
): role is Extract<
  UserRole,
  "COORDINATOR" | "MUNICIPAL_ADMIN" | "SUPER_ADMIN"
> {
  return Boolean(role && coordinatorRoles.includes(role));
}

export function canManageMunicipality(
  role: UserRole,
  userMunicipalityId: string | null,
  resourceMunicipalityId: string | null,
) {
  if (!isCoordinatorRole(role)) {
    return false;
  }

  if (role === "SUPER_ADMIN") {
    return true;
  }

  return Boolean(
    userMunicipalityId && userMunicipalityId === resourceMunicipalityId,
  );
}
