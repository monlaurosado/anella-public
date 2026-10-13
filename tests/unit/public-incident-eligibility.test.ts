import { describe, expect, it } from "vitest";

import { IncidentStatus } from "@/generated/prisma/enums";
import {
  isIncidentPubliclyEligible,
  publicIncidentEligibilityWhere,
  type PublicIncidentEligibilityRecord,
} from "@/lib/public-incident-eligibility";

const completeApproval = {
  status: IncidentStatus.ACTIVE,
  verifiedAt: new Date("2026-07-13T10:00:00.000Z"),
  verifiedById: "validator-1",
  publicLocationApprovedAt: new Date("2026-07-13T10:05:00.000Z"),
  publicLocationApprovedById: "approver-1",
};

function matchesPublicIncidentEligibilityWhere(
  incident: PublicIncidentEligibilityRecord,
) {
  return Boolean(
    publicIncidentEligibilityWhere.status.in.some(
      (status) => status === incident.status,
    ) &&
    incident.verifiedAt !== publicIncidentEligibilityWhere.verifiedAt.not &&
    incident.verifiedById !== publicIncidentEligibilityWhere.verifiedById.not &&
    incident.publicLocationApprovedAt !==
      publicIncidentEligibilityWhere.publicLocationApprovedAt.not &&
    incident.publicLocationApprovedById !==
      publicIncidentEligibilityWhere.publicLocationApprovedById.not,
  );
}

describe("isIncidentPubliclyEligible", () => {
  it("accepts only active or monitoring incidents with complete provenance", () => {
    expect(isIncidentPubliclyEligible(completeApproval)).toBe(true);
    expect(
      isIncidentPubliclyEligible({
        ...completeApproval,
        status: IncidentStatus.MONITORING,
      }),
    ).toBe(true);
  });

  it.each([
    ["verifiedAt", null],
    ["verifiedById", null],
    ["publicLocationApprovedAt", null],
    ["publicLocationApprovedById", null],
  ] as const)("fails closed when %s is missing", (field, value) => {
    expect(
      isIncidentPubliclyEligible({ ...completeApproval, [field]: value }),
    ).toBe(false);
  });

  it("rejects non-public incident statuses", () => {
    expect(
      isIncidentPubliclyEligible({
        ...completeApproval,
        status: IncidentStatus.RESOLVED,
      }),
    ).toBe(false);
  });

  it("keeps the in-memory guard aligned with the shared Prisma filter", () => {
    const candidates: PublicIncidentEligibilityRecord[] = [
      ...Object.values(IncidentStatus).map((status) => ({
        ...completeApproval,
        status,
      })),
      ...(
        [
          "verifiedAt",
          "verifiedById",
          "publicLocationApprovedAt",
          "publicLocationApprovedById",
        ] as const
      ).map((field) => ({ ...completeApproval, [field]: null })),
    ];

    for (const candidate of candidates) {
      expect(isIncidentPubliclyEligible(candidate)).toBe(
        matchesPublicIncidentEligibilityWhere(candidate),
      );
    }
  });
});
