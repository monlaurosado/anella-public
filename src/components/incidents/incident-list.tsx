import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";

import type { Incident } from "@/types/domain";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import { IncidentStatusPill, PriorityPill } from "@/components/ui/status-pill";

export function IncidentList({ incidents }: { incidents: Incident[] }) {
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="border-b border-[color:var(--border)] p-4">
        <h2 className="text-sm font-semibold">Emergencias publicadas</h2>
        <p className="mt-1 text-xs text-black/55 dark:text-white/55">
          Solo se muestran emergencias validadas.
        </p>
      </div>
      <div className="divide-y divide-[color:var(--border)]">
        {incidents.length === 0 ? (
          <p className="p-4 text-sm leading-6 text-black/60 dark:text-white/60">
            No hay emergencias confirmadas publicadas en este momento.
          </p>
        ) : null}
        {incidents.map((incident) => {
          const activePoints = incident.safePoints.length;

          return (
            <Link
              key={incident.id}
              href={`/incidentes/${incident.id}`}
              className="block p-4 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <IncidentStatusPill status={incident.status} />
                    <PriorityPill priority={incident.priority} />
                  </div>
                  <h3 className="mt-3 text-base font-semibold">
                    {incident.title}
                  </h3>
                  <p className="mt-1 flex items-center gap-1 text-xs text-black/55 dark:text-white/55">
                    <MapPin size={13} aria-hidden />
                    {incident.municipality.name} · actualizado{" "}
                    {formatDateTimeInTimeZone(
                      incident.updatedAt,
                      incident.timeZone,
                    )}
                  </p>
                  <p className="mt-3 text-sm leading-5 text-black/65 dark:text-white/65">
                    {activePoints > 0
                      ? `${activePoints} puntos de entrega habilitados`
                      : "Sin puntos de entrega habilitados"}
                  </p>
                </div>
                <ArrowRight
                  className="mt-1 shrink-0 text-black/35 dark:text-white/35"
                  size={18}
                  aria-hidden
                />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
