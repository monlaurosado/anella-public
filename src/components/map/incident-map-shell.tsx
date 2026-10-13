"use client";

import dynamic from "next/dynamic";
import {
  BellRing,
  CircleDot,
  Crosshair,
  Flame,
  Layers3,
  MapPin,
  RotateCcw,
  Satellite,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  FIRE_PROVIDER_STATUS_LABELS,
  fireProviderLabel,
} from "@/lib/fire-provider-status";
import { formatMinutesAgo } from "@/lib/format";
import type {
  FireDetectionFeatureCollection,
  FireDetectionMapFeature,
  Incident,
} from "@/types/domain";

const IncidentMap = dynamic(
  () => import("@/components/map/incident-map").then((mod) => mod.IncidentMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[58vh] min-h-[430px] items-center justify-center bg-[color:var(--surface-muted)] text-sm text-black/60 md:h-[68vh] md:min-h-[560px] lg:h-[calc(100vh-220px)] lg:min-h-[620px] dark:text-white/60">
        Cargando mapa nacional…
      </div>
    ),
  },
);

const overallStatusLabel = {
  healthy: "fuentes al día",
  degraded: "alguna fuente con incidencias",
  stale: "fuentes desactualizadas",
  pending: "pendiente de primera sincronización",
} as const;

const fireTypeLabel = {
  FOREST: "Forestal",
  AGRICULTURAL: "Agrícola",
  URBAN: "Urbana",
  THERMAL: "Térmica",
} as const;

type StatusFilter =
  "all" | "active" | "stabilized" | "controlled" | "unknown" | "extinguished";
type SourceFilter = "all" | "official" | "satellite";

function normalizedSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function statusMatches(feature: FireDetectionMapFeature, filter: StatusFilter) {
  if (filter === "all") return true;
  const status = feature.properties.providerStatus;
  if (filter === "active") return status === "ACTIVE" || status === "DECLARED";
  if (filter === "stabilized") return status === "STABILIZED";
  if (filter === "controlled") return status === "CONTROLLED";
  if (filter === "extinguished") return status === "EXTINGUISHED";
  return status === "UNKNOWN";
}

function sourceMatches(feature: FireDetectionMapFeature, filter: SourceFilter) {
  if (filter === "all") return true;
  const official = feature.properties.source === "CIVIL_PROTECTION";
  return filter === "official" ? official : !official;
}

function signalTimestamp(feature: FireDetectionMapFeature) {
  return new Date(signalUpdateIso(feature)).getTime();
}

function signalUpdateIso(feature: FireDetectionMapFeature) {
  return (
    feature.properties.sourceUpdatedAt ??
    feature.properties.providerStatusChangedAt ??
    feature.properties.detectedAt
  );
}

function statusDotClass(feature: FireDetectionMapFeature) {
  const status = feature.properties.providerStatus;
  if (status === "ACTIVE" || status === "DECLARED") return "bg-[#f04438]";
  if (status === "STABILIZED") return "bg-[#f79009]";
  if (status === "CONTROLLED") return "bg-[#12b76a]";
  if (status === "EXTINGUISHED") return "bg-[#98a2b3]";
  return "bg-[#f5b942]";
}

function signalStatusLabel(feature: FireDetectionMapFeature) {
  return feature.properties.providerStatus
    ? FIRE_PROVIDER_STATUS_LABELS[feature.properties.providerStatus]
    : "Detección térmica";
}

