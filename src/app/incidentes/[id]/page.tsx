import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ContributionForm } from "@/components/incidents/contribution-form";
import { PublicIncidentView } from "@/components/incidents/public-incident-view";
import { getIncidentById, getPublicIncidentTitle } from "@/services/incidents";
import {
  getContributionAccessCookieName,
  getContributionStatus,
  LAST_CONTRIBUTION_COOKIE_NAME,
} from "@/services/contributions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const incident = await getPublicIncidentTitle(id);
  return {
    title: incident
      ? `${incident.publicCode} · ${incident.title}`
      : "Incidente no disponible",
  };
}

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    punto?: string | string[];
    necesidad?: string | string[];
  }>;
}) {
  const [{ id }, query, cookieStore] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);
  const incident = await getIncidentById(id);

  if (!incident) {
    notFound();
  }

  const requestedPointId =
    typeof query.punto === "string" && query.punto.length <= 191
      ? query.punto
      : undefined;
  const requestedNeedId =
    typeof query.necesidad === "string" && query.necesidad.length <= 191
      ? query.necesidad
      : undefined;
  const requestedNeed = requestedNeedId
    ? incident.needs.find((need) => need.id === requestedNeedId)
    : undefined;
  const initialSelectedPointId = incident.safePoints.find(
    (point) =>
      point.id === (requestedPointId ?? requestedNeed?.safePointId ?? ""),
  )?.id;
  const selectedNeed =
    requestedNeed?.safePointId === initialSelectedPointId
      ? requestedNeed
      : undefined;
  const contributionActions = Object.fromEntries(
    incident.safePoints.map((point) => [
      point.id,
      <ContributionForm
        key={`${point.id}:${selectedNeed?.id ?? "direct"}`}
        incident={incident}
        idempotencyKey={randomUUID()}
        safePoint={point}
        need={selectedNeed?.safePointId === point.id ? selectedNeed : undefined}
      />,
    ]),
  );
  const lastContributionCode = cookieStore.get(
    LAST_CONTRIBUTION_COOKIE_NAME,
  )?.value;
  const lastContributionToken =
    lastContributionCode && /^[A-Za-z0-9-]{3,20}$/.test(lastContributionCode)
      ? cookieStore.get(getContributionAccessCookieName(lastContributionCode))
          ?.value
      : undefined;
  const lastContribution =
    lastContributionCode && lastContributionToken
      ? await getContributionStatus(lastContributionCode, lastContributionToken)
      : null;
  const recentContributionPath =
    lastContribution?.incidentId === incident.id
      ? `/aportaciones/${lastContribution.publicCode}`
      : undefined;

  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <PublicIncidentView
        incident={incident}
        initialSelectedPointId={initialSelectedPointId}
        mode="public"
        recentContributionPath={recentContributionPath}
        contributionActions={contributionActions}
      />
    </main>
  );
}
