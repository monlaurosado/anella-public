export const FIRE_PROVIDER_STATUSES = [
  "DECLARED",
  "ACTIVE",
  "STABILIZED",
  "CONTROLLED",
  "EXTINGUISHED",
  "UNKNOWN",
] as const;

export type FireProviderStatus = (typeof FIRE_PROVIDER_STATUSES)[number];

export const OPEN_FIRE_PROVIDER_STATUSES: FireProviderStatus[] = [
  "DECLARED",
  "ACTIVE",
  "STABILIZED",
  "CONTROLLED",
  "UNKNOWN",
];

export const FIRE_PROVIDER_STATUS_LABELS: Record<FireProviderStatus, string> = {
  DECLARED: "Declarado",
  ACTIVE: "Activo",
  STABILIZED: "Estabilizado",
  CONTROLLED: "Controlado",
  EXTINGUISHED: "Extinguido",
  UNKNOWN: "Sin estado confirmado",
};

export const FIRE_PROVIDER_LABELS: Record<string, string> = {
  NASA_FIRMS: "NASA FIRMS",
  BOMBERS_CATALUNYA: "Bombers de la Generalitat · Catalunya",
  JCYL: "Junta de Castilla y León",
  INFOCA: "Plan INFOCA · Andalucía",
  MITECO_CCINIF: "CCINIF / MITECO · España",
  EFFIS: "EFFIS / Copernicus",
};

export function fireProviderLabel(
  provider: string | null | undefined,
  fallback: string,
) {
  return provider ? (FIRE_PROVIDER_LABELS[provider] ?? provider) : fallback;
}
