import { formatDateTimeInTimeZone } from "@/lib/time-zone";

export type ActivityDetail = {
  label: string;
  value: string;
};

export type ActivityPresentation = {
  title: string;
  summary: string;
  details: ActivityDetail[];
};

const actionTitles: Record<string, string> = {
  "incident.created": "Incidente creado",
  "incident.created_from_detection":
    "Incidente creado tras revisar una señal externa",
  "incident.updated": "Ficha del incidente actualizada",
  "incident.status_changed": "Estado del incidente cambiado",
  "incident.public_location_approved":
    "Representación pública de la ubicación aprobada",
  "safe_point.created": "Punto de entrega creado",
  "safe_point.created_and_validated": "Punto de entrega creado y validado",
  "safe_point.validated": "Punto de entrega validado",
  "safe_point.deactivated": "Punto de entrega desactivado",
  "safe_point.reactivated": "Punto de entrega reactivado",
  "safe_point.reactivated_and_validated":
    "Punto de entrega reactivado y validado",
  "safe_point.updated_and_revalidated":
    "Punto de entrega actualizado y revalidado",
  "need.created": "Necesidad creada",
  "need.updated": "Necesidad actualizada",
  "need.status_changed": "Estado de la necesidad cambiado",
  "contribution.created": "Aportación registrada",
  "contribution.pledged_by_citizen": "Aportación ciudadana confirmada",
  "contribution.status_changed": "Estado de la aportación cambiado",
  "contribution.reassigned": "Aportación reasignada",
  "contribution.cancelled_by_citizen":
    "Aportación cancelada por la persona aportante",
  CONTRIBUTION_CANCELLED_BY_CITIZEN:
    "Aportación cancelada por la persona aportante",
  "detection.linked": "Señal externa vinculada al incidente",
  "external_detection.linked": "Señal externa vinculada al incidente",
  "external_detection.dismissed": "Señal externa descartada",
  "external_detection.sync_completed": "Importación de señales completada",
  "external_detection.sync_failed": "Importación de señales fallida",
  SIMULATION_INCIDENT_STATE_SEEDED:
    "Estado de incidente preparado para simulación",
  SIMULATION_NEED_STATE_SEEDED: "Estado de necesidad preparado para simulación",
  SIMULATION_CONTRIBUTION_STATE_SEEDED:
    "Estado de aportación preparado para simulación",
  SIMULATION_DETECTION_PENDING_SEEDED:
    "Señal pendiente preparada para simulación",
  SIMULATION_DETECTION_LINKED_SEEDED:
    "Señal vinculada preparada para simulación",
  SIMULATION_DETECTION_DISMISSED_SEEDED:
    "Señal descartada preparada para simulación",
};

const entityLabels: Record<string, string> = {
  Incident: "Incidente",
  SafePoint: "Punto de entrega",
  Need: "Necesidad",
  Contribution: "Aportación",
  ExternalDetection: "Señal externa",
  User: "Cuenta de usuario",
};

const incidentStatuses: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING_VALIDATION: "Pendiente de validación",
  ACTIVE: "Activo",
  MONITORING: "En seguimiento",
  RESOLVED: "Resuelto",
  CANCELLED: "Cancelado",
};

const needStatuses: Record<string, string> = {
  DRAFT: "Borrador",
  ACTIVE: "Activa",
  COVERED: "Cubierta",
  CANCELLED: "Cancelada",
  EXPIRED: "Caducada",
};

const contributionStatuses: Record<string, string> = {
  PLEDGED: "Confirmada",
  EN_ROUTE: "En camino",
  PARTIALLY_DELIVERED: "Entrega parcial",
  DELIVERED: "Entregada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No presentada",
};

const detectionStatuses: Record<string, string> = {
  PENDING: "Pendiente de revisión",
  DISMISSED: "Descartada",
  LINKED: "Vinculada",
};

const incidentTypes: Record<string, string> = {
  WILDFIRE: "Incendio forestal",
  FLOOD: "Inundación",
  STORM: "Tormenta",
  EARTHQUAKE: "Terremoto",
  SNOW: "Nevada",
  POWER_OUTAGE: "Corte eléctrico",
  SEARCH_RESCUE: "Búsqueda y rescate",
  HEALTH: "Emergencia sanitaria",
  INDUSTRIAL: "Incidente industrial",
  OTHER: "Otro incidente",
};

const priorities: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const publicLocationModes: Record<string, string> = {
  MUNICIPALITY_ONLY: "Solo municipio",
  GENERALIZED_AREA: "Área aproximada",
  SAFE_POINTS_ONLY: "Solo puntos de entrega",
};

