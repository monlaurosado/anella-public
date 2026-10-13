import Link from "next/link";
import { ChevronRight, HandHeart, MapPinOff } from "lucide-react";

import {
  contributionStatusLabels,
  contributionStatusTone,
} from "@/components/coordination/queue-labels";
import { ContributionStatusForm } from "@/components/coordination/contribution-status-form";
import { Badge } from "@/components/ui/badge";
import { formatQuantity } from "@/lib/format";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import type { ManagedContribution } from "@/types/domain";

const gridClass =
  "xl:grid-cols-[minmax(210px,1.4fr)_minmax(230px,1.6fr)_120px_120px_112px_44px]";

export function ContributionQueueList({
  contributions,
}: {
  contributions: ManagedContribution[];
}) {
  if (contributions.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-12 text-center">
        <HandHeart
          className="mx-auto text-black/35 dark:text-white/35"
          aria-hidden
        />
        <h2 className="mt-3 text-base font-semibold">No hay aportaciones</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-black/55 dark:text-white/55">
          Esta vista no contiene aportaciones. Ajusta los filtros para consultar
          otros estados.
        </p>
        <Link
          href="/coordinacion/aportaciones?view=open"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold"
        >
          Limpiar filtros
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-label="Resultados de aportaciones"
      className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
    >
      <div
        className={`hidden ${gridClass} gap-3 border-b border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-black/65 xl:grid dark:text-white/65`}
        aria-hidden
      >
        <span>Aportación</span>
        <span>Destino</span>
        <span>Estado</span>
        <span>Cantidad</span>
        <span>Actividad</span>
        <span />
      </div>

      <div className="divide-y divide-[color:var(--border)]">
        {contributions.map((contribution) => (
          <article key={contribution.id} id={`aportacion-${contribution.id}`}>
            {/* This jump is intentionally a document navigation. The target page
                resolves the contribution's real page on the server and redirects
                to a fragment; an App Router transition can intermittently retain
                the intermediate focusContributionId URL instead of following that
                fragment redirect. */}
            <a
              href={`/coordinacion/incidentes/${contribution.incidentId}?tab=contributions&focusContributionId=${encodeURIComponent(contribution.id)}`}
              aria-label={`Abrir aportación ${contribution.publicCode} en la emergencia ${contribution.incidentCode}${contribution.safePointActive ? "" : "; punto de entrega inactivo o pendiente de validación"}`}
              className={`grid min-h-11 gap-3 p-3 transition hover:bg-black/[0.025] focus-visible:outline-2 focus-visible:outline-offset-[-2px] xl:items-center ${gridClass} xl:px-3 xl:py-2.5 dark:hover:bg-white/[0.035]`}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-xs font-semibold text-black/65 dark:text-white/65">
                    {contribution.publicCode}
                  </span>
                  <h2 className="min-w-0 break-words text-sm font-semibold">
                    {contribution.citizenName}
                  </h2>
                </div>
                <p className="mt-1 break-words text-xs text-black/65 dark:text-white/65">
                  {contribution.incidentCode} · {contribution.municipalityName}
                </p>
              </div>

              <div className="min-w-0">
                <p className="break-words text-sm font-semibold">
                  {contribution.needTitle}
                </p>
                <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1 break-words text-xs text-black/65 dark:text-white/65">
                  {!contribution.safePointActive ? (
                    <MapPinOff
                      className="shrink-0 text-[color:var(--danger)]"
                      size={13}
                      aria-hidden
                    />
                  ) : null}
                  <span className="min-w-0 break-words">
                    {contribution.incidentTitle} · {contribution.safePointName}
                  </span>
                  {!contribution.safePointActive ? (
                    <span className="shrink-0 font-semibold text-[color:var(--danger)]">
                      · Punto no operativo
                    </span>
                  ) : null}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={contributionStatusTone(contribution.status)}>
                  {contributionStatusLabels[contribution.status]}
                </Badge>
              </div>

              <div className="text-sm">
                <p className="font-semibold">
                  <span className="xl:hidden">Cantidad: </span>
                  {formatQuantity(contribution.quantity, contribution.needUnit)}
                </p>
                <p className="mt-1 text-xs text-black/65 dark:text-white/65">
                  Recepción:{" "}
                  {formatQuantity(
                    contribution.deliveredQuantity,
                    contribution.needUnit,
                  )}
                </p>
              </div>

              <div className="text-xs text-black/55 dark:text-white/55">
                <p>
                  <span className="xl:hidden">Actividad: </span>
                  {formatDateTimeInTimeZone(
                    contribution.updatedAt,
                    contribution.incidentTimeZone,
                  )}
                </p>
                {contribution.eta ? (
                  <p className="mt-1">
                    Llegada:{" "}
                    {formatDateTimeInTimeZone(
                      contribution.eta,
                      contribution.incidentTimeZone,
                    )}
                  </p>
                ) : null}
              </div>

              <span className="hidden size-11 items-center justify-center rounded-md text-black/40 xl:inline-flex dark:text-white/40">
                <ChevronRight size={17} aria-hidden />
              </span>
            </a>
            {!["delivered", "cancelled", "no_show"].includes(
              contribution.status,
            ) ? (
              <details className="border-t border-[color:var(--border)] bg-[color:var(--surface-muted)]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
                  Acción rápida segura
                </summary>
                <div className="max-w-md border-t border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                  <ContributionStatusForm
                    key={`${contribution.id}-${contribution.revision}`}
                    incidentId={contribution.incidentId}
                    contributionId={contribution.id}
                    contributionLabel={`${contribution.publicCode}, ${contribution.citizenName}`}
                    status={contribution.status}
                    quantity={contribution.quantity}
                    unit={contribution.needUnit}
                    deliveredQuantity={contribution.deliveredQuantity}
                    revision={contribution.revision}
                    destinationAvailable={contribution.safePointActive}
                    buttonLabel="Guardar estado"
                  />
                </div>
              </details>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
