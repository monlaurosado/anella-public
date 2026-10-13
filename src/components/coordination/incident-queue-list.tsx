import Link from "next/link";
import { ChevronRight, Inbox } from "lucide-react";

import { incidentTypeLabels } from "@/components/coordination/queue-labels";
import { Badge } from "@/components/ui/badge";
import { IncidentStatusPill, PriorityPill } from "@/components/ui/status-pill";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import type { IncidentQueueItem } from "@/types/domain";

const gridClass =
  "@[59rem]:grid-cols-[minmax(220px,2fr)_112px_126px_minmax(130px,1fr)_90px_112px_44px]";

export function IncidentQueueList({
  incidents,
}: {
  incidents: IncidentQueueItem[];
}) {
  if (incidents.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-12 text-center">
        <Inbox
          className="mx-auto text-black/35 dark:text-white/35"
          aria-hidden
        />
        <h2 className="mt-3 text-base font-semibold">No hay resultados</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-black/55 dark:text-white/55">
          No hay emergencias que coincidan con esta vista. Ajusta los filtros o
          abre otra vista guardada.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Resultados de emergencias"
      className="@container rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
    >
      <div
        data-queue-header
        className={`hidden ${gridClass} gap-3 rounded-t-[calc(0.5rem-1px)] border-b border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-black/65 @[59rem]:grid dark:text-white/65`}
        aria-hidden
      >
        <span>Emergencia</span>
        <span>Estado</span>
        <span>Prioridad / tipo</span>
        <span>Ámbito</span>
        <span>Aportaciones</span>
        <span>Actividad</span>
        <span />
      </div>

      <div className="divide-y divide-[color:var(--border)]">
        {incidents.map((incident) => (
          <article key={incident.id}>
            <Link
              href={`/coordinacion/incidentes/${incident.id}`}
              aria-label={`Abrir emergencia ${incident.publicCode}: ${incident.title}`}
              data-queue-row
              className={`grid min-h-11 gap-3 p-3 transition hover:bg-black/[0.025] focus-visible:outline-2 focus-visible:outline-offset-[-2px] @[59rem]:items-center ${gridClass} @[59rem]:px-3 @[59rem]:py-2.5 dark:hover:bg-white/[0.035]`}
            >
              <div data-queue-field="incident" className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-xs font-semibold text-black/65 dark:text-white/65">
                    {incident.publicCode}
                  </span>
                  <h2
                    data-queue-title
                    className="min-w-0 break-words text-sm font-semibold"
                  >
                    {incident.title}
                  </h2>
                </div>
                <p
                  data-queue-field="scope"
                  className="mt-1 break-words text-xs text-black/65 @[59rem]:hidden dark:text-white/65"
                >
                  {incident.municipalityName} · {incident.organizationName}
                </p>
              </div>

              <div
                data-queue-field="status"
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-xs font-medium text-black/65 @[59rem]:hidden dark:text-white/65">
                  Estado
                </span>
                <IncidentStatusPill status={incident.status} />
              </div>

              <div
                data-queue-field="priority"
                className="flex flex-wrap items-center gap-2 @[59rem]:grid @[59rem]:justify-items-start @[59rem]:gap-1"
              >
                <PriorityPill priority={incident.priority} />
                <span className="text-xs text-black/55 dark:text-white/55">
                  {incidentTypeLabels[incident.type]}
                </span>
              </div>

              <div
                data-queue-field="scope"
                className="hidden min-w-0 @[59rem]:block"
              >
                <p className="break-words text-xs font-semibold">
                  {incident.municipalityName}
                </p>
                <p className="mt-1 break-words text-xs text-black/65 dark:text-white/65">
                  {incident.organizationName}
                </p>
              </div>

              <div
                data-queue-field="contributions"
                className="flex flex-wrap gap-1.5"
              >
                <Badge
                  tone={incident.pendingDeliveries > 0 ? "warning" : "neutral"}
                  className="h-6 px-2"
                >
                  {incident.pendingDeliveries} pendientes
                </Badge>
              </div>

              <div
                data-queue-field="activity"
                className="text-xs text-black/55 dark:text-white/55"
              >
                <p>
                  <span className="@[59rem]:hidden">Actividad: </span>
                  {formatDateTimeInTimeZone(
                    incident.lastActivityAt,
                    incident.timeZone,
                  )}
                </p>
              </div>

              <span className="hidden size-11 items-center justify-center rounded-md text-black/40 @[59rem]:inline-flex dark:text-white/40">
                <ChevronRight size={17} aria-hidden />
              </span>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
