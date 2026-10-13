import { randomUUID } from "node:crypto";

import Link from "next/link";
import {
  CircleDashed,
  MapPin,
  Plus,
  QrCode,
  ShieldCheck,
  Truck,
} from "lucide-react";

import {
  createSafePoint,
  toggleSafePoint,
  updateSafePoint,
} from "@/actions/coordination";
import { Badge } from "@/components/ui/badge";
import { CoordinateRadiusPickerShell } from "@/components/coordination/coordinate-radius-picker-shell";
import { DetailPaginationFields } from "@/components/coordination/detail-pagination-fields";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import type { ManagedIncident } from "@/types/domain";

const inputClass =
  "min-h-11 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";
const textareaClass =
  "min-h-24 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

export function IncidentSafePoints({
  incident,
}: {
  incident: ManagedIncident;
}) {
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-[color:var(--success)]">
            <MapPin size={18} aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-semibold">Puntos de entrega</h2>
            <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
              Son destinos logísticos para material, no refugios ni puntos de
              evacuación. Antes de publicarlos, confirma que están fuera de
              riesgo y que su acceso es adecuado.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {incident.safePoints.length > 0 ? (
            incident.safePoints.map((point, index) => {
              const isPublished = Boolean(point.isActive && point.validatedAt);
              const activeNeeds = point.activeNeeds;
              const pendingDeliveries = point.pendingDeliveries;
              const blocked = activeNeeds > 0 || pendingDeliveries > 0;
              const pointContext = `punto de entrega ${index + 1}, ${point.name}, ${point.address}`;

              return (
                <article
                  key={point.id}
                  aria-labelledby={`safe-point-title-${point.id}`}
                  className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={isPublished ? "success" : "neutral"}>
                          {isPublished
                            ? "Activo y público"
                            : point.isActive
                              ? "Pendiente de aprobación"
                              : "Inactivo"}
                        </Badge>
                        {blocked && point.isActive ? (
                          <Badge tone="warning">Con operación pendiente</Badge>
                        ) : null}
                      </div>
                      <h3
                        id={`safe-point-title-${point.id}`}
                        className="mt-3 text-lg font-semibold"
                      >
                        {point.name}
                        <span className="sr-only">
                          , punto de entrega {index + 1} de esta emergencia
                        </span>
                      </h3>
                      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                        {point.address}
                      </p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--success)]">
                        <CircleDashed size={14} aria-hidden /> Zona visible de{" "}
                        {point.radiusMeters} m
                      </p>
                    </div>
                    <Link
                      href={`/coordinacion/puntos/${point.qrToken}`}
                      aria-label={`Abrir recepción por QR del ${pointContext}`}
                      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <QrCode size={16} aria-hidden />
                      <span className="hidden sm:inline">Recepción</span>
                      <span className="sr-only sm:hidden">
                        Abrir recepción por QR
                      </span>
                    </Link>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-black/65 dark:text-white/65">
                    {point.instructions}
                  </p>
                  <p className="mt-2 text-xs text-black/65 dark:text-white/65">
                    {point.validatedAt
                      ? `Validado ${formatDateTimeInTimeZone(point.validatedAt, incident.timeZone)}${point.validatedByName ? ` por ${point.validatedByName}` : ""}`
                      : "Sin aprobación humana vigente: no se publica ni admite nuevas entregas."}
                  </p>
                  {point.capacityNote ? (
                    <p className="mt-2 text-xs text-black/65 dark:text-white/65">
                      Capacidad: {point.capacityNote}
                    </p>
                  ) : null}

                  <dl className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-md bg-[color:var(--surface-muted)] p-3">
                      <dt className="text-[11px] font-bold uppercase tracking-wide text-black/65 dark:text-white/65">
                        Necesidades asociadas
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {point.associatedNeeds}
                      </dd>
                      <dd className="text-xs text-black/65 dark:text-white/65">
                        {activeNeeds} activas
                      </dd>
                    </div>
                    <div className="rounded-md bg-[color:var(--surface-muted)] p-3">
                      <dt className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-black/65 dark:text-white/65">
                        <Truck size={13} aria-hidden /> Entregas pendientes
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {pendingDeliveries}
                      </dd>
                    </div>
                  </dl>

                  <details className="mt-4 rounded-md border border-[color:var(--border)]">
                    <summary
                      aria-label={`Editar y revalidar punto: ${pointContext}`}
                      className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold"
                    >
                      Editar y revalidar punto
                    </summary>
                    <form
                      action={updateSafePoint}
                      aria-label={`Editar y revalidar el ${pointContext}`}
                      className="grid gap-3 border-t border-[color:var(--border)] p-3"
                    >
                      <input
                        type="hidden"
                        name="incidentId"
                        value={incident.id}
                      />
                      <input
                        type="hidden"
                        name="safePointId"
                        value={point.id}
                      />
                      <DetailPaginationFields
                        page={incident.pagination.page}
                        pageSize={incident.pagination.pageSize}
                      />
                      <input
                        type="hidden"
                        name="expectedUpdatedAt"
                        value={point.updatedAt}
                      />
                      <input
                        type="hidden"
                        name="radiusMeters"
                        value={point.radiusMeters}
                      />
                      <label className="grid gap-1.5 text-sm font-medium">
                        Nombre público
                        <span className="sr-only"> del {pointContext}</span>
                        <input
                          name="name"
                          required
                          minLength={3}
                          maxLength={191}
                          defaultValue={point.name}
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm font-medium">
                        Dirección pública
                        <span className="sr-only"> del {pointContext}</span>
                        <input
                          name="address"
                          required
                          minLength={3}
                          maxLength={255}
                          defaultValue={point.address}
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm font-medium">
                        Instrucciones seguras
                        <span className="sr-only"> del {pointContext}</span>
                        <textarea
                          name="instructions"
                          required
                          minLength={5}
                          maxLength={2000}
                          defaultValue={point.instructions}
                          className={textareaClass}
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-1.5 text-sm font-medium">
                          Latitud
                          <span className="sr-only"> del {pointContext}</span>
                          <input
                            name="latitude"
                            type="number"
                            step="any"
                            min="-90"
                            max="90"
                            required
                            defaultValue={point.coordinates.lat}
                            className={inputClass}
                          />
                        </label>
                        <label className="grid gap-1.5 text-sm font-medium">
                          Longitud
                          <span className="sr-only"> del {pointContext}</span>
                          <input
                            name="longitude"
                            type="number"
                            step="any"
                            min="-180"
                            max="180"
                            required
                            defaultValue={point.coordinates.lng}
                            className={inputClass}
                          />
                        </label>
                      </div>
                      <label className="grid gap-1.5 text-sm font-medium">
                        Nota de capacidad
                        <span className="sr-only"> del {pointContext}</span>
                        <input
                          name="capacityNote"
                          maxLength={191}
                          defaultValue={point.capacityNote}
                          className={inputClass}
                        />
                      </label>
                      <div className="rounded-md bg-amber-500/[0.08] p-3 text-sm leading-6">
                        Impacto: {activeNeeds} necesidades activas y{" "}
                        {pendingDeliveries} entregas pendientes usan este
                        destino. La dirección, coordenadas e instrucciones
                        cambian inmediatamente en sus enlaces privados.
                      </div>
                      <label className="grid gap-1.5 text-sm font-medium">
                        Motivo de la modificación
                        <span className="sr-only"> del {pointContext}</span>
                        <textarea
                          name="reason"
                          required
                          minLength={8}
                          maxLength={500}
                          className={textareaClass}
                        />
                      </label>
                      <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm leading-5">
                        <input
                          name="confirmSafePointUpdate"
                          type="checkbox"
                          required
                          className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                        />
                        He verificado de nuevo la seguridad, exactitud y efecto
                        sobre las personas con entregas pendientes.
                        <span className="sr-only">
                          {" "}
                          Revisión del {pointContext}.
                        </span>
                      </label>
                      <button
                        type="submit"
                        aria-label={`Guardar y revalidar el ${pointContext}`}
                        className="min-h-11 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold"
                      >
                        Guardar y revalidar
                      </button>
                    </form>
                  </details>

                  {!point.isActive && point.deactivationReason ? (
                    <div className="mt-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm">
                      <p>
                        <span className="font-semibold">Motivo:</span>{" "}
                        {point.deactivationReason}
                      </p>
                      {point.deactivatedAt ? (
                        <p className="mt-1 text-xs text-black/65 dark:text-white/65">
                          {formatDateTimeInTimeZone(
                            point.deactivatedAt,
                            incident.timeZone,
                          )}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 border-t border-[color:var(--border)] pt-4">
                    {point.isActive && !point.validatedAt ? (
                      <details className="rounded-md border border-amber-500/25 bg-amber-500/[0.04]">
                        <summary
                          aria-label={`Aprobar publicación del ${pointContext}`}
                          className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          Aprobar publicación del punto
                        </summary>
                        <form
                          action={toggleSafePoint}
                          aria-label={`Aprobar publicación del ${pointContext}`}
                          className="grid gap-3 border-t border-amber-500/20 p-3"
                        >
                          <input
                            type="hidden"
                            name="incidentId"
                            value={incident.id}
                          />
                          <input
                            type="hidden"
                            name="safePointId"
                            value={point.id}
                          />
                          <DetailPaginationFields
                            page={incident.pagination.page}
                            pageSize={incident.pagination.pageSize}
                          />
                          <input
                            type="hidden"
                            name="safePointAction"
                            value="approve"
                          />
                          <label className="grid gap-1.5 text-sm font-medium">
                            Motivo y fuente de la validación
                            <span className="sr-only"> del {pointContext}</span>
                            <textarea
                              name="reason"
                              required
                              minLength={8}
                              maxLength={500}
                              className={textareaClass}
                            />
                          </label>
                          <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface)] p-3 text-sm leading-5">
                            <input
                              name="confirmSafePointChange"
                              type="checkbox"
                              required
                              className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                            />
                            He verificado con una fuente humana responsable que
                            el punto está fuera de riesgo y sus datos públicos
                            son correctos.
                            <span className="sr-only">
                              {" "}
                              Validación del {pointContext}.
                            </span>
                          </label>
                          <button
                            type="submit"
                            aria-label={`Aprobar punto de entrega: ${pointContext}`}
                            className="min-h-11 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold"
                          >
                            Aprobar punto de entrega
                          </button>
                        </form>
                      </details>
                    ) : point.isActive ? (
                      blocked ? (
                        <p className="rounded-md bg-amber-500/[0.08] p-3 text-sm leading-6">
                          No se puede desactivar: resuelve o reasigna primero{" "}
                          {activeNeeds} necesidades activas y{" "}
                          {pendingDeliveries} entregas pendientes.
                        </p>
                      ) : (
                        <details className="rounded-md border border-red-500/25 bg-red-500/[0.04]">
                          <summary
                            aria-label={`Desactivar punto de entrega: ${pointContext}`}
                            className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold text-[color:var(--danger)] focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            Desactivar punto de entrega
                          </summary>
                          <form
                            action={toggleSafePoint}
                            aria-label={`Desactivar el ${pointContext}`}
                            className="grid gap-3 border-t border-red-500/20 p-3"
                          >
                            <input
                              type="hidden"
                              name="incidentId"
                              value={incident.id}
                            />
                            <input
                              type="hidden"
                              name="safePointId"
                              value={point.id}
                            />
                            <DetailPaginationFields
                              page={incident.pagination.page}
                              pageSize={incident.pagination.pageSize}
                            />
                            <input
                              type="hidden"
                              name="safePointAction"
                              value="deactivate"
                            />
                            <label className="grid gap-1.5 text-sm font-medium">
                              Motivo de desactivación
                              <span className="sr-only">
                                {" "}
                                del {pointContext}
                              </span>
                              <textarea
                                name="reason"
                                required
                                minLength={8}
                                maxLength={500}
                                className={textareaClass}
                                placeholder="Explica por qué el punto deja de ser seguro u operativo"
                              />
                            </label>
                            <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface)] p-3 text-sm leading-5">
                              <input
                                name="confirmSafePointChange"
                                type="checkbox"
                                required
                                className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                              />
                              Confirmo que no quedan necesidades activas ni
                              entregas pendientes y he revisado el impacto
                              ciudadano.
                              <span className="sr-only">
                                {" "}
                                Desactivación del {pointContext}.
                              </span>
                            </label>
                            <button
                              type="submit"
                              aria-label={`Confirmar desactivación del ${pointContext}`}
                              className="min-h-11 rounded-md bg-[color:var(--danger)] px-4 text-sm font-semibold text-white dark:text-[#171713] focus-visible:outline-2 focus-visible:outline-offset-2"
                            >
                              Confirmar desactivación
                            </button>
                          </form>
                        </details>
                      )
                    ) : (
                      <details className="rounded-md border border-[color:var(--border)]">
                        <summary
                          aria-label={`Reactivar punto de entrega: ${pointContext}`}
                          className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          Reactivar punto de entrega
                        </summary>
                        <form
                          action={toggleSafePoint}
                          aria-label={`Reactivar el ${pointContext}`}
                          className="grid gap-3 border-t border-[color:var(--border)] p-3"
                        >
                          <input
                            type="hidden"
                            name="incidentId"
                            value={incident.id}
                          />
                          <input
                            type="hidden"
                            name="safePointId"
                            value={point.id}
                          />
                          <DetailPaginationFields
                            page={incident.pagination.page}
                            pageSize={incident.pagination.pageSize}
                          />
                          <input
                            type="hidden"
                            name="safePointAction"
                            value="reactivate"
                          />
                          <label className="grid gap-1.5 text-sm font-medium">
                            Motivo de reactivación
                            <span className="sr-only"> del {pointContext}</span>
                            <input
                              name="reason"
                              required
                              minLength={8}
                              maxLength={500}
                              className={inputClass}
                            />
                          </label>
                          <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm leading-5">
                            <input
                              name="confirmSafePointChange"
                              type="checkbox"
                              required
                              className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                            />
                            He verificado de nuevo que el punto y sus accesos
                            son seguros para la ciudadanía.
                            <span className="sr-only">
                              {" "}
                              Reactivación del {pointContext}.
                            </span>
                          </label>
                          <button
                            type="submit"
                            aria-label={`Reactivar el ${pointContext}`}
                            className="min-h-11 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            Reactivar
                          </button>
                        </form>
                      </details>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-[color:var(--border)] p-8 text-center xl:col-span-2">
              <p className="font-semibold">No hay puntos de entrega</p>
              <p className="mt-1 text-sm text-black/65 dark:text-white/65">
                Habilita uno únicamente cuando una entidad responsable haya
                verificado su ubicación y operativa.
              </p>
            </div>
          )}
        </div>
      </section>

      <details
        id="nuevo-punto"
        className="scroll-mt-24 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-5">
          <Plus size={17} aria-hidden />
          Habilitar punto de entrega
        </summary>
        <form
          action={createSafePoint}
          className="grid gap-4 border-t border-[color:var(--border)] p-4 sm:p-5"
        >
          <input type="hidden" name="incidentId" value={incident.id} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <input type="hidden" name="pointType" value="DROP_OFF" />
          <DetailPaginationFields
            page={incident.pagination.page}
            pageSize={incident.pagination.pageSize}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">Lugar físico habilitado</h3>
                <p className="mt-1 text-xs leading-5 text-black/60 dark:text-white/60">
                  Usa un edificio o recinto verificado. El círculo empieza en
                  30 metros y solo representa el entorno inmediato del punto.
                </p>
              </div>
              <label className="grid gap-1.5 text-sm font-medium">
                Nombre público
                <input
                  name="name"
                  required
                  minLength={3}
                  maxLength={191}
                  className={inputClass}
                  placeholder="Ej.: Pabellón municipal"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Dirección
                <input
                  name="address"
                  required
                  minLength={3}
                  maxLength={255}
                  className={inputClass}
                  placeholder="Calle y número"
                />
              </label>
              <details className="rounded-md border border-[color:var(--border)]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold">
                  Añadir indicaciones (opcional)
                </summary>
                <div className="grid gap-3 border-t border-[color:var(--border)] p-3">
                  <label className="grid gap-1.5 text-sm font-medium">
                    Cómo llegar con seguridad
                    <textarea
                      name="instructions"
                      maxLength={2000}
                      className={textareaClass}
                      placeholder="Acceso recomendado, horario o puerta de entrada."
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Nota de capacidad
                    <input
                      name="capacityNote"
                      maxLength={191}
                      className={inputClass}
                      placeholder="Ej.: acceso para furgonetas"
                    />
                  </label>
                </div>
              </details>
            </div>

            <CoordinateRadiusPickerShell
              initialCenter={incident.operationalCoordinates}
              initialRadiusMeters={30}
              minimumRadiusMeters={10}
              maximumRadiusMeters={200}
              radiusStepMeters={10}
              tone="safe"
              title="Ubicación exacta del punto seguro"
              description="Haz clic sobre el edificio habilitado y ajusta únicamente su entorno inmediato."
              className="h-[430px]"
            />
          </div>
          <label className="flex min-h-11 items-start gap-3 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-sm leading-5">
            <input
              name="confirmSafePointSafety"
              type="checkbox"
              required
              className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
            />
            He verificado con una fuente humana responsable que este destino
            logístico está fuera de la zona de riesgo, es accesible y puede
            publicarse con su ubicación exacta. No se presenta como refugio ni
            evacuación.
          </label>
          <PendingSubmitButton
            pendingLabel="Creando punto…"
            className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <ShieldCheck size={16} aria-hidden />
            Habilitar punto de entrega
          </PendingSubmitButton>
        </form>
      </details>
    </div>
  );
}
