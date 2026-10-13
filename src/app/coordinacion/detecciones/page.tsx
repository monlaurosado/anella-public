import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Globe2,
  MapPin,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import {
  dismissDetection,
  linkDetection,
  syncAutomaticFireSources,
  syncFirms,
} from "@/actions/detections";
import {
  copySearchParams,
  type RawSearchParams,
} from "@/components/coordination/queue-query";
import { Badge } from "@/components/ui/badge";
import { FireDetectionMapShell } from "@/components/map/fire-detection-map-shell";
import { getOperationalTimeZone } from "@/config/env";
import {
  FIRE_PROVIDER_STATUS_LABELS,
  fireProviderLabel,
  type FireProviderStatus,
} from "@/lib/fire-provider-status";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import { canonicalPaginationHref } from "@/lib/pagination-canonical";
import { readSignedFlash, type FlashSearchParams } from "@/lib/signed-flash";
import { getDetectionQueue } from "@/services/detections";
import { getFireDetectionMap } from "@/services/fire-detection-map";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Radar externo · Coordinación" };

type DetectionQuery = FlashSearchParams & {
  municipalityId?: string;
  municipalityQuery?: string;
  page?: string;
  pageSize?: string;
};

function requestedPage(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 999_999
    ? parsed
    : 1;
}

const sourceLabels: Record<string, string> = {
  NASA_FIRMS: "NASA FIRMS",
  EFFIS: "EFFIS",
  INCENDISCAT: "Incendis.cat",
  AEMET: "AEMET",
  METEOCAT: "Meteocat",
  EMERGENCY_112: "112",
  CIVIL_PROTECTION: "Protección Civil",
  MANUAL: "Manual",
  OTHER: "Otra fuente",
};

function officialStatusLabel(status: string | null) {
  if (!status) return null;
  return FIRE_PROVIDER_STATUS_LABELS[status as FireProviderStatus] ?? status;
}

function officialStatusTone(status: string | null) {
  if (status === "ACTIVE" || status === "DECLARED") return "danger" as const;
  if (status === "STABILIZED") return "warning" as const;
  if (status === "CONTROLLED") return "success" as const;
  return "neutral" as const;
}

function queueHref(
  query: Pick<DetectionQuery, "municipalityId" | "pageSize">,
  page: number,
) {
  const params = new URLSearchParams();
  if (query.municipalityId) {
    params.set("municipalityId", query.municipalityId);
  }
  if (query.pageSize) params.set("pageSize", query.pageSize);
  params.set("page", String(page));
  return `/coordinacion/detecciones?${params.toString()}`;
}

