import "server-only";

import { unstable_cache } from "next/cache";

import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import { getPublicSnapshot } from "@/services/incidents";
import type { Incident, PublicStats } from "@/types/domain";

// This is deliberately short-lived: it absorbs anonymous bursts without
// hiding operational changes for long if an invalidation signal is missed.
const loadCachedPublicSnapshot = unstable_cache(
  () => getPublicSnapshot(),
  [PUBLIC_INCIDENTS_CACHE_TAG],
  {
    revalidate: 15,
    tags: [PUBLIC_INCIDENTS_CACHE_TAG],
  },
);

function publicStats(incidents: Incident[]): PublicStats {
  const needs = incidents.flatMap((incident) => incident.needs);

  return {
    activeIncidents: incidents.filter((incident) =>
      ["active", "monitoring"].includes(incident.status),
    ).length,
    enabledDropOffPoints: incidents.reduce(
      (total, incident) => total + (incident.safePoints?.length ?? 0),
      0,
    ),
    openNeeds: needs.filter((need) =>
      ["open", "committed", "en_route", "partially_received"].includes(
        need.operationalStatus,
      ),
    ).length,
    coveredNeeds: needs.filter((need) => need.operationalStatus === "covered")
      .length,
    pledgedContributions: needs.reduce(
      (total, need) => total + need.quantityCommitted,
      0,
    ),
  };
}

/**
 * Deadlines advance independently of database writes and Next cache tags.
 * Rechecking them after the cached read makes scheduled expiry immediate even
 * when the standalone maintenance process persists EXPIRED a moment later.
 */
export async function getCachedPublicSnapshot(now = new Date()) {
  const snapshot = await loadCachedPublicSnapshot();
  const nowTime = now.getTime();
  const incidents = snapshot.incidents.map((incident) => ({
    ...incident,
    needs: incident.needs.filter((need) => {
      if (!need.deadline) return need.operationalStatus !== "expired";
      return new Date(need.deadline).getTime() > nowTime;
    }),
  }));

  return { incidents, stats: publicStats(incidents) };
}
