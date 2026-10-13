import { randomUUID } from "node:crypto";

import Link from "next/link";
import {
  Building2,
  CalendarClock,
  ClipboardList,
  Plus,
  ShieldCheck,
} from "lucide-react";

import {
  createNeed,
  updateNeed,
  updateNeedStatus,
} from "@/actions/coordination";
import { Badge } from "@/components/ui/badge";
import { DetailPaginationFields } from "@/components/coordination/detail-pagination-fields";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { NeedStatusPill, PriorityPill } from "@/components/ui/status-pill";
import { formatQuantity } from "@/lib/format";
import {
  formatDateTimeInTimeZone,
  formatDateTimeLocalInTimeZone,
} from "@/lib/time-zone";
import type {
  ManagedIncident,
  ManagedNeed,
  NeedOperationalStatus,
} from "@/types/domain";

const operationalStatusLabels: Record<NeedOperationalStatus, string> = {
  draft: "Borrador",
  published: "Publicada",
  open: "Por cubrir",
  committed: "Comprometida",
  en_route: "En camino",
  partially_received: "Parcialmente recibida",
  covered: "Cubierta",
  expired: "Caducada",
  cancelled: "Cancelada",
};

const needTypeLabels: Record<ManagedNeed["type"], string> = {
  water: "Agua",
  food: "Alimentos",
  ice: "Hielo",
  medical_supplies: "Material sanitario",
  transport: "Transporte",
  power: "Energía",
  tools: "Herramientas",
  shelter: "Alojamiento",
  volunteers: "Voluntariado coordinado",
  other: "Otro",
};

const operationalStatusTones: Record<
  NeedOperationalStatus,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  draft: "neutral",
  published: "info",
  open: "warning",
  committed: "warning",
  en_route: "info",
  partially_received: "info",
  covered: "success",
  expired: "danger",
  cancelled: "neutral",
};

const needTypeOptions = [
  ["WATER", "Agua"],
  ["FOOD", "Alimentos"],
  ["ICE", "Hielo"],
  ["MEDICAL_SUPPLIES", "Material sanitario"],
  ["TRANSPORT", "Transporte"],
  ["POWER", "Energía"],
  ["TOOLS", "Herramientas"],
  ["SHELTER", "Alojamiento"],
  ["VOLUNTEERS", "Voluntariado coordinado"],
  ["OTHER", "Otro"],
] as const;

const priorityOptions = [
  ["LOW", "Baja"],
  ["MEDIUM", "Media"],
  ["HIGH", "Alta"],
  ["CRITICAL", "Crítica"],
] as const;

const needStatusLabels = {
  ACTIVE: "Validar y publicar",
  COVERED: "Marcar cubierta",
  CANCELLED: "Cancelar",
  EXPIRED: "Marcar caducada",
} as const;

type NextNeedStatus = keyof typeof needStatusLabels;

const inputClass =
  "min-h-11 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";
const textareaClass =
  "min-h-24 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

function nextNeedStatuses(need: ManagedNeed): NextNeedStatus[] {
  if (need.status === "draft") return ["ACTIVE", "CANCELLED"];
  if (need.status === "covered") {
    return need.quantityNeeded > need.quantityReceived ? ["ACTIVE"] : [];
  }
  if (need.status !== "active") return [];

  const options: NextNeedStatus[] = ["CANCELLED"];
  if (need.quantityReceived >= need.quantityNeeded) {
    options.unshift("COVERED");
  }
  if (need.deadline && new Date(need.deadline).getTime() <= Date.now()) {
    options.push("EXPIRED");
  }
  return options;
}

function QuantityMetric({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="rounded-md bg-[color:var(--surface-muted)] p-3">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-black/65 dark:text-white/65">
        {label}
      </dt>
      <dd className="mt-1 text-base font-semibold tabular-nums">
        {formatQuantity(value, unit)}
      </dd>
    </div>
  );
}

