import type { ContributionStatus, IncidentType } from "@/types/domain";

export const incidentTypeLabels: Record<IncidentType, string> = {
  wildfire: "Incendio",
  flood: "Inundación",
  storm: "Tormenta",
  earthquake: "Terremoto",
  snow: "Nevada",
  power_outage: "Corte eléctrico",
  search_rescue: "Búsqueda y rescate",
  health: "Emergencia sanitaria",
  industrial: "Incidente industrial",
  other: "Otro",
};

export const contributionStatusLabels: Record<ContributionStatus, string> = {
  pledged: "Comprometida",
  en_route: "En camino",
  partially_delivered: "Entrega parcial",
  delivered: "Entregada",
  cancelled: "Cancelada",
  no_show: "No presentada",
};

export function contributionStatusTone(status: ContributionStatus) {
  if (status === "delivered") return "success" as const;
  if (status === "cancelled" || status === "no_show") {
    return "danger" as const;
  }
  if (status === "en_route" || status === "partially_delivered") {
    return "warning" as const;
  }
  return "info" as const;
}
