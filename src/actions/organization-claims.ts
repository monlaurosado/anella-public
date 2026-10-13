"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { UserRole } from "@/generated/prisma/enums";
import { getClientIp } from "@/lib/client-ip";
import { assertCoordinator } from "@/lib/dal";
import { prisma } from "@/lib/db";
import {
  createOrganizationClaim,
  decideOrganizationClaim,
  verifyOrganizationClaimToken,
} from "@/services/organization-claims";
import { consumeRateLimit } from "@/services/rate-limit";

const requestSchema = z.object({
  organizationId: z.string().min(1).max(191),
  claimantName: z.string().trim().min(2).max(191),
  claimantEmail: z
    .email()
    .max(191)
    .transform((value) => value.toLowerCase()),
});

export async function requestOrganizationClaim(formData: FormData) {
  const parsed = requestSchema.safeParse({
    organizationId: formData.get("organizationId"),
    claimantName: formData.get("claimantName"),
    claimantEmail: formData.get("claimantEmail"),
  });
  if (!parsed.success)
    redirect("/organizaciones/reclamar?error=Revisa+los+datos+indicados");
  const ip = getClientIp(await headers());
  const ipAllowed = await consumeRateLimit({
    action: "organization-claim-ip",
    identity: ip,
    limit: 10,
    windowMinutes: 60,
  });
  if (!ipAllowed)
    redirect(
      "/organizaciones/reclamar?error=Demasiados+intentos.+Prueba+más+tarde",
    );
  const emailAllowed = await consumeRateLimit({
    action: "organization-claim-identity",
    identity: `${ip}:${parsed.data.claimantEmail}`,
    limit: 3,
    windowMinutes: 60,
  });
  if (!emailAllowed)
    redirect(
      "/organizaciones/reclamar?error=Demasiados+intentos.+Prueba+más+tarde",
    );

  try {
    await createOrganizationClaim(parsed.data);
  } catch {
    // Deliberately use the same response for duplicates, unknown entities and
    // policy rejection so this public endpoint cannot enumerate claim state.
  }
  redirect("/organizaciones/reclamar?enviado=1");
}

export async function verifyOrganizationClaim(formData: FormData) {
  const token = z.string().min(40).max(80).safeParse(formData.get("token"));
  if (!token.success)
    redirect("/organizaciones/reclamar?error=Enlace+no+válido");
  const result = await verifyOrganizationClaimToken(token.data);
  redirect(
    result.ok
      ? "/organizaciones/reclamar?verificado=1"
      : "/organizaciones/reclamar?error=El+enlace+ha+caducado+o+ya+fue+utilizado",
  );
}

export async function reviewOrganizationClaim(formData: FormData) {
  const coordinator = await assertCoordinator();
  if (coordinator.role !== UserRole.SUPER_ADMIN) {
    redirect(
      "/coordinacion/organizaciones?error=No+tienes+permiso+para+revisar+solicitudes",
    );
  }
  const parsed = z
    .object({
      claimId: z.string().min(1).max(191),
      decision: z.enum(["approve", "reject"]),
      reason: z.string().trim().min(8).max(500),
    })
    .safeParse({
      claimId: formData.get("claimId"),
      decision: formData.get("decision"),
      reason: formData.get("reason"),
    });
  if (!parsed.success)
    redirect(
      "/coordinacion/organizaciones?error=Revisa+la+decisión+y+el+motivo",
    );
  try {
    await decideOrganizationClaim({
      ...parsed.data,
      reviewerId: coordinator.id,
    });
  } catch {
    redirect(
      "/coordinacion/organizaciones?error=La+solicitud+ha+cambiado+o+entra+en+conflicto+con+otra+cuenta",
    );
  }
  revalidatePath("/coordinacion/organizaciones");
  redirect("/coordinacion/organizaciones?notice=Solicitud+revisada+y+auditada");
}

export async function addOrganizationDomain(formData: FormData) {
  const coordinator = await assertCoordinator();
  if (coordinator.role !== UserRole.SUPER_ADMIN) {
    redirect(
      "/coordinacion/organizaciones?error=Solo+superadministración+puede+autorizar+dominios",
    );
  }
  const parsed = z
    .object({
      organizationId: z.string().min(1).max(191),
      domain: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/)
        .max(191),
    })
    .safeParse({
      organizationId: formData.get("organizationId"),
      domain: formData.get("domain"),
    });
  if (!parsed.success)
    redirect("/coordinacion/organizaciones?error=Dominio+no+válido");
  try {
    await prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.findUnique({
        where: { id: parsed.data.organizationId },
        select: { id: true, municipalityId: true },
      });
      if (!organization) throw new Error("NOT_FOUND");
      const domain = await transaction.organizationDomain.create({
        data: { ...parsed.data, isVerified: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: coordinator.id,
          municipalityId: organization.municipalityId,
          action: "organization_domain.verified",
          entityType: "OrganizationDomain",
          entityId: domain.id,
          metadata: { organizationId: organization.id, domain: domain.domain },
        },
      });
    });
  } catch {
    redirect(
      "/coordinacion/organizaciones?error=No+se+ha+podido+autorizar+el+dominio",
    );
  }
  revalidatePath("/coordinacion/organizaciones");
  redirect(
    "/coordinacion/organizaciones?notice=Dominio+institucional+autorizado",
  );
}
