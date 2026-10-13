import Link from "next/link";
import {
  HandHeart,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  UserRound,
} from "lucide-react";

import { ContributionStatusForm } from "@/components/coordination/contribution-status-form";
import { Badge } from "@/components/ui/badge";
import { FocusHashTarget } from "@/components/coordination/focus-hash-target";
import {
  contributionStatusLabels,
  contributionStatusTone,
} from "@/components/coordination/queue-labels";
import { formatQuantity } from "@/lib/format";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import type { ContributionStatus, ManagedIncident } from "@/types/domain";

export type IncidentContributionFilter = "all" | ContributionStatus;

const contributionFilters: Array<{
  value: IncidentContributionFilter;
  label: string;
}> = [
  { value: "all", label: "Todas" },
  { value: "pledged", label: "Confirmadas" },
  { value: "en_route", label: "En camino" },
  { value: "partially_delivered", label: "Parciales" },
  { value: "delivered", label: "Entregadas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "no_show", label: "No presentadas" },
];

export function parseIncidentContributionFilter(
  value?: string,
): IncidentContributionFilter {
  return contributionFilters.some((filter) => filter.value === value)
    ? (value as IncidentContributionFilter)
    : "all";
}

export function IncidentContributions({
  incident,
  statusFilter,
}: {
  incident: ManagedIncident;
  statusFilter: IncidentContributionFilter;
}) {
  const visibleContributions = incident.contributions;

  return (
    <section>
      <FocusHashTarget />
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-[color:var(--info)]">
          <HandHeart size={18} aria-hidden />
        </span>
        <div>
          <h2 className="text-xl font-semibold">Aportaciones ciudadanas</h2>
          <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
            Actualiza la recepción sin retroceder cantidades ya entregadas. Las
            cancelaciones, ausencias y reasignaciones requieren un motivo
            auditado.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-4 text-sm leading-6">
        <LockKeyhole className="mt-0.5 shrink-0" size={17} aria-hidden />
        <p>
          <span className="font-semibold">
            Información privada de coordinación.
          </span>{" "}
          El nombre, teléfono, correo y notas no forman parte de la web ni de la
          API pública.
        </p>
      </div>

      <nav
        aria-label="Filtrar aportaciones del incidente"
        className="mt-4 flex gap-1 overflow-x-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2"
      >
        {contributionFilters.map((filter) => {
          const count =
            filter.value === "all"
              ? incident.counts.contributions
              : incident.counts.contributionStatuses[filter.value];
          const active = statusFilter === filter.value;

          return (
            <Link
              key={filter.value}
              href={`/coordinacion/incidentes/${incident.id}?tab=contributions&contributionStatus=${filter.value}&pageSize=${incident.pagination.pageSize}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
                active
                  ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                  : "bg-[color:var(--surface-muted)] text-black/65 hover:text-black dark:text-white/65 dark:hover:text-white"
              }`}
            >
              {filter.label}
              <span className="tabular-nums" aria-label={`${count} resultados`}>
                {count.toLocaleString("es-ES")}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 space-y-3">
        {visibleContributions.length > 0 ? (
          visibleContributions.map((contribution) => {
            return (
              <article
                key={contribution.id}
                id={`aportacion-${contribution.id}`}
                tabIndex={-1}
                className="min-w-0 scroll-mt-20 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 target:ring-2 target:ring-[color:var(--info)] focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={contributionStatusTone(contribution.status)}>
                      {contributionStatusLabels[contribution.status]}
                    </Badge>
                    <span className="text-xs font-bold uppercase tracking-wide text-black/65 dark:text-white/65">
                      {contribution.publicCode}
                    </span>
                  </div>

                  <h3 className="mt-3 flex min-w-0 items-start gap-2 text-lg font-semibold">
                    <UserRound
                      className="mt-0.5 shrink-0"
                      size={18}
                      aria-hidden
                    />
                    <span className="min-w-0 break-words">
                      {contribution.citizenName}
                    </span>
                  </h3>
                  <p className="mt-1 break-words text-sm text-black/65 dark:text-white/65">
                    {contribution.needTitle} ·{" "}
                    {formatQuantity(
                      contribution.quantity,
                      contribution.needUnit,
                    )}
                    {contribution.deliveredQuantity > 0
                      ? ` · Recepción: ${formatQuantity(contribution.deliveredQuantity, contribution.needUnit)}`
                      : ""}
                  </p>

                  <details
                    data-contribution-details
                    className="mt-3 min-w-0 rounded-md border border-[color:var(--border)]"
                  >
                    <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
                      Ver datos privados y acciones
                    </summary>
                    <div className="grid min-w-0 gap-5 border-t border-[color:var(--border)] p-3 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] xl:p-4">
                      <div className="min-w-0">
                        <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
                          <div className="flex min-h-11 items-center gap-2 rounded-md bg-[color:var(--surface-muted)] px-3">
                            <Phone className="shrink-0" size={15} aria-hidden />
                            <dt className="sr-only">Teléfono</dt>
                            <dd className="min-w-0 break-all">
                              {contribution.citizenPhone ? (
                                <a
                                  href={`tel:${contribution.citizenPhone}`}
                                  aria-label={`Llamar a ${contribution.citizenName}`}
                                  className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                                >
                                  {contribution.citizenPhone}
                                </a>
                              ) : (
                                "No indicado"
                              )}
                            </dd>
                          </div>
                          <div className="flex min-h-11 items-center gap-2 rounded-md bg-[color:var(--surface-muted)] px-3">
                            <Mail className="shrink-0" size={15} aria-hidden />
                            <dt className="sr-only">Correo</dt>
                            <dd className="min-w-0 break-all">
                              {contribution.citizenEmail ? (
                                <a
                                  href={`mailto:${contribution.citizenEmail}`}
                                  aria-label={`Escribir a ${contribution.citizenName}`}
                                  className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                                >
                                  {contribution.citizenEmail}
                                </a>
                              ) : (
                                "No indicado"
                              )}
                            </dd>
                          </div>
                          <div className="flex min-h-11 items-center gap-2 rounded-md bg-[color:var(--surface-muted)] px-3 sm:col-span-2">
                            <MapPin
                              className="shrink-0"
                              size={15}
                              aria-hidden
                            />
                            <dt className="sr-only">
                              Punto de entrega asignado
                            </dt>
                            <dd className="min-w-0 break-words">
                              {contribution.safePointName}
                              {!contribution.safePointActive
                                ? " · punto inactivo"
                                : ""}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-3 text-xs leading-5 text-black/65 dark:text-white/65">
                          <p>
                            Registrada{" "}
                            {formatDateTimeInTimeZone(
                              contribution.createdAt,
                              incident.timeZone,
                            )}
                            {contribution.eta
                              ? ` · llegada prevista ${formatDateTimeInTimeZone(contribution.eta, incident.timeZone)}`
                              : ""}
                          </p>
                          {contribution.checkedInAt ? (
                            <p>
                              Primera recepción{" "}
                              {formatDateTimeInTimeZone(
                                contribution.checkedInAt,
                                incident.timeZone,
                              )}
                            </p>
                          ) : null}
                        </div>

                        {contribution.notes ? (
                          <div className="mt-3 min-w-0 break-words rounded-md border border-[color:var(--border)] p-3 text-sm leading-6">
                            <p className="text-xs font-bold uppercase tracking-wide text-black/65 dark:text-white/65">
                              Nota privada
                            </p>
                            <p className="mt-1">{contribution.notes}</p>
                          </div>
                        ) : null}
                        {contribution.statusReason ? (
                          <div className="mt-3 min-w-0 break-words rounded-md bg-[color:var(--surface-muted)] p-3 text-sm">
                            <span className="font-semibold">
                              Motivo del último estado:
                            </span>{" "}
                            {contribution.statusReason}
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] p-4">
                        <ContributionStatusForm
                          key={`${contribution.id}-${contribution.revision}`}
                          incidentId={incident.id}
                          contributionId={contribution.id}
                          contributionLabel={`${contribution.publicCode}, ${contribution.citizenName}`}
                          status={contribution.status}
                          quantity={contribution.quantity}
                          unit={contribution.needUnit}
                          deliveredQuantity={contribution.deliveredQuantity}
                          revision={contribution.revision}
                          destinationAvailable={contribution.safePointActive}
                        />
                      </div>
                    </div>
                  </details>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-[color:var(--border)] p-8 text-center">
            <p className="font-semibold">No hay aportaciones en esta vista</p>
            <p className="mt-1 text-sm text-black/65 dark:text-white/65">
              Cambia el filtro para consultar otros estados. Las nuevas promesas
              aparecerán como Confirmadas.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
