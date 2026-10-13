import { describe, expect, it } from "vitest";

import { can, roleCapabilities, type Role } from "@/lib/security";

describe("complete role capability matrix", () => {
  const expectations: Record<Role, readonly string[]> = {
    CITIZEN: ["view_public_incidents", "pledge_contribution"],
    COORDINATOR: [
      "view_public_incidents",
      "create_incident",
      "manage_safe_points",
      "manage_needs",
      "validate_contributions",
    ],
    MUNICIPAL_ADMIN: [
      "view_public_incidents",
      "create_incident",
      "manage_safe_points",
      "manage_needs",
      "validate_contributions",
      "manage_coordinators",
      "view_municipal_stats",
    ],
    SUPER_ADMIN: [
      "view_public_incidents",
      "create_incident",
      "manage_safe_points",
      "manage_needs",
      "validate_contributions",
      "manage_coordinators",
      "view_municipal_stats",
      "manage_all_municipalities",
    ],
  };

  it.each(Object.entries(expectations) as Array<[Role, readonly string[]]>)(
    "%s exposes exactly its declared capabilities",
    (role, capabilities) => {
      expect(roleCapabilities[role]).toEqual(capabilities);
    },
  );

  it("keeps privileged operations out of lower roles", () => {
    expect(can("CITIZEN", "create_incident")).toBe(false);
    expect(can("CITIZEN", "manage_coordinators")).toBe(false);
    expect(can("COORDINATOR", "manage_coordinators")).toBe(false);
    expect(can("MUNICIPAL_ADMIN", "manage_coordinators")).toBe(true);
    expect(can("MUNICIPAL_ADMIN", "manage_all_municipalities")).toBe(false);
    expect(can("SUPER_ADMIN", "manage_all_municipalities")).toBe(true);
  });
});
