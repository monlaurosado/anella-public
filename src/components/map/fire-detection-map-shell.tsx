"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { FireDetectionFeatureCollection } from "@/types/domain";

const FireDetectionMap = dynamic(
  () =>
    import("@/components/map/fire-detection-map").then(
      (module) => module.FireDetectionMap,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[420px] items-center justify-center bg-[color:var(--surface-muted)] text-sm text-black/60 dark:text-white/60">
        Cargando mapa de detecciones…
      </div>
    ),
  },
);

export function FireDetectionMapShell({
  initialData,
  municipalityId,
  scopeLabel,
}: {
  initialData: FireDetectionFeatureCollection;
  municipalityId?: string;
  scopeLabel: string;
}) {
  const [data, setData] = useState(initialData);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const params = new URLSearchParams();
        if (municipalityId) params.set("municipalityId", municipalityId);
        const response = await fetch(`/api/fire-detections?${params}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("refresh failed");
        const payload =
          (await response.json()) as FireDetectionFeatureCollection;
        if (active && payload.type === "FeatureCollection") {
          setData(payload);
          setRefreshFailed(false);
        }
      } catch (error) {
        if (
          active &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setRefreshFailed(true);
        }
      }
    };
    const interval = window.setInterval(
      refresh,
      Math.max(30, data.refreshAfterSeconds) * 1_000,
    );
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [data.refreshAfterSeconds, municipalityId]);

  const overallLabel = {
    healthy: "fuentes al día",
    degraded: "alguna fuente con incidencias",
    stale: "fuentes desactualizadas",
    pending: "pendiente de primera sincronización",
  }[data.overallStatus];
  const healthLabel = {
    healthy: "Al día",
    degraded: "Con incidencias",
    stale: "Desactualizada",
    pending: "Pendiente",
  } as const;

  return (
    <section
      aria-labelledby="fire-detection-map-title"
      className="mb-6 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border)] p-4">
        <div>
          <h2 id="fire-detection-map-title" className="font-semibold">
            Radar automático multifuente
          </h2>
          <p className="mt-1 text-sm font-semibold">Ámbito: {scopeLabel}</p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-black/60 dark:text-white/60">
            El panel comprueba datos nuevos cada minuto. Combina huellas
            VIIRS/MODIS con avisos oficiales y sus estados. Estas señales se
            muestran también en el mapa público; la revisión interna sirve para
            vincularlas o descartarlas, no para autorizar su visualización.
          </p>
        </div>
        <p className="text-xs text-black/55 dark:text-white/55" role="status">
          {data.features.length} señales recientes
          {refreshFailed
            ? " · no se pudo actualizar el panel"
            : ` · ${overallLabel}`}
        </p>
      </div>
      <div
        className="flex flex-wrap gap-x-4 gap-y-2 border-b border-[color:var(--border)] px-4 py-3 text-xs text-black/65 dark:text-white/65"
        aria-label="Leyenda del radar"
      >
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-[#b42318] bg-[#f04438]" />
          Activo o declarado
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-[#b54708] bg-[#f79009]" />
          Señal pendiente o estabilizada
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-[#067647] bg-[#12b76a]" />
          Controlado o vinculado
        </span>
      </div>
      <div
        className="grid gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Estado de fuentes automáticas"
      >
        {data.sourceHealth.map((source) => (
          <div
            key={source.sourceKey}
            className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className="truncate text-xs font-semibold"
                title={source.label}
              >
                {source.label}
              </p>
              <span
                className={
                  source.status === "healthy"
                    ? "text-xs font-semibold text-[color:var(--success)]"
                    : source.status === "pending"
                      ? "text-xs font-semibold text-black/65 dark:text-white/65"
                      : "text-xs font-semibold text-[color:var(--warning)]"
                }
              >
                {healthLabel[source.status]}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-black/55 dark:text-white/55">
              {source.lastSuccessAt
                ? `Último éxito ${new Intl.DateTimeFormat("es-ES", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Europe/Madrid",
                  }).format(new Date(source.lastSuccessAt))}`
                : "Aún no hay una sincronización correcta"}
              {source.imported > 0 ? ` · ${source.imported} nuevas` : ""}
              {source.updated > 0 ? ` · ${source.updated} actualizadas` : ""}
              {source.statusChanged > 0
                ? ` · ${source.statusChanged} cambios de estado`
                : ""}
            </p>
          </div>
        ))}
      </div>
      <FireDetectionMap features={data.features} />
    </section>
  );
}