const detectionSources: Record<string, string> = {
  NASA_FIRMS: "NASA FIRMS",
  EFFIS: "EFFIS",
  INCENDISCAT: "IncendisCat",
  AEMET: "AEMET",
  METEOCAT: "Meteocat",
  EMERGENCY_112: "Emergencias 112",
  CIVIL_PROTECTION: "Protección Civil",
  MANUAL: "Registro manual",
  OTHER: "Otra fuente",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function translated(
  value: unknown,
  labels: Record<string, string>,
  fallback = "No indicado",
) {
  const key = string(value);
  return key ? (labels[key] ?? fallback) : fallback;
}

function formattedNumber(value: unknown) {
  const parsed = number(value);
  return parsed === undefined ? undefined : parsed.toLocaleString("es-ES");
}

function date(value: unknown, timeZone: string) {
  const parsed = string(value);
  if (!parsed || Number.isNaN(new Date(parsed).getTime())) return undefined;
  return formatDateTimeInTimeZone(parsed, timeZone);
}

function transition(
  from: unknown,
  to: unknown,
  labels: Record<string, string>,
) {
  return `${translated(from, labels)} → ${translated(to, labels)}`;
}

function reasonDetail(metadata: Record<string, unknown>): ActivityDetail[] {
  const reason = string(metadata.reason);
  return reason ? [{ label: "Motivo", value: reason }] : [];
}

function changed(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  key: string,
) {
  return (
    JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)
  );
}

function changedLabels(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: ReadonlyArray<readonly [string, string]>,
) {
  return fields
    .filter(([key]) => changed(before, after, key))
    .map(([, label]) => label);
}

function createdIncident(
  metadata: Record<string, unknown>,
): ActivityPresentation {
  const status = translated(metadata.status, incidentStatuses, "Borrador");
  return {
    title: actionTitles["incident.created"],
    summary:
      "Se abrió una nueva ficha interna para revisión y validación humana.",
    details: [{ label: "Estado inicial", value: status }],
  };
}

function incidentCreatedFromDetection(
  metadata: Record<string, unknown>,
  timeZone: string,
): ActivityPresentation {
  const details: ActivityDetail[] = [
    {
      label: "Fuente de la señal",
      value: translated(metadata.detectionSource, detectionSources),
    },
    {
      label: "Estado inicial",
      value: translated(metadata.status, incidentStatuses, "Borrador"),
    },
  ];
  const detectedAt = date(metadata.detectedAt, timeZone);
  if (detectedAt) details.push({ label: "Señal detectada", value: detectedAt });
  details.push({
    label: "Publicación inicial",
    value: translated(metadata.publicLocationMode, publicLocationModes),
  });
  return {
    title: actionTitles["incident.created_from_detection"],
    summary:
      "Una persona coordinadora revisó la señal y abrió un borrador; la señal externa no publicó el incidente por sí sola.",
    details,
  };
}

function incidentUpdated(
  metadata: Record<string, unknown>,
): ActivityPresentation {
  const before = record(metadata.before);
  const after = record(metadata.after);
  const visibleFields = changedLabels(before, after, [
    ["title", "título"],
    ["publicSummary", "resumen público"],
    ["safetyNotice", "aviso de seguridad"],
  ]);
  const operationalFields = changedLabels(before, after, [
    ["operationalLatitude", "ubicación operativa"],
    ["operationalLongitude", "ubicación operativa"],
    ["radiusMeters", "radio operativo"],
  ]);
  const details: ActivityDetail[] = [];
  if (changed(before, after, "type")) {
    details.push({
      label: "Tipo",
      value: transition(before.type, after.type, incidentTypes),
    });
  }
  if (changed(before, after, "priority")) {
    details.push({
      label: "Prioridad",
      value: transition(before.priority, after.priority, priorities),
    });
  }
  if (visibleFields.length > 0) {
    details.push({
      label: "Contenido público revisado",
      value: [...new Set(visibleFields)].join(", "),
    });
  }
  if (operationalFields.length > 0) {
    details.push({
      label: "Datos operativos privados",
      value: `${[...new Set(operationalFields)].join(", ")} actualizados; valores reservados`,
    });
  }
  details.push(...reasonDetail(metadata));
  return {
    title: actionTitles["incident.updated"],
    summary:
      details.length > 0
        ? "Se revisaron datos de la ficha con trazabilidad del cambio."
        : "Se guardó una revisión de la ficha sin detalles adicionales visibles.",
    details,
  };
}