export default async function DetectionQueuePage({
  searchParams,
}: {
  searchParams: Promise<DetectionQuery>;
}) {
  const query = await searchParams;
  const flash = readSignedFlash(query, "/coordinacion/detecciones");
  const operationalTimeZone = getOperationalTimeZone();
  const queue = await getDetectionQueue({
    municipalityId: query.municipalityId,
    municipalityQuery: query.municipalityQuery,
    page: query.page,
    pageSize: query.pageSize,
  });
  const mapData = await getFireDetectionMap({
    municipalityId: queue.municipalityId,
  });
  const canonicalPath = canonicalPaginationHref(
    "/coordinacion/detecciones",
    copySearchParams(query as RawSearchParams),
    [
      {
        parameter: "page",
        requestedPage: requestedPage(query.page),
        pageCount: queue.pageCount,
      },
    ],
  );
  if (canonicalPath) redirect(canonicalPath);
  const firstResult =
    queue.total === 0 ? 0 : (queue.page - 1) * queue.pageSize + 1;
  const lastResult = Math.min(queue.page * queue.pageSize, queue.total);
  const mapScopeLabel = queue.isNationalScope
    ? "Toda España"
    : (queue.municipalityName ?? "Municipio sin configurar");

  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <Link
              href="/coordinacion/incidentes"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-black/60 dark:text-white/60"
            >
              <ArrowLeft size={16} aria-hidden />
              Incidentes
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">
              Señales externas pendientes
            </h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              Se visualizan automáticamente en el mapa público. Esta cola sirve
              para vincularlas a un incidente o descartar falsos positivos.
            </p>
          </div>
          {queue.canUseNationalScope ? (
            <form action={syncAutomaticFireSources}>
              {queue.municipalityId ? (
                <input
                  type="hidden"
                  name="municipalityId"
                  value={queue.municipalityId}
                />
              ) : null}
              {queue.isNationalScope ? (
                <input type="hidden" name="returnScope" value="national" />
              ) : null}
              <input type="hidden" name="page" value={String(queue.page)} />
              <input
                type="hidden"
                name="pageSize"
                value={String(queue.pageSize)}
              />
              <button
                type="submit"
                className="inline-flex h-11 items-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)]"
              >
                <RefreshCw size={16} aria-hidden />
                Actualizar fuentes
              </button>
            </form>
          ) : (
            <form action={syncFirms}>
              <input
                type="hidden"
                name="municipalityId"
                value={queue.municipalityId ?? ""}
              />
              <input type="hidden" name="page" value={String(queue.page)} />
              <input
                type="hidden"
                name="pageSize"
                value={String(queue.pageSize)}
              />
              <button
                type="submit"
                disabled={queue.selectionRequired}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <RefreshCw size={16} aria-hidden />
                Importar FIRMS
              </button>
            </form>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        {flash.notice ? (
          <p
            className="mb-4 rounded-md border border-[color:var(--success)]/35 bg-[color:var(--surface)] p-3 text-sm text-[color:var(--success)]"
            role="status"
          >
            {flash.notice}
          </p>
        ) : null}
        {flash.error ? (
          <p
            className="mb-4 rounded-md border border-[color:var(--danger)]/35 bg-[color:var(--surface)] p-3 text-sm text-[color:var(--danger)]"
            role="alert"
          >
            {flash.error}
          </p>
        ) : null}

        <section className="mb-5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Globe2 size={17} aria-hidden />
                <h2 className="text-sm font-semibold">Ámbito del radar</h2>
              </div>
              <p className="mt-2 text-lg font-semibold">{mapScopeLabel}</p>
              <p className="mt-1 max-w-2xl text-sm text-black/60 dark:text-white/60">
                {queue.canUseNationalScope
                  ? "Toda España muestra la cola nacional completa. Elegir un municipio solo filtra el mapa y la gestión; no cambia tu cuenta ni oculta el resto de señales de forma permanente."
                  : "Tu cuenta trabaja dentro del municipio asignado. El radar y las acciones se limitan automáticamente a ese ámbito."}
              </p>
            </div>
            {queue.canUseNationalScope && !queue.isNationalScope ? (
              <Link
                href={queueHref({ pageSize: String(queue.pageSize) }, 1)}
                className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
              >
                Ver toda España
              </Link>
            ) : null}
          </div>

          {queue.municipalitySelectionInvalid ? (
            <p
              className="mt-3 rounded-md border border-[color:var(--danger)]/35 p-3 text-sm text-[color:var(--danger)]"
              role="alert"
            >
              El municipio indicado ya no existe. Se ha abierto el radar
              nacional.
            </p>
          ) : null}

          {queue.canUseNationalScope ? (
            <div className="mt-4 border-t border-[color:var(--border)] pt-4">
              <form
                method="get"
                role="search"
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <label className="grid gap-1 text-sm font-medium">
                  Buscar municipio para filtrar
                  <span className="relative">
                    <Search
                      size={16}
                      aria-hidden
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/45 dark:text-white/45"
                    />
                    <input
                      name="municipalityQuery"
                      type="search"
                      minLength={2}
                      maxLength={80}
                      defaultValue={queue.municipalityQuery}
                      placeholder="Nombre, provincia o comunidad autónoma"
                      className="h-11 w-full rounded-md border border-[color:var(--border)] bg-transparent pl-10 pr-3"
                    />
                  </span>
                </label>
                <input
                  type="hidden"
                  name="pageSize"
                  value={String(queue.pageSize)}
                />
                <button
                  type="submit"
                  className="h-11 self-end rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold"
                >
                  Buscar
                </button>
              </form>

              {queue.municipalityQuery.length === 1 ? (
                <p className="mt-3 text-sm text-black/60 dark:text-white/60">
                  Escribe al menos dos caracteres para buscar entre los 8.132
                  municipios oficiales.
                </p>
              ) : null}
              {queue.municipalityQuery.length >= 2 ? (
                queue.municipalities.length > 0 ? (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {queue.municipalities.map((municipality) => (
                      <li key={municipality.id}>
                        <Link
                          href={queueHref(
                            {
                              municipalityId: municipality.id,
                              pageSize: String(queue.pageSize),
                            },
                            1,
                          )}
                          className="block min-h-11 rounded-md border border-[color:var(--border)] px-3 py-2 text-sm transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                        >
                          <span className="block font-semibold">
                            {municipality.name}
                          </span>
                          <span className="block text-xs text-black/55 dark:text-white/55">
                            {[municipality.province, municipality.region]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-black/60 dark:text-white/60">
                    No hay municipios que coincidan. Prueba con el nombre de la
                    provincia o la comunidad autónoma.
                  </p>
                )
              ) : null}
            </div>
          ) : null}

          <form
            method="get"
            className="mt-4 flex flex-wrap items-end gap-2 border-t border-[color:var(--border)] pt-4"
          >
            {queue.municipalityId ? (
              <input
                type="hidden"
                name="municipalityId"
                value={queue.municipalityId}
              />
            ) : null}
            <label className="grid gap-1 text-sm font-medium">
              Filas por página
              <select
                name="pageSize"
                defaultValue={String(queue.pageSize)}
                className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
              >
                {queue.pageSizes.map((pageSize) => (
                  <option key={pageSize} value={pageSize}>
                    {pageSize}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-11 rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
            >
              Aplicar
            </button>
          </form>
        </section>

        <FireDetectionMapShell
          key={queue.municipalityId ?? "all"}
          initialData={mapData}
          municipalityId={queue.municipalityId ?? undefined}
          scopeLabel={mapScopeLabel}
        />

        {queue.selectionRequired ? (
          <p
            className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--surface)] p-5 text-sm"
            role="alert"
          >
            Esta cuenta de coordinación no tiene un municipio asignado. La
            administración global debe completar ese dato antes de que pueda
            revisar o gestionar señales.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-center gap-2">
                <RadioTower size={18} aria-hidden />
                <h2 className="text-lg font-semibold">
                  {queue.isNationalScope
                    ? "Señales pendientes en España"
                    : "Señales pendientes del municipio"}{" "}
                  ({queue.total})
                </h2>
              </div>
              <p className="text-sm text-black/55 dark:text-white/55">
                Mostrando {firstResult}–{lastResult} de {queue.total}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {queue.detections.length === 0 ? (
                <p className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5 text-sm text-black/60 dark:text-white/60">
                  {queue.isNationalScope
                    ? "No hay señales automáticas pendientes de revisión en España."
                    : "No hay señales pendientes de revisión en este municipio."}
                </p>
              ) : null}
              {queue.detections.map((detection, detectionIndex) => {
                const detectionMunicipalityId =
                  detection.municipalityId ?? queue.municipalityId ?? "";
                const actionContext = {
                  municipalityId: detectionMunicipalityId,
                  ...(queue.isNationalScope ? { returnScope: "national" } : {}),
                  page: String(queue.page),
                  pageSize: String(queue.pageSize),
                };
                return (
                  <article
                    key={detection.id}
                    aria-labelledby={`detection-title-${detection.id}`}
                    className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,auto)]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3
                            id={`detection-title-${detection.id}`}
                            className="text-sm font-semibold"
                          >
                            Señal {firstResult + detectionIndex} ·{" "}
                            {fireProviderLabel(
                              detection.provider,
                              sourceLabels[detection.source] ??
                                detection.source,
                            )}
                          </h3>
                          <Badge tone="info">
                            {fireProviderLabel(
                              detection.provider,
                              sourceLabels[detection.source] ??
                                detection.source,
                            )}
                          </Badge>
                          <Badge
                            tone={
                              detection.municipalityName ? "neutral" : "warning"
                            }
                          >
                            {detection.municipalityName ??
                              "Sin municipio asignado"}
                          </Badge>
                          {officialStatusLabel(detection.providerStatus) ? (
                            <Badge
                              tone={officialStatusTone(
                                detection.providerStatus,
                              )}
                            >
                              {officialStatusLabel(detection.providerStatus)}
                            </Badge>
                          ) : null}
                          {detection.confidence ? (
                            <span className="text-xs text-black/55 dark:text-white/55">
                              Confianza {detection.confidence}
                            </span>
                          ) : null}
                          {detection.satellite ? (
                            <span className="text-xs text-black/55 dark:text-white/55">
                              {detection.satellite}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-black/65 dark:text-white/65">
                          Ubicación operativa interna · no publicar
                        </p>
                        <p className="mt-1 flex items-center gap-2 font-semibold">
                          <MapPin size={15} aria-hidden />
                          {detection.latitude.toFixed(5)},{" "}
                          {detection.longitude.toFixed(5)}
                        </p>
                        <p className="mt-1 text-xs text-black/55 dark:text-white/55">
                          {formatDateTimeInTimeZone(
                            detection.detectedAt,
                            operationalTimeZone,
                          )}
                          {detection.brightness
                            ? ` · Brillo ${detection.brightness.toFixed(1)}`
                            : ""}
                          {detection.fireRadiativePowerMw
                            ? ` · FRP ${detection.fireRadiativePowerMw.toFixed(1)} MW`
                            : ""}
                          {detection.footprintAreaHectares
                            ? ` · Huella ${detection.footprintAreaHectares.toFixed(1)} ha`
                            : ""}
                        </p>
                      </div>

                      <div className="grid content-start gap-3">
                        {detectionMunicipalityId ? (
                          <Link
                            href={`/coordinacion/incidentes/nuevo?detectionId=${encodeURIComponent(
                              detection.id,
                            )}`}
                            aria-label={`Crear borrador desde la señal ${firstResult + detectionIndex}, ${sourceLabels[detection.source] ?? detection.source}, detectada el ${formatDateTimeInTimeZone(detection.detectedAt, operationalTimeZone)}`}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
                          >
                            <Plus size={16} aria-hidden />
                            Crear borrador desde la señal
                          </Link>
                        ) : (
                          <p className="rounded-md border border-[color:var(--warning)]/40 p-3 text-sm">
                            Esta señal todavía no tiene municipio responsable.
                            Se mantiene visible en el radar nacional y la
                            próxima sincronización volverá a intentar asignarla.
                          </p>
                        )}
                        {queue.municipalityId && queue.incidents.length > 0 ? (
                          <form
                            action={linkDetection}
                            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                          >
                            {Object.entries(actionContext).map(
                              ([name, value]) => (
                                <input
                                  key={name}
                                  type="hidden"
                                  name={name}
                                  value={value}
                                />
                              ),
                            )}
                            <input
                              type="hidden"
                              name="detectionId"
                              value={detection.id}
                            />
                            <label className="grid gap-1 text-xs font-medium">
                              Vincular a un incidente del municipio
                              <span className="sr-only">
                                {` para la señal ${firstResult + detectionIndex}, ${sourceLabels[detection.source] ?? detection.source}, detectada el ${formatDateTimeInTimeZone(detection.detectedAt, operationalTimeZone)}`}
                              </span>
                              <select
                                name="incidentId"
                                required
                                className="h-11 min-w-0 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
                              >
                                {queue.incidents.map((incident) => (
                                  <option key={incident.id} value={incident.id}>
                                    {incident.publicCode} · {incident.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="submit"
                              aria-label={`Vincular la señal ${firstResult + detectionIndex}, ${sourceLabels[detection.source] ?? detection.source}, detectada el ${formatDateTimeInTimeZone(detection.detectedAt, operationalTimeZone)}`}
                              className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-4 text-sm font-semibold transition hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.04]"
                            >
                              Vincular
                            </button>
                          </form>
                        ) : queue.municipalityId ? (
                          <p className="text-sm text-black/55 dark:text-white/55">
                            No hay incidentes abiertos a los que vincularla.
                          </p>
                        ) : detectionMunicipalityId ? (
                          <Link
                            href={queueHref(
                              {
                                municipalityId: detectionMunicipalityId,
                                pageSize: String(queue.pageSize),
                              },
                              1,
                            )}
                            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
                          >
                            Abrir la cola municipal para vincular
                          </Link>
                        ) : null}

                        {detectionMunicipalityId ? (
                          <details className="rounded-md border border-[color:var(--border)] p-3">
                            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[color:var(--danger)]">
                              <X size={16} aria-hidden />
                              Descartar señal
                              <span className="sr-only">
                                {` ${firstResult + detectionIndex}, ${sourceLabels[detection.source] ?? detection.source}, detectada el ${formatDateTimeInTimeZone(detection.detectedAt, operationalTimeZone)}`}
                              </span>
                            </summary>
                            <form
                              action={dismissDetection}
                              className="mt-3 grid gap-3"
                            >
                              {Object.entries(actionContext).map(
                                ([name, value]) => (
                                  <input
                                    key={name}
                                    type="hidden"
                                    name={name}
                                    value={value}
                                  />
                                ),
                              )}
                              <input
                                type="hidden"
                                name="detectionId"
                                value={detection.id}
                              />
                              <label className="grid gap-1 text-sm font-medium">
                                Motivo del descarte
                                <span className="sr-only">
                                  {` de la señal ${firstResult + detectionIndex}, ${sourceLabels[detection.source] ?? detection.source}, detectada el ${formatDateTimeInTimeZone(detection.detectedAt, operationalTimeZone)}`}
                                </span>
                                <textarea
                                  name="reason"
                                  required
                                  minLength={8}
                                  maxLength={500}
                                  className="min-h-24 rounded-md border border-[color:var(--border)] bg-transparent p-3"
                                  placeholder="Ej.: lectura duplicada confirmada en la revisión."
                                />
                              </label>
                              <label className="flex min-h-11 items-center gap-3 text-sm">
                                <input
                                  type="checkbox"
                                  name="confirmed"
                                  value="true"
                                  required
                                  className="size-5"
                                />
                                Confirmo que esta señal no debe seguir
                                pendiente.
                                <span className="sr-only">
                                  {` Señal ${firstResult + detectionIndex}, ${sourceLabels[detection.source] ?? detection.source}, detectada el ${formatDateTimeInTimeZone(detection.detectedAt, operationalTimeZone)}`}
                                </span>
                              </label>
                              <button
                                type="submit"
                                aria-label={`Confirmar descarte de la señal ${firstResult + detectionIndex}, ${sourceLabels[detection.source] ?? detection.source}, detectada el ${formatDateTimeInTimeZone(detection.detectedAt, operationalTimeZone)}`}
                                className="h-11 rounded-md border border-[color:var(--danger)] px-4 text-sm font-semibold text-[color:var(--danger)]"
                              >
                                Confirmar descarte
                              </button>
                            </form>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {queue.pageCount > 1 ? (
              <nav
                aria-label="Paginación de señales"
                className="mt-5 flex flex-wrap items-center justify-between gap-3"
              >
                {queue.page > 1 ? (
                  <Link
                    href={queueHref(
                      {
                        municipalityId: queue.municipalityId ?? undefined,
                        pageSize: String(queue.pageSize),
                      },
                      queue.page - 1,
                    )}
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
                  >
                    <ChevronLeft size={16} aria-hidden />
                    Anterior
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm">
                  Página {queue.page} de {queue.pageCount}
                </span>
                {queue.page < queue.pageCount ? (
                  <Link
                    href={queueHref(
                      {
                        municipalityId: queue.municipalityId ?? undefined,
                        pageSize: String(queue.pageSize),
                      },
                      queue.page + 1,
                    )}
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
                  >
                    Siguiente
                    <ChevronRight size={16} aria-hidden />
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
