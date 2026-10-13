import Link from "next/link";
import { HandHeart, MapPin, PackageCheck } from "lucide-react";

import { calculateRemainingQuantity } from "@/lib/contribution-quantities";
import { formatQuantity } from "@/lib/format";
import type { Incident } from "@/types/domain";

const visibleStatuses = new Set([
  "open",
  "committed",
  "en_route",
  "partially_received",
]);

export function UrgentNeedsList({ incidents }: { incidents: Incident[] }) {
  const needs = incidents
    .flatMap((incident) =>
      incident.needs.map((need) => ({
        incident,
        need,
        point: incident.safePoints.find(
          (candidate) => candidate.id === need.safePointId,
        ),
      })),
    )
    .filter(
      ({ need, point }) =>
        Boolean(point) &&
        visibleStatuses.has(need.operationalStatus) &&
        calculateRemainingQuantity(need) > 0,
    )
    .slice(0, 6);

  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="border-b border-[color:var(--border)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
          Ayuda solicitada ahora
        </p>
        <h2 className="mt-2 text-lg font-semibold">Necesidades verificadas</h2>
      </div>

      {needs.length > 0 ? (
        <div className="divide-y divide-[color:var(--border)]">
          {needs.map(({ incident, need, point }) => {
            if (!point) return null;
            const remaining = calculateRemainingQuantity(need);
            const href = `/incidentes/${incident.id}?punto=${encodeURIComponent(point.id)}&necesidad=${encodeURIComponent(need.id)}#punto-${encodeURIComponent(point.id)}`;

            return (
              <article key={need.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-[color:var(--warning)]">
                    <PackageCheck size={17} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{need.title}</h3>
                    <p className="mt-1 text-sm text-black/65 dark:text-white/65">
                      Faltan {formatQuantity(remaining, need.unit)}
                    </p>
                    <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-black/55 dark:text-white/55">
                      <MapPin className="mt-0.5 shrink-0" size={13} aria-hidden />
                      {point.name} · {incident.municipality.name}
                    </p>
                  </div>
                </div>
                <Link
                  href={href}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)]"
                >
                  <HandHeart size={16} aria-hidden />
                  Lo ofrezco
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="p-4 text-sm leading-6 text-black/60 dark:text-white/60">
          Ahora mismo no hay aportaciones concretas solicitadas. No lleves
          material a ningún punto sin una petición publicada.
        </p>
      )}
    </section>
  );
}
