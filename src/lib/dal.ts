import "server-only";

import { cache } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import {
  OrganizationVerificationStatus,
  type UserRole,
} from "@/generated/prisma/enums";
import { authOptions } from "@/lib/auth";
import { isCoordinatorRole } from "@/lib/authorization";
import { prisma } from "@/lib/db";

export type CoordinatorContext = {
  id: string;
  name: string;
  email: string;
  role: Extract<UserRole, "COORDINATOR" | "MUNICIPAL_ADMIN" | "SUPER_ADMIN">;
  municipalityId: string | null;
  municipalityName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  mustChangePassword: boolean;
  sessionVersion: number;
};

type CoordinatorAccessOptions = {
  allowPasswordChangeRequired?: boolean;
};

export const getCurrentCoordinator = cache(
  async (): Promise<CoordinatorContext | null> => {
    const session = await getServerSession(authOptions);

    if (
      !session?.user?.id ||
      typeof session.user.sessionVersion !== "number" ||
      typeof session.user.mustChangePassword !== "boolean"
    ) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        sessionVersion: true,
        disabledAt: true,
        municipalityId: true,
        organizationId: true,
        municipality: { select: { name: true } },
        organization: {
          select: { name: true, verificationStatus: true },
        },
      },
    });

    if (
      !user?.isActive ||
      user.disabledAt !== null ||
      !isCoordinatorRole(user.role) ||
      user.sessionVersion !== session.user.sessionVersion ||
      user.mustChangePassword !== session.user.mustChangePassword
    ) {
      return null;
    }
    if (
      user.role === "COORDINATOR" &&
      (!user.municipalityId ||
        !user.organizationId ||
        user.organization?.verificationStatus !==
          OrganizationVerificationStatus.VERIFIED)
    ) {
      return null;
    }

    return {
      id: user.id,
      name: user.name ?? user.email,
      email: user.email,
      role: user.role,
      municipalityId: user.municipalityId,
      municipalityName: user.municipality?.name ?? null,
      organizationId: user.organizationId,
      organizationName: user.organization?.name ?? null,
      mustChangePassword: user.mustChangePassword,
      sessionVersion: user.sessionVersion,
    };
  },
);

export async function requireCoordinator(
  options: CoordinatorAccessOptions = {},
) {
  const coordinator = await getCurrentCoordinator();

  if (!coordinator) {
    redirect("/login");
  }

  if (coordinator.mustChangePassword && !options.allowPasswordChangeRequired) {
    redirect("/coordinacion/cuenta");
  }

  return coordinator;
}

export async function assertCoordinator(
  options: CoordinatorAccessOptions = {},
) {
  const coordinator = await getCurrentCoordinator();

  if (!coordinator) {
    throw new Error("UNAUTHORIZED");
  }

  if (coordinator.mustChangePassword && !options.allowPasswordChangeRequired) {
    throw new Error("PASSWORD_CHANGE_REQUIRED");
  }

  return coordinator;
}

export function incidentScopeWhere(coordinator: CoordinatorContext) {
  if (coordinator.role === "SUPER_ADMIN") {
    return {};
  }

  const municipalityId = coordinator.municipalityId ?? "__none__";
  if (coordinator.role === "MUNICIPAL_ADMIN") return { municipalityId };

  const organizationId = coordinator.organizationId ?? "__none__";
  return {
    AND: [
      {
        OR: [
          { municipalityId },
          { affectedMunicipalities: { some: { municipalityId } } },
        ],
      },
      {
        OR: [
          { organizationId },
          {
            origin: "DETECTION_CANDIDATE" as const,
            organizationId: null,
          },
        ],
      },
    ],
  };
}