function publicLocationApproved(
  metadata: Record<string, unknown>,
): ActivityPresentation {
  const before = record(metadata.from);
  const after = record(metadata.to);
  const details: ActivityDetail[] = [
    {
      label: "Modo de ubicación pública",
      value: transition(before.mode, after.mode, publicLocationModes),
    },
  ];
  if (changed(before, after, "label")) {
    details.push({ label: "Etiqueta pública", value: "Actualizada" });
  }
  if (changed(before, after, "publicRadiusMeters")) {
    details.push({
      label: "Generalización pública",
      value: "Radio de seguridad actualizado",
    });
  }
  details.push(...reasonDetail(metadata));
  if (metadata.safetyConfirmation === true) {
    details.push({
      label: "Revisión de seguridad",
      value: "Confirmada por una persona coordinadora",
    });
  }
  return {
    title: actionTitles["incident.public_location_approved"],
    summary:
      "Se aprobó qué representación generalizada puede mostrarse públicamente; las coordenadas operativas permanecen reservadas.",
    details,
  };
}

function safePointLifecycle(
  action: string,
  metadata: Record<string, unknown>,
  timeZone: string,
): ActivityPresentation {
  const details = reasonDetail(metadata);
  const validatedAt = date(metadata.validatedAt, timeZone);
  if (validatedAt) {
    details.push({ label: "Validación humana", value: validatedAt });
  }
  if (metadata.humanSafetyConfirmed === true) {
    details.push({
      label: "Comprobación de seguridad",
      value: "Confirmada",
    });
  }
  const summaries: Record<string, string> = {
    "safe_point.created": "Se creó un punto de entrega pendiente de operación.",
    "safe_point.created_and_validated":
      "Se creó el punto y una persona coordinadora confirmó que podía usarse.",
    "safe_point.validated":
      "Una persona coordinadora confirmó que el punto podía mostrarse y utilizarse.",
    "safe_point.deactivated":
      "El punto dejó de estar disponible para nuevas necesidades y entregas.",
    "safe_point.reactivated":
      "El punto volvió a estar disponible tras una revisión humana.",
    "safe_point.reactivated_and_validated":
      "El punto volvió a estar disponible tras una nueva validación humana.",
  };
  return {
    title: actionTitles[action] ?? "Punto de entrega actualizado",
    summary:
      summaries[action] ?? "Se actualizó el estado del punto de entrega.",
    details,
  };
}

function safePointUpdated(
  metadata: Record<string, unknown>,
): ActivityPresentation {
  const before = record(metadata.before);
  const after = record(metadata.after);
  const fields = changedLabels(before, after, [
    ["name", "nombre"],
    ["address", "dirección de entrega"],
    ["instructions", "instrucciones"],
    ["capacityNote", "capacidad"],
  ]);
  const privateLocationChanged =
    changed(before, after, "latitude") || changed(before, after, "longitude");
  const details: ActivityDetail[] = [];
  if (fields.length > 0) {
    details.push({
      label: "Datos revisados",
      value: fields.join(", "),
    });
  }
  if (privateLocationChanged) {
    details.push({
      label: "Ubicación operativa del punto",
      value: "Actualizada; valores reservados",
    });
  }
  const impact = record(metadata.impact);
  const activeNeeds = formattedNumber(impact.activeNeeds);
  const pendingDeliveries = formattedNumber(impact.pendingDeliveries);
  if (activeNeeds || pendingDeliveries) {
    details.push({
      label: "Impacto revisado",
      value: `${activeNeeds ?? "0"} necesidades activas y ${pendingDeliveries ?? "0"} entregas pendientes`,
    });
  }
  details.push(...reasonDetail(metadata));
  return {
    title: actionTitles["safe_point.updated_and_revalidated"],
    summary:
      "Se actualizaron datos del punto y se repitió la validación humana antes de mantenerlo operativo.",
    details,
  };
}

function needCreated(
  metadata: Record<string, unknown>,
  timeZone: string,
): ActivityPresentation {
  const details: ActivityDetail[] = [];
  const quantity = formattedNumber(metadata.quantityNeeded);
  const unit = string(metadata.unit);
  if (quantity) {
    details.push({
      label: "Cantidad solicitada",
      value: unit ? `${quantity} ${unit}` : quantity,
    });
  }
  const deadline = date(metadata.deadline, timeZone);
  if (deadline) details.push({ label: "Fecha límite", value: deadline });
  details.push({
    label: "Visibilidad inicial",
    value:
      metadata.published === true
        ? "Publicada tras validación humana"
        : "Borrador interno",
  });
  return {
    title: actionTitles["need.created"],
    summary:
      metadata.published === true
        ? "La necesidad se creó y publicó tras validación humana."
        : "La necesidad se creó como borrador pendiente de validación.",
    details,
  };
}

