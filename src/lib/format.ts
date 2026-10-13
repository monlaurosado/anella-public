import type { IncidentStatus, NeedStatus, Priority } from "@/types/domain";

const priorityLabels: Record<Priority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const incidentStatusLabels: Record<IncidentStatus, string> = {
  draft: "Borrador",
  pending_validation: "Pendiente",
  active: "Activo",
  monitoring: "Seguimiento",
  resolved: "Resuelto",
  cancelled: "Cancelado",
};

const needStatusLabels: Record<NeedStatus, string> = {
  draft: "Borrador",
  active: "Activa",
  covered: "Cubierta",
  cancelled: "Cancelada",
  expired: "Caducada",
};

export function formatPriority(priority: Priority) {
  return priorityLabels[priority];
}

export function formatIncidentStatus(status: IncidentStatus) {
  return incidentStatusLabels[status];
}

export function formatNeedStatus(status: NeedStatus) {
  return needStatusLabels[status];
}

const knownUnitForms: Record<
  string,
  readonly [singular: string, plural: string]
> = {
  bolsas: ["bolsa", "bolsas"],
  botellas: ["botella", "botellas"],
  cajas: ["caja", "cajas"],
  kits: ["kit", "kits"],
  packs: ["paquete", "paquetes"],
  paquetes: ["paquete", "paquetes"],
  plazas: ["plaza", "plazas"],
  raciones: ["ración", "raciones"],
  uds: ["ud", "uds"],
  vehiculos: ["vehículo", "vehículos"],
  vehículos: ["vehículo", "vehículos"],
};

export function formatQuantity(value: number, unit: string) {
  const trimmedUnit = unit.trim();
  const forms = knownUnitForms[trimmedUnit.toLocaleLowerCase("es-ES")];
  const localizedUnit = forms ? forms[value === 1 ? 0 : 1] : trimmedUnit;
  return `${value.toLocaleString("es-ES")} ${localizedUnit}`;
}

export function formatRelativeDate(isoDate: string) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

export function formatMinutesAgo(
  isoDate: string,
  now: Date | number = Date.now(),
) {
  const timestamp = new Date(isoDate).getTime();
  const nowTimestamp = now instanceof Date ? now.getTime() : now;
  const elapsedMinutes = Number.isFinite(timestamp)
    ? Math.max(0, Math.floor((nowTimestamp - timestamp) / 60_000))
    : 0;
  return elapsedMinutes === 1
    ? "hace 1 minuto"
    : `hace ${elapsedMinutes.toLocaleString("es-ES")} minutos`;
}

export const formatDateTime = formatRelativeDate;
