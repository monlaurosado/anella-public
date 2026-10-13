import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { IncidentList } from "@/components/incidents/incident-list";
import { UrgentNeedsList } from "@/components/incidents/urgent-needs-list";
import { IncidentMapShell } from "@/components/map/incident-map-shell";
import { Metric } from "@/components/ui/metric";
import { getCachedPublicSnapshot } from "@/lib/public-incidents-cache";
import { getPublicFireDetectionMap } from "@/services/fire-detection-map";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ incidents, stats }, fireDetections] = await Promise.all([
    getCachedPublicSnapshot(),
    getPublicFireDetectionMap(),
  ]);
  const officialSignals = fireDetections.features.filter(
    (feature) => feature.properties.source === "CIVIL_PROTECTION",
  ).length;

  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="sticky top-0 z-20 border-b border-[color:var(--border)] bg-[color:var(--background)]/92 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="flex size-9 items-center justify-center rounded-md bg-[color:var(--foreground)] text-[color:var(--background)]">
              <ShieldCheck size={19} aria-hidden />
            </span>
            <span>
              <span className="block text-sm font-semibold leading-4">
                Anella
              </span>
              <span className="block text-xs text-black/55 dark:text-white/55">
                Incendios y ayuda verificada
              </span>
            </span>
          </Link>
          <Link
            href="/coordinacion"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-3 text-sm font-semibold text-[color:var(--background)] transition hover:opacity-90"
          >
            Panel
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      </header>

      <section className="mx-auto min-h-[calc(100vh-65px)] max-w-7xl px-4 py-4 sm:px-6">
        <div
          className="rounded-lg border-2 border-[color:var(--danger)] bg-[color:var(--surface)] px-4 py-3 text-sm leading-6"
          role="alert"
        >
          <strong>Si hay peligro inmediato, llama al 112.</strong> Anella no
          sustituye a los servicios de emergencia ni envía personas a zonas de
          riesgo.
        </div>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
            data-home-section="fire-map"
          >
            <IncidentMapShell
              incidents={incidents}
              initialDetections={fireDetections}
            />
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-[82px]">
            <div className="grid grid-cols-2 gap-2">
              <Metric
                label="Señales automáticas"
                value={fireDetections.features.length}
                tone="warning"
              />
              <Metric
                label="Avisos oficiales"
                value={officialSignals}
                tone="info"
              />
              <Metric
                label="Emergencias activas"
                value={stats.activeIncidents}
                tone="warning"
              />
              <Metric
                label="Puntos habilitados"
                value={stats.enabledDropOffPoints}
                tone="success"
              />
            </div>

            <section
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
              data-home-section="editorial"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
                Flujo seguro
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal">
                Detecciones visibles. Aportaciones solo en puntos oficiales
                habilitados.
              </h2>
              <p className="mt-3 text-sm leading-6 text-black/65 dark:text-white/65">
                Las señales externas se muestran como detecciones, nunca como
                incendios confirmados. Si una entidad verificada habilita un
                punto de entrega, puedes comunicar voluntariamente qué material
                puedes llevar.
              </p>
            </section>

            <UrgentNeedsList incidents={incidents} />

            <IncidentList incidents={incidents} />

            <div
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 text-sm leading-6"
              role="note"
            >
              Esta web no dirige voluntarios a zonas de riesgo ni muestra
              información táctica. Todo se canaliza a puntos de entrega
              publicados; esos puntos no son refugios ni zonas de evacuación.
            </div>
            <nav
              className="flex flex-wrap gap-4 px-1 text-xs font-semibold"
              aria-label="Información y aportaciones"
            >
              <Link
                href="/aportaciones/ultima"
                className="inline-flex min-h-11 items-center py-3 underline"
              >
                Mi última aportación
              </Link>
              <Link
                href="/privacidad"
                className="inline-flex min-h-11 items-center py-3 underline"
              >
                Privacidad
              </Link>
              <Link
                href="/aviso-legal"
                className="inline-flex min-h-11 items-center py-3 underline"
              >
                Aviso legal
              </Link>
              <Link
                href="/organizaciones/reclamar"
                className="inline-flex min-h-11 items-center py-3 underline"
              >
                Represento a una entidad
              </Link>
            </nav>
          </aside>
        </div>
      </section>
    </main>
  );
}