function NeedCard({
  incident,
  need,
  position,
}: {
  incident: ManagedIncident;
  need: ManagedNeed;
  position: number;
}) {
  const remaining = Math.max(
    0,
    need.quantityNeeded - need.quantityReceived - need.quantityCommitted,
  );
  const nextStatuses = nextNeedStatuses(need);
  const safePoint = incident.safePointOptions.find(
    (point) => point.id === need.safePointId,
  );
  const needContext = `la necesidad ${position}, ${need.title}`;

  return (
    <article
      aria-labelledby={`need-title-${need.id}`}
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityPill priority={need.priority} />
            <NeedStatusPill status={need.status} />
            <Badge tone={operationalStatusTones[need.operationalStatus]}>
              {operationalStatusLabels[need.operationalStatus]}
            </Badge>
          </div>
          <h3
            id={`need-title-${need.id}`}
            className="mt-3 text-lg font-semibold"
          >
            {need.title}
            <span className="sr-only">
              , necesidad {position} de este incidente
            </span>
          </h3>
          {need.description ? (
            <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
              {need.description}
            </p>
          ) : null}
        </div>
        <div className="text-right text-xs text-black/65 dark:text-white/65">
          {need.deadline ? (
            <p className="flex items-center justify-end gap-1.5 font-medium">
              <CalendarClock size={14} aria-hidden />
              Límite{" "}
              {formatDateTimeInTimeZone(need.deadline, incident.timeZone)}
            </p>
          ) : (
            <p className="font-medium text-black/60 dark:text-white/60">
              Sin caducidad automática
            </p>
          )}
          <p className="mt-1">Zona {incident.timeZone}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <QuantityMetric
          label="Solicitada"
          value={need.quantityNeeded}
          unit={need.unit}
        />
        <QuantityMetric label="Por cubrir" value={remaining} unit={need.unit} />
        <QuantityMetric
          label="Comprometida"
          value={need.quantityCommitted}
          unit={need.unit}
        />
        <QuantityMetric
          label="En camino"
          value={need.quantityEnRoute}
          unit={need.unit}
        />
        <QuantityMetric
          label="Recibida"
          value={need.quantityReceived}
          unit={need.unit}
        />
      </dl>

      <div className="mt-4 grid gap-2 text-xs text-black/65 dark:text-white/65 sm:grid-cols-2">
        <p>Tipo: {needTypeLabels[need.type]}</p>
        <p>Punto de entrega: {safePoint?.name ?? "No disponible"}</p>
        <p className="flex items-center gap-2">
          <Building2 size={14} aria-hidden />
          Solicitante:{" "}
          {need.requestingOrganizationName ?? "Organización no indicada"}
          {need.requestedByName ? ` · ${need.requestedByName}` : ""}
        </p>
        <p>
          Última actualización:{" "}
          {formatDateTimeInTimeZone(need.updatedAt, incident.timeZone)}
        </p>
        <p className="flex items-center gap-2">
          <ShieldCheck size={14} aria-hidden />
          Validación: {need.validatedByName ?? "Pendiente"}
          {need.validatedAt
            ? ` · ${formatDateTimeInTimeZone(need.validatedAt, incident.timeZone)}`
            : ""}
        </p>
      </div>

      {need.cancellationReason ? (
        <p className="mt-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm">
          <span className="font-semibold">Motivo de cancelación:</span>{" "}
          {need.cancellationReason}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 border-t border-[color:var(--border)] pt-4 lg:grid-cols-2">
        {need.status !== "cancelled" && need.status !== "expired" ? (
          <details className="rounded-md border border-[color:var(--border)]">
            <summary
              aria-label={`Editar cantidad y plazo de ${needContext}`}
              className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Editar cantidad y plazo
            </summary>
            <form
              action={updateNeed}
              aria-label={`Editar cantidad y plazo de ${needContext}`}
              className="grid gap-3 border-t border-[color:var(--border)] p-3"
            >
              <input type="hidden" name="incidentId" value={incident.id} />
              <input type="hidden" name="needId" value={need.id} />
              <DetailPaginationFields
                page={incident.pagination.page}
                pageSize={incident.pagination.pageSize}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-medium">
                  Cantidad total
                  <span className="sr-only"> de {needContext}</span>
                  <input
                    name="quantityNeeded"
                    type="number"
                    min={Math.max(
                      1,
                      need.quantityReceived + need.quantityCommitted,
                    )}
                    max="1000000"
                    required
                    defaultValue={need.quantityNeeded}
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Fecha límite opcional ({incident.timeZone})
                  <span className="sr-only"> de {needContext}</span>
                  <input
                    name="deadline"
                    type="datetime-local"
                    defaultValue={
                      need.deadline
                        ? formatDateTimeLocalInTimeZone(
                            need.deadline,
                            incident.timeZone,
                          )
                        : ""
                    }
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Si esa hora se repite por el cambio horario
                  <span className="sr-only"> para {needContext}</span>
                  <select
                    name="deadlineOccurrence"
                    defaultValue="reject"
                    className={inputClass}
                  >
                    <option value="reject">Avisar y revisar</option>
                    <option value="earlier">Primera vez</option>
                    <option value="later">Segunda vez</option>
                  </select>
                </label>
              </div>
              <label className="grid gap-1.5 text-sm font-medium">
                Motivo del cambio
                <span className="sr-only"> de {needContext}</span>
                <input
                  name="reason"
                  required
                  minLength={8}
                  maxLength={500}
                  className={inputClass}
                  placeholder="Qué cambia y por qué"
                />
              </label>
              <div className="rounded-md bg-amber-500/[0.08] p-3 text-sm leading-6">
                Impacto actual — compromiso:{" "}
                {formatQuantity(need.quantityCommitted, need.unit)}; en camino:{" "}
                {formatQuantity(need.quantityEnRoute, need.unit)}; recepción:{" "}
                {formatQuantity(need.quantityReceived, need.unit)}. No se
                aceptará un total inferior ni un plazo anterior a una ETA
                pendiente.
              </div>
              <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm leading-5">
                <input
                  name="confirmNeedUpdate"
                  type="checkbox"
                  required
                  className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                />
                Confirmo que he revisado el impacto sobre las aportaciones y la
                información que verá la ciudadanía.
                <span className="sr-only"> Revisión de {needContext}.</span>
              </label>
              <button
                type="submit"
                aria-label={`Guardar cambios de ${needContext}`}
                className="min-h-11 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Guardar cambios
              </button>
            </form>
          </details>
        ) : (
          <p className="self-center text-sm text-black/65 dark:text-white/65">
            Una necesidad finalizada no admite edición.
          </p>
        )}

        {nextStatuses.length > 0 ? (
          <details className="rounded-md border border-[color:var(--border)]">
            <summary
              aria-label={`Cambiar estado de ${needContext}`}
              className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Cambiar estado
            </summary>
            <form
              action={updateNeedStatus}
              aria-label={`Cambiar estado de ${needContext}`}
              className="grid gap-3 border-t border-[color:var(--border)] p-3"
            >
              <input type="hidden" name="incidentId" value={incident.id} />
              <input type="hidden" name="needId" value={need.id} />
              <DetailPaginationFields
                page={incident.pagination.page}
                pageSize={incident.pagination.pageSize}
              />
              <label className="grid gap-1.5 text-sm font-medium">
                Nuevo estado
                <span className="sr-only"> de {needContext}</span>
                <select
                  name="status"
                  required
                  defaultValue=""
                  className={inputClass}
                >
                  <option value="" disabled>
                    Selecciona un estado
                  </option>
                  {nextStatuses.map((status) => (
                    <option key={status} value={status}>
                      {needStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Motivo
                <span className="sr-only">
                  {" "}
                  del cambio de estado de {needContext}
                </span>
                <input
                  name="reason"
                  required
                  minLength={8}
                  maxLength={500}
                  className={inputClass}
                  placeholder="Justifica el cambio de estado"
                />
              </label>
              <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm leading-5">
                <input
                  name="confirmNeedStatusChange"
                  type="checkbox"
                  required
                  className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                />
                He revisado las aportaciones pendientes y el efecto de este
                cambio en la publicación.
                <span className="sr-only">
                  {" "}
                  Cambio de estado de {needContext}.
                </span>
              </label>
              <button
                type="submit"
                aria-label={`Aplicar estado a ${needContext}`}
                className="min-h-11 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Aplicar estado
              </button>
            </form>
          </details>
        ) : (
          <p className="self-center text-sm text-black/65 dark:text-white/65">
            No hay transiciones operativas disponibles.
          </p>
        )}
      </div>
    </article>
  );
}

export function IncidentNeeds({ incident }: { incident: ManagedIncident }) {
  const activeSafePoints = incident.safePointOptions.filter(
    (point) => point.isActive && point.validatedAt,
  );

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-black/[0.05] dark:bg-white/10">
            <ClipboardList size={18} aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-semibold">Necesidades del incidente</h2>
            <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
              Este módulo histórico es opcional. Las solicitudes solo se
              publican tras validación humana, con un punto de entrega activo y
              un punto de entrega activo. La fecha límite es opcional.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {incident.needs.length > 0 ? (
            incident.needs.map((need, index) => (
              <NeedCard
                key={need.id}
                incident={incident}
                need={need}
                position={index + 1}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-[color:var(--border)] p-8 text-center">
              <p className="font-semibold">Aún no hay necesidades</p>
              <p className="mt-1 text-sm text-black/65 dark:text-white/65">
                Crea la primera como borrador y valida la información antes de
                publicarla.
              </p>
            </div>
          )}
        </div>
      </section>

      {activeSafePoints.length > 0 ? (
        <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-5">
            <Plus size={17} aria-hidden />
            Crear una necesidad
          </summary>
          <form
            action={createNeed}
            className="grid gap-4 border-t border-[color:var(--border)] p-4 sm:p-5"
          >
            <input type="hidden" name="incidentId" value={incident.id} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <DetailPaginationFields
              page={incident.pagination.page}
              pageSize={incident.pagination.pageSize}
            />
            <input
              type="hidden"
              name="publish"
              value={incident.isPubliclyVisible ? "on" : ""}
            />
            <input type="hidden" name="deadlineOccurrence" value="reject" />

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium md:col-span-2">
                ¿Qué hace falta?
                <input
                  name="title"
                  required
                  minLength={3}
                  maxLength={191}
                  className={inputClass}
                  placeholder="Ej.: Botellas de agua cerradas"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Tipo
                <select name="type" defaultValue="WATER" className={inputClass}>
                  {needTypeOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Punto de entrega
                <select name="safePointId" required className={inputClass}>
                  {activeSafePoints.map((point) => (
                    <option key={point.id} value={point.id}>
                      {point.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Cantidad
                <input
                  name="quantityNeeded"
                  type="number"
                  min="1"
                  max="1000000"
                  required
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Unidad
                <input
                  name="unit"
                  required
                  maxLength={32}
                  defaultValue="uds"
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Prioridad
                <select
                  name="priority"
                  defaultValue="MEDIUM"
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

            <details className="rounded-md border border-[color:var(--border)]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold">
                Añadir detalles (opcional)
              </summary>
              <div className="grid gap-4 border-t border-[color:var(--border)] p-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                  Descripción pública
                  <textarea
                    name="description"
                    maxLength={2000}
                    className={textareaClass}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Fecha límite opcional ({incident.timeZone})
                  <input
                    name="deadline"
                    type="datetime-local"
                    className={inputClass}
                  />
                </label>
              </div>
            </details>

            <p className="rounded-md bg-[color:var(--surface-muted)] p-3 text-sm leading-5">
              {incident.isPubliclyVisible
                ? "La necesidad se validará y aparecerá inmediatamente junto al botón «Lo ofrezco»."
                : "La necesidad se guardará como borrador hasta que la emergencia esté validada y activa."}
            </p>
            <PendingSubmitButton
              pendingLabel="Creando necesidad…"
              className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Plus size={16} aria-hidden />
              {incident.isPubliclyVisible
                ? "Publicar necesidad"
                : "Guardar necesidad"}
            </PendingSubmitButton>
          </form>
        </details>
      ) : (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-4 text-sm leading-6">
          Para crear una solicitud debes disponer de un punto de entrega activo.{" "}
          <Link
            href={`/coordinacion/incidentes/${incident.id}?tab=safe-points`}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
          >
            Revisar puntos de entrega
          </Link>
        </div>
      )}
    </div>
  );
}