export function IncidentMapShell({
  incidents,
  initialDetections,
}: {
  incidents: Incident[];
  initialDetections: FireDetectionFeatureCollection;
}) {
  const [liveIncidents, setLiveIncidents] = useState(incidents);
  const [detections, setDetections] = useState(initialDetections);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [showBurnedAreas, setShowBurnedAreas] = useState(true);
  const [relativeClock, setRelativeClock] = useState(() =>
    new Date(initialDetections.generatedAt).getTime(),
  );
  const [focusRequest, setFocusRequest] = useState<{
    featureId: string;
    sequence: number;
  } | null>(null);
  const [viewRequest, setViewRequest] = useState<{
    mode: "spain" | "signals";
    sequence: number;
  } | null>(null);

  useEffect(() => {
    const updateClock = () => setRelativeClock(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      try {
        controller?.abort();
        controller = new AbortController();
        const requests = await Promise.allSettled([
          fetch("/api/incidents", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/fire-detections", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (!active) return;

        let failed = false;
        const incidentResponse = requests[0];
        if (
          incidentResponse.status === "fulfilled" &&
          incidentResponse.value.ok
        ) {
          const payload = (await incidentResponse.value.json()) as {
            incidents?: Incident[];
          };
          if (Array.isArray(payload.incidents))
            setLiveIncidents(payload.incidents);
          else failed = true;
        } else {
          failed = true;
        }

        const detectionResponse = requests[1];
        if (
          detectionResponse.status === "fulfilled" &&
          detectionResponse.value.ok
        ) {
          const payload =
            (await detectionResponse.value.json()) as FireDetectionFeatureCollection;
          if (payload.type === "FeatureCollection") setDetections(payload);
          else failed = true;
        } else {
          failed = true;
        }
        setRefreshFailed(failed);
      } catch {
        if (active) setRefreshFailed(true);
      }
    };

    void refresh();
    const interval = window.setInterval(
      refresh,
      Math.max(30, detections.refreshAfterSeconds) * 1_000,
    );
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [detections.refreshAfterSeconds]);

  const filteredDetections = useMemo(() => {
    const query = normalizedSearch(search);
    return detections.features.filter((feature) => {
      if (!statusMatches(feature, statusFilter)) return false;
      if (!sourceMatches(feature, sourceFilter)) return false;
      if (!query) return true;
      const searchable = normalizedSearch(
        [
          feature.properties.municipalityName,
          fireProviderLabel(
            feature.properties.provider,
            feature.properties.source,
          ),
          feature.properties.fireType
            ? fireTypeLabel[feature.properties.fireType]
            : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return searchable.includes(query);
    });
  }, [detections.features, search, sourceFilter, statusFilter]);

  const recentSignals = useMemo(
    () =>
      [...filteredDetections]
        .sort((left, right) => signalTimestamp(right) - signalTimestamp(left))
        .slice(0, 60),
    [filteredDetections],
  );
  const officialCount = detections.features.filter(
    (feature) => feature.properties.source === "CIVIL_PROTECTION",
  ).length;
  const thermalCount = detections.features.length - officialCount;
  const activeCount = detections.features.filter((feature) =>
    ["ACTIVE", "DECLARED"].includes(feature.properties.providerStatus ?? ""),
  ).length;
  const healthySources = detections.sourceHealth.filter(
    (source) => source.status === "healthy",
  ).length;
  const sourceCount = detections.sourceHealth.length;
  const generatedAt = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(detections.generatedAt));

  const requestView = (mode: "spain" | "signals") => {
    setViewRequest((current) => ({
      mode,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  };
  const focusSignal = (featureId: string) => {
    setFocusRequest((current) => ({
      featureId,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  };
  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setSourceFilter("all");
  };

  return (
    <section
      aria-labelledby="public-fire-map-title"
      className="relative isolate z-0 flex flex-col"
      data-public-fire-map
    >
      <div className="border-b border-[color:var(--border)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
              En directo · toda España
            </p>
            <h2
              id="public-fire-map-title"
              className="mt-1 text-xl font-semibold"
            >
              Mapa de incendios en España
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-black/60 dark:text-white/60">
              Avisos oficiales y detecciones satelitales se publican
              automáticamente, sin aprobación interna.
            </p>
          </div>
          <div
            className="max-w-64 text-xs leading-5 text-black/60 sm:text-right dark:text-white/60"
            role="status"
          >
            <p className="font-semibold text-[color:var(--foreground)]">
              {detections.features.length} señales visibles
            </p>
            <p>
              {officialCount} oficiales · {activeCount} activos · {thermalCount}{" "}
              térmicas
            </p>
            <p>
              Actualizado {generatedAt}
              {refreshFailed
                ? " · actualización no disponible"
                : ` · ${overallStatusLabel[detections.overallStatus]}`}
            </p>
          </div>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2.5 py-2 text-xs sm:px-3">
        <span
          className="min-h-11 content-center px-1 font-semibold"
          aria-live="polite"
        >
          {filteredDetections.length} de {detections.features.length} señales
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <details className="group static sm:relative">
            <summary
              aria-label="Filtros y capas"
              className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 font-semibold marker:content-none [&::-webkit-details-marker]:hidden"
            >
              <SlidersHorizontal size={15} aria-hidden />
              <span className="sm:hidden">Filtros</span>
              <span className="hidden sm:inline">Filtros y capas</span>
            </summary>

            <div className="absolute left-2 right-2 top-[calc(100%+8px)] z-[1100] w-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3 shadow-2xl sm:left-auto sm:right-0 sm:w-[360px]">
              <p className="mb-3 text-sm font-semibold">
                Filtrar señales y capas
              </p>
              <label className="relative block">
                <span className="sr-only">Buscar municipio o fuente</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/50 dark:text-white/50"
                  size={17}
                  aria-hidden
                />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar municipio o fuente"
                  className="h-11 w-full rounded-md border bg-[color:var(--surface)] pl-10 pr-3 text-sm text-[color:var(--foreground)]"
                />
              </label>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label>
                  <span className="sr-only">Filtrar por estado</span>
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as StatusFilter)
                    }
                    className="h-11 w-full rounded-md border bg-[color:var(--surface)] px-2 text-xs text-[color:var(--foreground)]"
                  >
                    <option value="all">Todos los estados</option>
                    <option value="active">Activos o declarados</option>
                    <option value="stabilized">Estabilizados</option>
                    <option value="controlled">Controlados</option>
                    <option value="unknown">Sin fase confirmada</option>
                    <option value="extinguished">Extinguidos recientes</option>
                  </select>
                </label>
                <label>
                  <span className="sr-only">Filtrar por origen</span>
                  <select
                    value={sourceFilter}
                    onChange={(event) =>
                      setSourceFilter(event.target.value as SourceFilter)
                    }
                    className="h-11 w-full rounded-md border bg-[color:var(--surface)] px-2 text-xs text-[color:var(--foreground)]"
                  >
                    <option value="all">Todas las fuentes</option>
                    <option value="official">Solo avisos oficiales</option>
                    <option value="satellite">Solo satélite</option>
                  </select>
                </label>
              </div>

              <label className="mt-2 inline-flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 font-semibold">
                <input
                  type="checkbox"
                  checked={showBurnedAreas}
                  onChange={(event) => setShowBurnedAreas(event.target.checked)}
                  className="size-4 accent-[color:var(--accent)]"
                />
                <Layers3 size={16} aria-hidden />
                Áreas quemadas EFFIS
              </label>

              <div
                className="grid gap-2 border-t border-[color:var(--border)] pt-3 text-[11px] text-black/65 dark:text-white/65"
                aria-label="Leyenda del mapa público"
              >
                <div className="grid gap-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Satellite size={14} aria-hidden /> Detección térmica por
                    satélite
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <BellRing size={14} aria-hidden /> Aviso de fuente oficial
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Flame size={14} aria-hidden /> Emergencia confirmada
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={14} aria-hidden /> Punto de entrega habilitado
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  <span className="inline-flex items-center gap-1.5">
                    <CircleDot
                      size={14}
                      className="text-[#f04438]"
                      aria-hidden
                    />
                    Activo
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CircleDot
                      size={14}
                      className="text-[#f79009]"
                      aria-hidden
                    />
                    Estabilizado/sin fase
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CircleDot
                      size={14}
                      className="text-[#12b76a]"
                      aria-hidden
                    />
                    Controlado
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Layers3 size={14} aria-hidden />
                    Área quemada cartografiada por EFFIS
                  </span>
                </div>
              </div>

              {(search || statusFilter !== "all" || sourceFilter !== "all") && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 font-semibold"
                >
                  <RotateCcw size={15} aria-hidden />
                  Limpiar filtros
                </button>
              )}
            </div>
          </details>

          <button
            type="button"
            onClick={() => requestView("signals")}
            disabled={
              filteredDetections.length === 0 && liveIncidents.length === 0
            }
            aria-label="Ajustar señales"
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Crosshair size={15} aria-hidden />
            <span className="hidden sm:inline">Ajustar señales</span>
          </button>
          <button
            type="button"
            onClick={() => requestView("spain")}
            aria-label="Toda España"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[color:var(--foreground)] px-3 font-semibold text-[color:var(--background)]"
          >
            <RotateCcw size={15} aria-hidden />
            <span className="hidden sm:inline">Toda España</span>
            <span className="sm:hidden">España</span>
          </button>
        </div>
      </div>

      <div className="relative isolate z-0" data-public-fire-map-stage>
        <IncidentMap
          incidents={liveIncidents}
          detections={filteredDetections}
          focusRequest={focusRequest}
          viewRequest={viewRequest}
          showBurnedAreas={showBurnedAreas}
        />
        <div
          className="pointer-events-none absolute right-3 top-3 z-[500] hidden max-w-[260px] gap-2 rounded-md bg-[#171713]/88 p-3 text-[11px] leading-4 text-white shadow-lg transition-opacity sm:grid"
          data-map-overlay
          aria-label="Leyenda visible del mapa"
        >
          <div className="grid gap-1.5">
            <span className="inline-flex items-center gap-1.5">
              <Satellite size={14} aria-hidden /> Detección térmica
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BellRing size={14} aria-hidden /> Aviso oficial
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Flame size={14} aria-hidden /> Emergencia confirmada
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} aria-hidden /> Punto de entrega
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 border-t border-white/20 pt-2">
            <span className="inline-flex items-center gap-1.5">
              <CircleDot size={14} className="text-[#f04438]" aria-hidden />
              Activo
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CircleDot size={14} className="text-[#f79009]" aria-hidden />
              Estabilizado/sin fase
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CircleDot size={14} className="text-[#12b76a]" aria-hidden />
              Controlado
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 border-t border-white/20 pt-2">
            <span className="inline-flex items-center gap-1.5">
              <Layers3 size={14} aria-hidden />
              Área quemada EFFIS
            </span>
          </div>
        </div>
        <div
          className="pointer-events-none absolute bottom-7 left-3 z-[500] max-w-[250px] rounded-md bg-[#171713]/88 px-2.5 py-2 text-[11px] leading-4 text-white shadow-lg transition-opacity"
          data-map-overlay
        >
          Usa +/− o pellizca en el trackpad o la pantalla. La rueda desplaza la
          página.
        </div>
      </div>

      <details className="group border-t border-[color:var(--border)]" open>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
          <span className="inline-flex items-center gap-2">
            <Flame size={17} aria-hidden />
            Avisos visibles y detecciones recientes
          </span>
          <span className="rounded-full bg-[color:var(--surface-muted)] px-2 py-1 text-xs tabular-nums">
            {recentSignals.length}
          </span>
        </summary>
        <div className="max-h-72 overflow-y-auto border-t border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2">
          {recentSignals.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {recentSignals.map((feature) => (
                <button
                  key={feature.id}
                  type="button"
                  onClick={() => focusSignal(feature.id)}
                  className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-left transition hover:border-[color:var(--control-border)]"
                  aria-label={`Centrar en ${feature.properties.municipalityName ?? "señal"}`}
                >
                  <span
                    className={`size-3 rounded-full ${statusDotClass(feature)}`}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {feature.properties.municipalityName ??
                        fireProviderLabel(
                          feature.properties.provider,
                          feature.properties.source,
                        )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-black/60 dark:text-white/60">
                      {signalStatusLabel(feature)}
                      {feature.properties.fireType
                        ? ` · ${fireTypeLabel[feature.properties.fireType]}`
                        : ""}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium tabular-nums text-black/70 dark:text-white/70">
                      Actualizado{" "}
                      {formatMinutesAgo(
                        signalUpdateIso(feature),
                        relativeClock,
                      )}
                    </span>
                  </span>
                  <Crosshair size={15} aria-hidden />
                </button>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-black/60 dark:text-white/60">
              No hay señales que coincidan con estos filtros.
            </p>
          )}
        </div>
      </details>

      <div className="border-t border-[color:var(--border)] px-4 py-3 text-[11px] leading-5 text-black/60 dark:text-white/60">
        {sourceCount > 0
          ? `${healthySources}/${sourceCount} fuentes al día. `
          : ""}
        Las huellas térmicas son píxeles observados, no perímetros confirmados.
        EFFIS cartografía áreas quemadas con resolución y latencia propias; una
        zona circular discontinua solo localiza de forma aproximada un aviso
        oficial.
      </div>
    </section>
  );
}
