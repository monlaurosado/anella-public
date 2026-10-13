import type { Prisma } from "@/generated/prisma/client";
import { IncidentStatus } from "@/generated/prisma/enums";

export type PublicIncidentEligibilityRecord = {
  status: IncidentStatus;
  verifiedAt: Date | null;
  verifiedById: string | null;
  publicLocationApprovedAt: Date | null;
  publicLocationApprovedById: string | null;
};

export const publicIncidentEligibilityWhere = {
  status: {
    in: [IncidentStatus.ACTIVE, IncidentStatus.MONITORING],
  },
  verifiedAt: { not: null },
  verifiedById: { not: null },
  publicLocationApprovedAt: { not: null },
  publicLocationApprovedById: { not: null },
} satisfies Prisma.IncidentWhereInput;

export function isIncidentPubliclyEligible(
  incident: PublicIncidentEligibilityRecord,
) {
  return Boolean(
    (incident.status === IncidentStatus.ACTIVE ||
      incident.status === IncidentStatus.MONITORING) &&
    incident.verifiedAt &&
    incident.verifiedById &&
    incident.publicLocationApprovedAt &&
    incident.publicLocationApprovedById,
  );
}