function needUpdated(
  metadata: Record<string, unknown>,
  timeZone: string,
): ActivityPresentation {
  const before = record(metadata.before);
  const after = record(metadata.after);
  const details: ActivityDetail[] = [];
  if (changed(before, after, "quantityNeeded")) {
    details.push({
      label: "Cantidad necesaria",
      value: `${formattedNumber(before.quantityNeeded) ?? "No indicada"} → ${formattedNumber(after.quantityNeeded) ?? "No indicada"}`,
    });
  }
  if (changed(before, after, "deadline")) {
    details.push({
      label: "Fecha límite",
      value: `${date(before.deadline, timeZone) ?? "No indicada"} → ${date(after.deadline, timeZone) ?? "No indicada"}`,
    });
  }
  if (changed(before, after, "status")) {
    details.push({
      label: "Estado",
      value: transition(before.status, after.status, needStatuses),
    });
  }
  const protectedQuantity = formattedNumber(metadata.protectedQuantity);
  if (protectedQuantity) {
    details.push({
      label: "Cantidad ya comprometida o recibida",
      value: protectedQuantity,
    });
  }
  details.push(...reasonDetail(metadata));
  return {
    title: actionTitles["need.updated"],
    summary:
      "Se revisaron cantidad, plazo o estado sin perder compromisos existentes.",
    details,
  };
}

function contributionCreated(
  action: string,
  metadata: Record<string, unknown>,
  timeZone: string,
): ActivityPresentation {
  const details: ActivityDetail[] = [];
  const quantity = formattedNumber(metadata.quantity);
  const unit = string(metadata.unit);
  if (quantity) {
    details.push({
      label: "Cantidad comprometida",
      value: unit ? `${quantity} ${unit}` : quantity,
    });
  }
  const eta = date(metadata.eta, timeZone);
  if (eta) details.push({ label: "Llegada prevista", value: eta });
  return {
    title: actionTitles[action] ?? actionTitles["contribution.created"],
    summary:
      "La aportación quedó registrada como compromiso; no se contó como recibida.",
    details,
  };
}

function contributionStatusChanged(
  metadata: Record<string, unknown>,
): ActivityPresentation {
  const details: ActivityDetail[] = [
    {
      label: "Estado de la aportación",
      value: transition(metadata.from, metadata.to, contributionStatuses),
    },
  ];
  const before = formattedNumber(metadata.deliveredBefore);
  const after = formattedNumber(metadata.deliveredAfter);
  if (before || after) {
    details.push({
      label: "Cantidad recibida",
      value: `${before ?? "0"} → ${after ?? "0"}`,
    });
  }
  if (string(metadata.needStatus)) {
    details.push({
      label: "Estado resultante de la necesidad",
      value: translated(metadata.needStatus, needStatuses),
    });
  }
  details.push(...reasonDetail(metadata));
  return {
    title: actionTitles["contribution.status_changed"],
    summary:
      "Se actualizó el seguimiento de la entrega y, cuando correspondía, la cantidad realmente recibida.",
    details,
  };
}

function contributionCancelled(
  metadata: Record<string, unknown>,
): ActivityPresentation {
  const from = metadata.previousStatus ?? metadata.from;
  const to = metadata.status ?? metadata.to ?? "CANCELLED";
  return {
    title: actionTitles.CONTRIBUTION_CANCELLED_BY_CITIZEN,
    summary:
      "La persona aportante canceló el compromiso mediante su enlace privado; no se descontó material ya recibido.",
    details: [
      {
        label: "Estado de la aportación",
        value: transition(from, to, contributionStatuses),
      },
      ...reasonDetail(metadata),
    ],
  };
}

function detectionLinked(
  metadata: Record<string, unknown>,
): ActivityPresentation {
  const source = metadata.source ?? metadata.detectionSource;
  const details: ActivityDetail[] = [];
  if (string(source)) {
    details.push({
      label: "Fuente",
      value: translated(source, detectionSources),
    });
  }
  return {
    title: actionTitles["external_detection.linked"],
    summary:
      "Una persona coordinadora revisó la señal y decidió vincularla; la señal no creó información pública automáticamente.",
    details,
  };
}

