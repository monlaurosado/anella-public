import { History, UserRound } from "lucide-react";

import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import type { ManagedIncident } from "@/types/domain";
import {
  presentIncidentActivity,
  presentIncidentEntity,
} from "@/components/coordination/incident-activity-presenter";

export function IncidentActivity({ incident }: { incident: ManagedIncident }) {
  return (
    <section>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-black/[0.05] dark:bg-white/10">
          <History size={18} aria-hidden />
        </span>
        <div>
          <h2 className="text-xl font-semibold">Actividad y auditoría</h2>
          <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
            Historial completo de la emergencia con actor, fecha y contexto de
            cada decisión. Las entradas más recientes aparecen primero.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {incident.activity.length > 0 ? (
          incident.activity.map((entry, index) => {
            const presentation = presentIncidentActivity(
              entry.action,
              entry.metadata,
              incident.timeZone,
            );
            return (
              <details
                key={entry.id}
                open={index < 3}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
              >
                <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-5">
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {presentation.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-black/65 dark:text-white/65">
                      <UserRound size={13} aria-hidden />
                      {entry.actorName} ·{" "}
                      {formatDateTimeInTimeZone(
                        entry.createdAt,
                        incident.timeZone,
                      )}
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-black/65 dark:text-white/65">
                    {presentIncidentEntity(entry.entityType)}
                  </span>
                </summary>

                <div className="border-t border-[color:var(--border)] bg-[color:var(--background)] p-4 sm:p-5">
                  <p className="text-sm leading-6">{presentation.summary}</p>
                  {presentation.details.length > 0 ? (
                    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                      {presentation.details.map((detail) => (
                        <div
                          key={`${detail.label}-${detail.value}`}
                          className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
                        >
                          <dt className="text-[11px] font-bold uppercase tracking-wide text-black/65 dark:text-white/65">
                            {detail.label}
                          </dt>
                          <dd className="mt-1 break-words text-sm leading-6">
                            {detail.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              </details>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-[color:var(--border)] p-8 text-center">
            <p className="font-semibold">Sin actividad registrada</p>
            <p className="mt-1 text-sm text-black/65 dark:text-white/65">
              Las próximas mutaciones auditadas aparecerán en este historial.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
