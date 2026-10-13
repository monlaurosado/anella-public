import Link from "next/link";
import {
  BellRing,
  Eye,
  Globe2,
  HandHeart,
  LockKeyhole,
  MapPinned,
  Save,
  ShieldCheck,
} from "lucide-react";

import {
  updateIncidentDetails,
  updateIncidentStatus,
  updatePublicLocation,
} from "@/actions/coordination";
import { PublicLocationFields } from "@/components/coordination/public-location-fields";
import { PublicIncidentView } from "@/components/incidents/public-incident-view";
import { formatIncidentStatus } from "@/lib/format";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import type { IncidentStatus, ManagedIncident } from "@/types/domain";

const incidentTypeOptions = [
  ["WILDFIRE", "Incendio forestal"],
  ["FLOOD", "Inundación"],
  ["STORM", "Tormenta"],
  ["EARTHQUAKE", "Terremoto"],
  ["SNOW", "Nevada"],
  ["POWER_OUTAGE", "Corte de suministro"],
  ["SEARCH_RESCUE", "Búsqueda y rescate"],
  ["HEALTH", "Emergencia sanitaria"],
  ["INDUSTRIAL", "Accidente industrial"],
  ["OTHER", "Otro"],
] as const;

const priorityOptions = [
  ["LOW", "Baja"],
  ["MEDIUM", "Media"],
  ["HIGH", "Alta"],
  ["CRITICAL", "Crítica"],
] as const;

const statusTransitions: Record<
  IncidentStatus,
  Array<{ value: string; label: string }>
> = {
  draft: [
    { value: "PENDING_VALIDATION", label: "Enviar a validación" },
    { value: "CANCELLED", label: "Cancelar emergencia" },
  ],
  pending_validation: [
    { value: "DRAFT", label: "Volver a borrador" },
    { value: "ACTIVE", label: "Validar y publicar" },
    { value: "CANCELLED", label: "Cancelar emergencia" },
  ],
  active: [
    { value: "MONITORING", label: "Pasar a seguimiento" },
    { value: "RESOLVED", label: "Cerrar como resuelto" },
    { value: "CANCELLED", label: "Cancelar emergencia" },
  ],
  monitoring: [
    { value: "ACTIVE", label: "Volver a activo" },
    { value: "RESOLVED", label: "Cerrar como resuelto" },
    { value: "CANCELLED", label: "Cancelar emergencia" },
  ],
  resolved: [{ value: "PENDING_VALIDATION", label: "Reabrir para revalidar" }],
  cancelled: [],
};

const publicModeValues = {
  municipality_only: "MUNICIPALITY_ONLY",
  generalized_area: "GENERALIZED_AREA",
  safe_points_only: "SAFE_POINTS_ONLY",
} as const;

const inputClass =
  "min-h-11 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";
const textareaClass =
  "min-h-24 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

function requiresReason(current: IncidentStatus, target: string) {
  return (
    target === "RESOLVED" || target === "CANCELLED" || current === "resolved"
  );
}

