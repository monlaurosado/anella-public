import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPinned } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getDropOffPointQueue } from "@/services/incidents";

export const metadata: Metadata = { title: "Puntos de entrega · Coordinación" };

const statusLabel: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  closed: "Cerrado",
  draft: "Borrador",
};

export default async function DropOffPointsPage() {
  const points = await getDropOffPointQueue();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-[color:var(--foreground)] text-[color:var(--background)]">
          <MapPinned size={19} aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Puntos de entrega
          </h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Destinos logísticos publicados por las entidades responsables. No
            son refugios ni puntos de evacuación.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {points.map((point) => (
          <article
            key={point.id}
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Badge tone={point.status === "active" ? "success" : "neutral"}>
                  {statusLabel[point.status] ?? point.status}
                </Badge>
                <h2 className="mt-3 font-semibold">{point.name}</h2>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  {point.address}
                </p>
              </div>
              <span className="rounded-full bg-[color:var(--surface-muted)] px-2 py-1 text-xs font-semibold">
                {point.contributionCount} aportaciones
              </span>
            </div>
            <p className="mt-3 text-xs text-black/60 dark:text-white/60">
              {point.incident.publicCode} · {point.incident.title} ·{" "}
              {point.incident.municipalityName}
            </p>
            <Link
              href={`/coordinacion/incidentes/${point.incident.id}?tab=safe-points`}
              className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline"
            >
              Gestionar punto <ArrowRight size={15} aria-hidden />
            </Link>
          </article>
        ))}
        {points.length === 0 ? (
          <p className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
            Todavía no hay puntos de entrega en tu ámbito.
          </p>
        ) : null}
      </div>
    </main>
  );
}