function simulation(
  action: string,
  metadata: Record<string, unknown>,
): ActivityPresentation {
  const details: ActivityDetail[] = [
    { label: "Entorno", value: "Datos de simulación" },
  ];
  if (action.includes("INCIDENT")) {
    details.push({
      label: "Estado preparado",
      value: translated(metadata.status, incidentStatuses),
    });
  } else if (action.includes("NEED")) {
    details.push({
      label: "Estado preparado",
      value: translated(metadata.status, needStatuses),
    });
  } else if (action.includes("CONTRIBUTION")) {
    details.push({
      label: "Estado preparado",
      value: translated(metadata.status, contributionStatuses),
    });
  } else {
    details.push({
      label: "Estado preparado",
      value: translated(metadata.status, detectionStatuses),
    });
  }
  return {
    title: actionTitles[action] ?? "Datos preparados para simulación",
    summary:
      "Entrada generada exclusivamente para comprobar el flujo operativo.",
    details,
  };
}

export function presentIncidentEntity(entityType: string) {
  return entityLabels[entityType] ?? "Elemento operativo";
}

export function presentIncidentActivity(
  action: string,
  rawMetadata: Record<string, unknown> | undefined,
  timeZone: string,
): ActivityPresentation {
  const metadata = record(rawMetadata);

  if (action.startsWith("SIMULATION_")) return simulation(action, metadata);

  switch (action) {
    case "incident.created":
      return createdIncident(metadata);
    case "incident.created_from_detection":
      return incidentCreatedFromDetection(metadata, timeZone);
    case "incident.updated":
      return incidentUpdated(metadata);
    case "incident.public_location_approved":
      return publicLocationApproved(metadata);
    case "incident.status_changed":
      return {
        title: actionTitles[action],
        summary: "Se cambió la fase operativa del incidente.",
        details: [
          {
            label: "Estado",
            value: transition(metadata.from, metadata.to, incidentStatuses),
          },
          ...reasonDetail(metadata),
        ],
      };
    case "safe_point.created":
    case "safe_point.created_and_validated":
    case "safe_point.validated":
    case "safe_point.deactivated":
    case "safe_point.reactivated":
    case "safe_point.reactivated_and_validated":
      return safePointLifecycle(action, metadata, timeZone);
    case "safe_point.updated_and_revalidated":
      return safePointUpdated(metadata);
    case "need.created":
      return needCreated(metadata, timeZone);
    case "need.updated":
      return needUpdated(metadata, timeZone);
    case "need.status_changed":
      return {
        title: actionTitles[action],
        summary: "Se cambió la fase operativa de la necesidad.",
        details: [
          {
            label: "Estado",
            value: transition(metadata.from, metadata.to, needStatuses),
          },
          ...reasonDetail(metadata),
        ],
      };
    case "contribution.created":
    case "contribution.pledged_by_citizen":
      return contributionCreated(action, metadata, timeZone);
    case "contribution.status_changed":
      return contributionStatusChanged(metadata);
    case "contribution.reassigned": {
      const quantity = formattedNumber(metadata.quantity);
      return {
        title: actionTitles[action],
        summary:
          "La aportación se trasladó a otra solicitud compatible después de revisar punto de entrega, plazo y cantidad.",
        details: [
          ...(quantity
            ? [{ label: "Cantidad reasignada", value: quantity }]
            : []),
          ...reasonDetail(metadata),
        ],
      };
    }
    case "contribution.cancelled_by_citizen":
    case "CONTRIBUTION_CANCELLED_BY_CITIZEN":
      return contributionCancelled(metadata);
    case "detection.linked":
    case "external_detection.linked":
      return detectionLinked(metadata);
    case "external_detection.dismissed":
      return {
        title: actionTitles[action],
        summary:
          "Una persona coordinadora revisó la señal y decidió descartarla.",
        details: reasonDetail(metadata),
      };
    case "external_detection.sync_completed":
      return {
        title: actionTitles[action],
        summary:
          "La fuente externa se importó como señales internas pendientes de revisión.",
        details: [
          {
            label: "Señales importadas",
            value: formattedNumber(metadata.imported) ?? "0",
          },
          {
            label: "Filas descartadas por validación",
            value: formattedNumber(metadata.rowsRejected) ?? "0",
          },
        ],
      };
    case "external_detection.sync_failed":
      return {
        title: actionTitles[action],
        summary: "No se pudieron importar señales; no se publicó información.",
        details: reasonDetail(metadata),
      };
    default:
      return {
        title: "Actividad registrada",
        summary:
          "Se registró una operación auditada. Sus metadatos técnicos no se muestran porque no tienen una presentación segura definida.",
        details: [],
      };
  }
}