function IncidentStatusControls({ incident }: { incident: ManagedIncident }) {
  const transitions = statusTransitions[incident.status];

  return (
    <section
      id="ciclo-operativo"
      className="scroll-mt-24 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-black/65 dark:text-white/65">
            Ciclo operativo
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            Estado: {formatIncidentStatus(incident.status)}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-black/60 dark:text-white/60">
            El cierre queda bloqueado mientras existan aportaciones en camino o
            tareas operativas pendientes.
          </p>
        </div>
        {incident.closedAt ? (
          <p className="text-xs text-black/65 dark:text-white/65">
            Cerrado{" "}
            {formatDateTimeInTimeZone(incident.closedAt, incident.timeZone)}
          </p>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-3 rounded-md bg-[color:var(--surface-muted)] p-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">
            Organización responsable
          </dt>
          <dd className="mt-1 text-sm font-semibold">
            {incident.organizationName ?? incident.responsibleOrgName}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">
            Fecha de alta
          </dt>
          <dd className="mt-1 text-sm font-semibold">
            {formatDateTimeInTimeZone(incident.createdAt, incident.timeZone)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">
            Fecha de validación
          </dt>
          <dd className="mt-1 text-sm font-semibold">
            {incident.verifiedAt
              ? `${formatDateTimeInTimeZone(incident.verifiedAt, incident.timeZone)}${incident.verifiedByName ? ` · ${incident.verifiedByName}` : ""}`
              : "Pendiente de validación"}
          </dd>
        </div>
      </dl>

      {incident.closedReason ? (
        <div className="mt-4 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm">
          <span className="font-semibold">Motivo registrado:</span>{" "}
          {incident.closedReason}
        </div>
      ) : null}

      {transitions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {transitions.map((transition) => {
            const reasonRequired = requiresReason(
              incident.status,
              transition.value,
            );

            if (!reasonRequired) {
              return (
                <form key={transition.value} action={updateIncidentStatus}>
                  <input type="hidden" name="incidentId" value={incident.id} />
                  <input type="hidden" name="status" value={transition.value} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold transition hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.04]"
                  >
                    {transition.label}
                  </button>
                </form>
              );
            }

            return (
              <details
                key={transition.value}
                className="w-full rounded-md border border-red-500/25 bg-red-500/[0.04] sm:w-auto sm:min-w-80"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm font-semibold text-[color:var(--danger)] focus-visible:outline-2 focus-visible:outline-offset-2">
                  {transition.label}
                </summary>
                <form
                  action={updateIncidentStatus}
                  className="grid gap-3 border-t border-red-500/20 p-4"
                >
                  <input type="hidden" name="incidentId" value={incident.id} />
                  <input type="hidden" name="status" value={transition.value} />
                  <label className="grid gap-1.5 text-sm font-medium">
                    Motivo del cambio
                    <textarea
                      name="reason"
                      required
                      minLength={8}
                      maxLength={500}
                      className={textareaClass}
                      placeholder="Explica la decisión y el contexto operativo"
                    />
                  </label>
                  <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface)] p-3 text-sm leading-5">
                    <input
                      type="checkbox"
                      name="confirmStatusChange"
                      required
                      className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                    />
                    Confirmo que he revisado puntos de entrega, aportaciones
                    pendientes y el impacto público de este cambio.
                  </label>
                  <button
                    type="submit"
                    className="min-h-11 rounded-md bg-[color:var(--danger)] px-4 text-sm font-semibold text-white dark:text-[#171713] focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Confirmar cambio
                  </button>
                </form>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-black/55 dark:text-white/55">
          Este estado no admite más transiciones desde la ficha.
        </p>
      )}
    </section>
  );
}

const originLabels: Record<ManagedIncident["origin"], string> = {
  manual: "Alta manual auditada",
  detection_candidate: "Candidata generada desde detecciones",
  official_notice: "Aviso de fuente oficial",
};

function OperationalOverview({ incident }: { incident: ManagedIncident }) {
  const activePoints = incident.publicPreview?.incident.safePoints.length ?? 0;
  const publishedNotices = incident.publicPreview?.incident.notices.length ?? 0;
  const quickActions = [
    {
      label: "Habilitar punto de entrega",
      href: `/coordinacion/incidentes/${incident.id}?tab=safe-points#nuevo-punto`,
      icon: MapPinned,
    },
    {
      label: "Publicar aviso",
      href: `/coordinacion/avisos?incidentId=${encodeURIComponent(incident.id)}`,
      icon: BellRing,
    },
    {
      label: "Ver aportaciones",
      href: `/coordinacion/incidentes/${incident.id}?tab=contributions`,
      icon: HandHeart,
    },
  ];

  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
            Vista operativa
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            Actuar sobre la emergencia
          </h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {originLabels[incident.origin]} ·{" "}
            {incident.affectedMunicipalities
              .map((municipality) => municipality.name)
              .join(", ")}
          </p>
        </div>
        <Link
          href="#ciclo-operativo"
          className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
        >
          Revisar o cerrar emergencia
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-[color:var(--surface-muted)] p-3">
          <strong className="block text-xl">{activePoints}</strong>
          <span className="text-xs text-black/60 dark:text-white/60">
            Puntos activos
          </span>
        </div>
        <div className="rounded-md bg-[color:var(--surface-muted)] p-3">
          <strong className="block text-xl">
            {incident.counts.contributions}
          </strong>
          <span className="text-xs text-black/60 dark:text-white/60">
            Aportaciones
          </span>
        </div>
        <div className="rounded-md bg-[color:var(--surface-muted)] p-3">
          <strong className="block text-xl">{publishedNotices}</strong>
          <span className="text-xs text-black/60 dark:text-white/60">
            Avisos
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {quickActions.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-3 text-center text-sm font-semibold text-[color:var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Icon size={17} aria-hidden />
            {label}
          </Link>
        ))}
      </div>

      <div className="mt-5 border-t border-[color:var(--border)] pt-4">
        <h3 className="text-sm font-semibold">Aportaciones recientes</h3>
        {incident.recentContributions.length > 0 ? (
          <ul className="mt-2 divide-y divide-[color:var(--border)]">
            {incident.recentContributions.map((contribution) => (
              <li
                key={contribution.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {contribution.description ?? contribution.needTitle} ·{" "}
                  {contribution.safePointName}
                </span>
                <span className="shrink-0 text-xs font-semibold uppercase text-black/55 dark:text-white/55">
                  {contribution.status.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-black/55 dark:text-white/55">
            Aún no se han anunciado aportaciones.
          </p>
        )}
      </div>
    </section>
  );
}

function PublicPreview({ incident }: { incident: ManagedIncident }) {
  const preview = incident.publicPreview;
  if (!preview) {
    throw new Error(
      "La pestaña de resumen requiere la proyección pública de la emergencia.",
    );
  }
  return (
    <section
      aria-labelledby="public-preview-heading"
      className={
        preview.isVisible
          ? "rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-4 sm:p-5"
          : "rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-4 sm:p-5"
      }
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-[color:var(--success)]">
          <Eye size={18} aria-hidden />
        </span>
        <div>
          <p
            className={`text-xs font-bold uppercase tracking-[0.12em] ${
              preview.isVisible
                ? "text-[color:var(--success)]"
                : "text-[color:var(--warning)]"
            }`}
          >
            {preview.isVisible
              ? "Visible ahora a ciudadanía"
              : "No visible ahora a ciudadanía"}
          </p>
          <h2
            id="public-preview-heading"
            className="mt-1 text-lg font-semibold"
          >
            Previsualización pública segura
          </h2>
          <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
            Esta vista se construye solo con campos públicos permitidos. No
            incluye coordenadas operativas, fuentes externas, tokens QR ni datos
            personales.
          </p>
          {!preview.isVisible ? (
            <div className="mt-3 rounded-md border border-amber-500/25 bg-[color:var(--surface)] p-3 text-sm">
              <p className="font-semibold">
                La web pública no muestra actualmente esta emergencia.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-black/65 dark:text-white/65">
                {preview.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-black/55 dark:text-white/55">
                Debajo se previsualiza el contrato permitido que se publicaría
                al resolver esos bloqueos; no representa una publicación activa.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div
        className="isolate mt-5 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]"
        data-coordination-public-preview
      >
        <PublicIncidentView incident={preview.incident} mode="preview" />
      </div>
    </section>
  );
}

export function IncidentSummary({ incident }: { incident: ManagedIncident }) {
  return (
    <div className="space-y-5">
      <OperationalOverview incident={incident} />
      <IncidentStatusControls incident={incident} />
      <PublicPreview incident={incident} />

      <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-black/[0.05] dark:bg-white/10">
            <LockKeyhole size={18} aria-hidden />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-black/65 dark:text-white/65">
              Ficha interna · Solo coordinación
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              Datos operativos y mensaje público
            </h2>
            <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
              Las coordenadas y el radio de esta ficha son privados. La
              ubicación ciudadana se aprueba por separado más abajo.
            </p>
          </div>
        </summary>

        <form action={updateIncidentDetails} className="mt-5 grid gap-5">
          <input type="hidden" name="incidentId" value={incident.id} />
          <input
            type="hidden"
            name="expectedUpdatedAt"
            value={incident.updatedAt}
          />

          <fieldset className="grid gap-4">
            <legend className="text-sm font-semibold">Contenido público</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Título
                <input
                  name="title"
                  required
                  defaultValue={incident.title}
                  className={inputClass}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-medium">
                  Tipo
                  <select
                    name="type"
                    defaultValue={incident.type.toUpperCase()}
                    className={inputClass}
                  >
                    {incidentTypeOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Prioridad
                  <select
                    name="priority"
                    defaultValue={incident.priority.toUpperCase()}
                    className={inputClass}
                  >
                    {priorityOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              Resumen público
              <textarea
                name="publicSummary"
                required
                defaultValue={incident.publicSummary}
                className={textareaClass}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Aviso de seguridad
              <textarea
                name="safetyNotice"
                required
                defaultValue={incident.safetyNotice}
                className={textareaClass}
              />
            </label>
          </fieldset>

          <fieldset className="grid gap-4 rounded-md border border-red-500/20 bg-red-500/[0.03] p-4">
            <legend className="px-2 text-sm font-semibold text-[color:var(--danger)]">
              Ubicación operativa privada
            </legend>
            <p className="text-xs leading-5 text-black/55 dark:text-white/55">
              No se muestra en la web pública ni debe describir posiciones de
              equipos de emergencia.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1.5 text-sm font-medium">
                Latitud operativa
                <input
                  name="latitude"
                  type="number"
                  step="any"
                  required
                  defaultValue={incident.operationalCoordinates.lat}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Longitud operativa
                <input
                  name="longitude"
                  type="number"
                  step="any"
                  required
                  defaultValue={incident.operationalCoordinates.lng}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Radio operativo (m)
                <input
                  name="radiusMeters"
                  type="number"
                  min="100"
                  max="100000"
                  required
                  defaultValue={incident.operationalRadiusMeters}
                  className={inputClass}
                />
              </label>
            </div>
          </fieldset>

          <label className="grid gap-1.5 text-sm font-medium">
            Motivo de la actualización
            <input
              name="reason"
              required
              minLength={8}
              maxLength={500}
              className={inputClass}
              placeholder="Qué ha cambiado y por qué"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Save size={16} aria-hidden />
            Guardar ficha
          </button>
        </form>
      </details>

      <details className="rounded-lg border border-blue-500/25 bg-blue-500/[0.03] p-4 sm:p-5">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-[color:var(--info)]">
            <Globe2 size={18} aria-hidden />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[color:var(--info)]">
              Frontera de publicación
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              Ubicación pública aprobada
            </h2>
            <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
              Introduce una zona generalizada revisada manualmente o limita la
              publicación al municipio y los puntos de entrega. Nunca copies
              aquí la posición operativa.
            </p>
          </div>
        </summary>

        <form action={updatePublicLocation} className="mt-5 grid gap-4">
          <input type="hidden" name="incidentId" value={incident.id} />
          <input
            type="hidden"
            name="expectedUpdatedAt"
            value={incident.updatedAt}
          />
          <PublicLocationFields
            initialMode={publicModeValues[incident.publicArea.mode]}
            initialLabel={incident.publicArea.label}
            initialLatitude={incident.publicArea.coordinates?.lat}
            initialLongitude={incident.publicArea.coordinates?.lng}
            initialRadiusMeters={incident.publicArea.radiusMeters}
            inputClass={inputClass}
          />
          <label className="grid gap-1.5 text-sm font-medium">
            Motivo y fuente de la aprobación
            <input
              name="reason"
              required
              minLength={8}
              maxLength={500}
              className={inputClass}
              placeholder="Qué se publica, con qué fuente y por qué es seguro"
            />
          </label>
          <label className="flex min-h-11 items-start gap-3 rounded-md border border-blue-500/20 bg-[color:var(--surface)] p-3 text-sm leading-5">
            <input
              type="checkbox"
              name="confirmPublicSafety"
              required
              className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
            />
            He comprobado que esta publicación no revela la zona de
            intervención, posiciones de equipos, rutas tácticas ni datos
            sensibles.
          </label>
          <button
            type="submit"
            className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <ShieldCheck size={16} aria-hidden />
            Aprobar ubicación pública
          </button>
          {incident.publicArea.approvedAt ? (
            <p className="flex items-center gap-2 text-xs text-black/65 dark:text-white/65">
              <MapPinned size={14} aria-hidden />
              Última aprobación{" "}
              {formatDateTimeInTimeZone(
                incident.publicArea.approvedAt,
                incident.timeZone,
              )}
              {incident.publicLocationApprovedByName
                ? ` por ${incident.publicLocationApprovedByName}`
                : ""}
            </p>
          ) : null}
        </form>
      </details>
    </div>
  );
}
