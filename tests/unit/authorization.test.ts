import { describe, expect, it } from "vitest";

import type { UserRole } from "@/generated/prisma/enums";
import { canManageMunicipality, isCoordinatorRole } from "@/lib/authorization";

describe("authorization", () => {
  const roleExpectations: Array<[UserRole | null | undefined, boolean]> = [
    ["CITIZEN", false],
    ["COORDINATOR", true],
    ["MUNICIPAL_ADMIN", true],
    ["SUPER_ADMIN", true],
    [null, false],
    [undefined, false],
  ];

  it.each(roleExpectations)(
    "recognizes whether %s is an operational role",
    (role, expected) => {
      expect(isCoordinatorRole(role)).toBe(expected);
    },
  );

  const municipalityCases: Array<{
    label: string;
    userMunicipalityId: string | null;
    resourceMunicipalityId: string | null;
    expected: Record<UserRole, boolean>;
  }> = [
    {
      label: "same municipality",
      userMunicipalityId: "m1",
      resourceMunicipalityId: "m1",
      expected: {
        CITIZEN: false,
        COORDINATOR: true,
        MUNICIPAL_ADMIN: true,
        SUPER_ADMIN: true,
      },
    },
    {
      label: "different municipality",
      userMunicipalityId: "m1",
      resourceMunicipalityId: "m2",
      expected: {
        CITIZEN: false,
        COORDINATOR: false,
        MUNICIPAL_ADMIN: false,
        SUPER_ADMIN: true,
      },
    },
    {
      label: "actor without municipality",
      userMunicipalityId: null,
      resourceMunicipalityId: "m1",
      expected: {
        CITIZEN: false,
        COORDINATOR: false,
        MUNICIPAL_ADMIN: false,
        SUPER_ADMIN: true,
      },
    },
    {
      label: "resource without municipality",
      userMunicipalityId: "m1",
      resourceMunicipalityId: null,
      expected: {
        CITIZEN: false,
        COORDINATOR: false,
        MUNICIPAL_ADMIN: false,
        SUPER_ADMIN: true,
      },
    },
    {
      label: "neither actor nor resource has a municipality",
      userMunicipalityId: null,
      resourceMunicipalityId: null,
      expected: {
        CITIZEN: false,
        COORDINATOR: false,
        MUNICIPAL_ADMIN: false,
        SUPER_ADMIN: true,
      },
    },
  ];

  const roles: UserRole[] = [
    "CITIZEN",
    "COORDINATOR",
    "MUNICIPAL_ADMIN",
    "SUPER_ADMIN",
  ];

  it.each(
    roles.flatMap((role) =>
      municipalityCases.map((municipalityCase) => ({
        role,
        ...municipalityCase,
      })),
    ),
  )("authorizes $role for $label: $expected.$role", (testCase) => {
    expect(
      canManageMunicipality(
        testCase.role,
        testCase.userMunicipalityId,
        testCase.resourceMunicipalityId,
      ),
    ).toBe(testCase.expected[testCase.role]);
  });
});
