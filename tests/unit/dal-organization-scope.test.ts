import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { incidentScopeWhere, type CoordinatorContext } from "@/lib/dal";

function context(role: CoordinatorContext["role"]): CoordinatorContext {
  return {
    id: "actor",
    name: "Actor TEST",
    email: "actor@example.test",
    role,
    municipalityId: role === "SUPER_ADMIN" ? null : "municipality-a",
    municipalityName: role === "SUPER_ADMIN" ? null : "Municipio A",
    organizationId: role === "COORDINATOR" ? "organization-a" : null,
    organizationName: role === "COORDINATOR" ? "Organización A" : null,
    mustChangePassword: false,
    sessionVersion: 1,
  };
}

describe("incident organization and municipality scope", () => {
  it("limits coordinators to their verified organization plus unclaimed local candidates", () => {
    expect(incidentScopeWhere(context("COORDINATOR"))).toEqual({
      AND: [
        {
          OR: [
            { municipalityId: "municipality-a" },
            {
              affectedMunicipalities: {
                some: { municipalityId: "municipality-a" },
              },
            },
          ],
        },
        {
          OR: [
            { organizationId: "organization-a" },
            { origin: "DETECTION_CANDIDATE", organizationId: null },
          ],
        },
      ],
    });
  });

  it("keeps municipal administration municipal and superadministration global", () => {
    expect(incidentScopeWhere(context("MUNICIPAL_ADMIN"))).toEqual({
      municipalityId: "municipality-a",
    });
    expect(incidentScopeWhere(context("SUPER_ADMIN"))).toEqual({});
  });
});
