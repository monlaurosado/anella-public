import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Flame,
  MapPin,
  RadioTower,
  ShieldCheck,
} from "lucide-react";

import { createIncident } from "@/actions/coordination";
import { createIncidentFromDetection } from "@/actions/detections";
import { CoordinateRadiusPickerShell } from "@/components/coordination/coordinate-radius-picker-shell";
import { Badge } from "@/components/ui/badge";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { getOperationalTimeZone } from "@/config/env";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import { readSignedFlash, type FlashSearchParams } from "@/lib/signed-flash";
import { getIncidentCreationContext } from "@/services/detections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nueva emergencia · Coordinación" };

const DEFAULT_SAFETY_NOTICE =
  "No acudir a la zona de intervención. Utilizar solo los puntos de entrega habilitados. Para una emergencia vital, llamar al 112.";

type NewIncidentQuery = FlashSearchParams & {
  detectionId?: string;
};

const inputClass =
  "min-h-11 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

export default async function NewIncidentPage({
  searchParams,
}: {
  searchParams: Promise<NewIncidentQuery>;
}) {
  const query = await searchParams;
  const flash = readSignedFlash(query, "/coordinacion/incidentes/nuevo");
  const operationalTimeZone = getOperationalTimeZone();
  const context = await getIncidentCreationContext(query.detectionId);
  const detectionRequested = Boolean(query.detectionId);
  const detection = context.detection;
  const action = detection ? createIncidentFromDetection : createIncident;
  const initialCenter = detection
    ? { lat: detection.latitude, lng: detection.longitude }
    : { lat: 40.2, lng: -3.7 };

  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4 sm:px-6">
        <Link
          href={
            detectionRequested
              ? "/coordinacion/detecciones"
              : "/coordinacion/incidentes"
          }
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-black/60 dark:text-white/60"
        >
          <ArrowLeft size={16} aria-hidden />
          {detectionRequested ? "Volver a señales" : "Volver a emergencias"}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-muted)]">
            <ShieldCheck size={20} aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
              Nueva emergencia
            </h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              Solo lo imprescindible. Se guardará como borrador para revisión.
            </p>
          </div>
        </div>
      </header>

      {detectionRequested && !detection ? (
        <section className="mx-auto mt-6 max-w-2xl px-4 sm:px-6">
          <div
            className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--surface)] p-5 text-sm"
            role="alert"
          >
            <p className="font-semibold">La señal ya no está disponible.</p>
            <p className="mt-1 text-black/60 dark:text-white/60">
              Puede haber sido revisada por otra persona o pertenecer a otro
              municipio. Vuelve a la cola para trabajar con el estado actual.
            </p>
            <Link
              href="/coordinacion/detecciones"
              className="mt-4 inline-flex min-h-11 items-center rounded-md border border-[color:var(--border)] px-4 font-semibold"
            >
              Revisar la cola
            </Link>
          </div>
        </section>
      ) : (
        <form action={action} className="relative lg:p-4">
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <input type="hidden" name="type" value="WILDFIRE" />
          <input
            type="hidden"
            name="safetyNotice"
            value={DEFAULT_SAFETY_NOTICE}
          />
          {detection ? (
            <>
              <input type="hidden" name="detectionId" value={detection.id} />
              <input
                type="hidden"
                name="municipalityId"
                value={detection.municipalityId}
              />
              <input type="hidden" name="radiusMeters" value="1500" />
            </>
          ) : null}

          <div className="relative flex flex-col overflow-hidden border-y border-[color:var(--border)] bg-[color:var(--surface)] lg:block lg:rounded-xl lg:border">
            <CoordinateRadiusPickerShell
              initialCenter={initialCenter}
              initiallySelected={Boolean(detection)}
              initialRadiusMeters={1_500}
              minimumRadiusMeters={100}
              maximumRadiusMeters={10_000}
              radiusStepMeters={100}
              radiusName={detection ? "selectedRadiusMeters" : "radiusMeters"}
              tone="danger"
              title="Ubicación interna del incendio"
              description="Haz clic en el mapa para situarlo. Esta posición no se publica como punto seguro."
              className="order-2 h-[52vh] min-h-[440px] rounded-none border-0 lg:h-[calc(100vh-13.5rem)] lg:min-h-[650px]"
              controlsBottomClassName="bottom-28"
            />

            <section className="relative z-[600] order-1 border-b border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5 lg:absolute lg:left-5 lg:top-5 lg:w-[min(22rem,calc(100%-2.5rem))] lg:rounded-lg lg:border lg:shadow-xl">
              <div className="flex items-start gap-2">
                <Flame
                  className="mt-0.5 shrink-0 text-[color:var(--danger)]"
                  size={18}
                  aria-hidden
                />
                <div>
                  <h2 className="font-semibold">Datos básicos</h2>
                  <p className="mt-1 text-xs leading-5 text-black/60 dark:text-white/60">
                    El tipo ya está fijado como incendio. La ubicación exacta
                    del punto seguro se añadirá después en el mapa del incidente.
                  </p>
                </div>
              </div>

              {flash.notice ? (
                <p
                  className="mt-3 rounded-md border border-[color:var(--success)]/35 p-3 text-sm text-[color:var(--success)]"
                  role="status"
                >
                  {flash.notice}
                </p>
              ) : null}
              {flash.error ? (
                <p
                  className="mt-3 rounded-md border border-[color:var(--danger)]/35 p-3 text-sm text-[color:var(--danger)]"
                  role="alert"
                >
                  {flash.error}
                </p>
              ) : null}

              {detection ? (
                <aside className="mt-4 rounded-md border border-[color:var(--accent)]/25 bg-[color:var(--surface-muted)] p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <RadioTower size={15} aria-hidden />
                    <span className="font-semibold">Señal seleccionada</span>
                    <Badge tone="info">{detection.source}</Badge>
                  </div>
                  <p className="mt-2 text-black/60 dark:text-white/60">
                    {detection.municipalityName} ·{" "}
                    {formatDateTimeInTimeZone(
                      detection.detectedAt,
                      operationalTimeZone,
                    )}
                  </p>
                </aside>
              ) : context.coordinator.role === "SUPER_ADMIN" ? (
                <label className="mt-4 grid gap-1.5 text-sm font-medium">
                  Municipio
                  <select
                    name="municipalityId"
                    required
                    defaultValue=""
                    className={inputClass}
                  >
                    <option value="" disabled>
                      Selecciona un municipio
                    </option>
                    {context.municipalities.map((municipality) => (
                      <option key={municipality.id} value={municipality.id}>
                        {municipality.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="mt-4 rounded-md border border-[color:var(--border)] p-3 text-sm">
                  <span className="text-black/55 dark:text-white/55">
                    Municipio: {" "}
                  </span>
                  <strong>
                    {context.coordinator.municipalityName ??
                      "Sin municipio asignado"}
                  </strong>
                </div>
              )}

              <label className="mt-4 grid gap-1.5 text-sm font-medium">
                Título
                <input
                  name="title"
                  required
                  minLength={5}
                  maxLength={191}
                  className={inputClass}
                  placeholder="Incendio en…"
                />
              </label>

              <label className="mt-4 grid gap-1.5 text-sm font-medium">
                Prioridad
                <select
                  name="priority"
                  defaultValue="HIGH"
                  className={inputClass}
                >
                  <option value="LOW">Baja</option>
                  <option value="MEDIUM">Media</option>
                  <option value="HIGH">Alta</option>
                  <option value="CRITICAL">Crítica</option>
                </select>
              </label>

              <label className="mt-4 grid gap-1.5 text-sm font-medium">
                Resumen <span className="font-normal">(opcional)</span>
                <textarea
                  name="publicSummary"
                  maxLength={2000}
                  className="min-h-24 rounded-md border border-[color:var(--border)] bg-transparent p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  placeholder="Información confirmada y segura para la ciudadanía."
                />
              </label>
            </section>

            <footer className="relative z-[600] order-3 flex flex-col gap-3 border-t border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between lg:absolute lg:inset-x-5 lg:bottom-5 lg:rounded-lg lg:border lg:shadow-xl">
              <p className="flex items-center gap-2 text-xs text-black/60 dark:text-white/60">
                <MapPin size={15} aria-hidden />
                Incendio forestal · ubicación interna · borrador
              </p>
              <PendingSubmitButton
                pendingLabel="Creando emergencia…"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-5 text-sm font-semibold text-[color:var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <ShieldCheck size={16} aria-hidden />
                Crear emergencia
              </PendingSubmitButton>
            </footer>
          </div>
        </form>
      )}
    </main>
  );
}
