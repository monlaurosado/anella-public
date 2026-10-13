"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import {
  IncidentStatus,
  IncidentNoticeStatus,
  OrganizationVerificationStatus,
} from "@/generated/prisma/enums";
import { assertCoordinator, incidentScopeWhere } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { publicIncidentNoticeSchema } from "@/lib/public-notice-safety";

function finish(kind: "notice" | "error", message: string): never {
  const query = new URLSearchParams({ [kind]: message });
  redirect(`/coordinacion/avisos?${query.toString()}`);
}

function invalidateNoticeViews(incidentId: string) {
  updateTag(PUBLIC_INCIDENTS_CACHE_TAG);
  revalidatePath("/coordinacion/avisos");
  revalidatePath(`/coordinacion/incidentes/${incidentId}`);
  revalidatePath(`/incidentes/${incidentId}`);
}

export async function publishIncidentNotice(formData: FormData) {
  const coordinator = await assertCoordinator();
  const parsed = publicIncidentNoticeSchema.safeParse({
    incidentId: formData.get("incidentId"),
    title: formData.get("title"),
    body: formData.get("body"),
    safetyConfirmed: formData.get("confirmPublicNoticeSafety") === "on",
  });
  if (!parsed.success) {
    finish("error", parsed.error.issues[0]?.message ?? "Revisa el aviso.");
  }

  try {
    await prisma.$transaction(async (transaction) => {
      const incident = await transaction.incident.findFirst({
        where: {
          id: parsed.data.incidentId,
          ...incidentScopeWhere(coordinator),
          status: { in: [IncidentStatus.ACTIVE, IncidentStatus.MONITORING] },
        },
        select: { id: true, municipalityId: true, organizationId: true },
      });
      if (!incident) throw new Error("SCOPE");
      const organizationId =
        coordinator.organizationId ?? incident.organizationId;
      if (!organizationId) throw new Error("ORGANIZATION_REQUIRED");
      const organization = await transaction.organization.findFirst({
        where: {
          id: organizationId,
          verificationStatus: OrganizationVerificationStatus.VERIFIED,
        },
        select: { id: true },
      });
      if (!organization) throw new Error("ORGANIZATION_NOT_VERIFIED");

      const now = new Date();
      const notice = await transaction.incidentNotice.create({
        data: {
          incidentId: incident.id,
          organizationId: organization.id,
          createdById: coordinator.id,
          title: parsed.data.title,
          body: parsed.data.body,
          status: IncidentNoticeStatus.PUBLISHED,
          publishedAt: now,
        },
      });
      await transaction.incident.update({
        where: { id: incident.id },
        data: { lastActivityAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: coordinator.id,
          incidentId: incident.id,
          municipalityId: incident.municipalityId,
          action: "incident_notice.published",
          entityType: "IncidentNotice",
          entityId: notice.id,
          metadata: {
            organizationId: organization.id,
            publishedAt: now.toISOString(),
          },
        },
      });
    });
  } catch {
    console.error("Incident notice publication failed");
    finish("error", "No se ha podido publicar el aviso con el alcance actual.");
  }

  invalidateNoticeViews(parsed.data.incidentId);
  finish("notice", "Aviso oficial publicado.");
}

export async function closeIncidentNotice(formData: FormData) {
  const coordinator = await assertCoordinator();
  const noticeId = z
    .string()
    .min(1)
    .max(191)
    .safeParse(formData.get("noticeId"));
  if (!noticeId.success) finish("error", "Aviso no válido.");

  let incidentId = "";
  try {
    await prisma.$transaction(async (transaction) => {
      const notice = await transaction.incidentNotice.findFirst({
        where: {
          id: noticeId.data,
          status: IncidentNoticeStatus.PUBLISHED,
          incident: incidentScopeWhere(coordinator),
          ...(coordinator.role === "COORDINATOR"
            ? { organizationId: coordinator.organizationId ?? "__none__" }
            : {}),
        },
        include: { incident: { select: { municipalityId: true } } },
      });
      if (!notice) throw new Error("SCOPE");
      incidentId = notice.incidentId;
      const now = new Date();
      await transaction.incidentNotice.update({
        where: { id: notice.id },
        data: { status: IncidentNoticeStatus.CLOSED, closedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: coordinator.id,
          incidentId: notice.incidentId,
          municipalityId: notice.incident.municipalityId,
          action: "incident_notice.closed",
          entityType: "IncidentNotice",
          entityId: notice.id,
          metadata: { closedAt: now.toISOString() },
        },
      });
    });
  } catch {
    console.error("Incident notice closure failed");
    finish("error", "No se ha podido cerrar el aviso.");
  }

  invalidateNoticeViews(incidentId);
  finish("notice", "Aviso cerrado.");
}
