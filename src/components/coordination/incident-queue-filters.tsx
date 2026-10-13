import Link from "next/link";
import { Filter, RotateCcw, Search } from "lucide-react";

import { incidentTypeLabels } from "@/components/coordination/queue-labels";
import { IncidentTabsScroller } from "@/components/coordination/incident-tabs-scroller";
import {
  QUEUE_TEXT_FILTER_MAX_LENGTH,
  type IncidentFilterState,
  type IncidentQueueView,
} from "@/components/coordination/queue-query";
import { getOperationalTimeZone } from "@/config/env";
import { cn } from "@/lib/utils";
import type { IncidentType } from "@/types/domain";

const views: Array<{
  value: Exclude<IncidentQueueView, "custom">;
  label: string;
}> = [
  { value: "validation", label: "Por validar" },
  { value: "active", label: "Activos" },
  { value: "help", label: "Con aportaciones" },
  { value: "monitoring", label: "En seguimiento" },
  { value: "closed", label: "Cerrados" },
  { value: "all", label: "Todos" },
];

const types = Object.entries(incidentTypeLabels) as Array<
  [IncidentType, string]
>;

const fieldClass =
  "h-11 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm outline-none transition focus:border-[color:var(--foreground)] focus:ring-2 focus:ring-[color:var(--foreground)]/10";

const labelClass = "grid min-w-0 gap-1.5 text-xs font-semibold";

export function IncidentQueueFilters({
  state,
}: {
  state: IncidentFilterState;
}) {
  const operationalTimeZone = getOperationalTimeZone();
  const hasAdvancedFilters =
    state.view === "custom" &&
    Boolean(
      state.status ||
      state.priority ||
      state.type ||
      state.municipality ||
      state.organization ||
      state.createdFrom ||
      state.createdTo ||
      state.hasPendingNeeds ||
      state.sort !== "activity" ||
      state.direction !== "desc" ||
      state.pageSize !== 25,
    );

  return (
    <section
      aria-labelledby="filtros-incidentes"
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
    >
      <div className="border-b border-[color:var(--border)] px-3 pt-3 sm:px-4">
        <p className="mb-2 text-xs font-semibold text-black/65 dark:text-white/65">
          Vistas guardadas
        </p>
        <IncidentTabsScroller
          activeTab={state.view}
          ariaLabel="Vistas guardadas de emergencias"
          className="flex gap-1 overflow-x-auto pb-3"
        >
          {views.map((view) => {
            const active = state.view === view.value;
            return (
              <Link
                key={view.value}
                href={`/coordinacion/incidentes?view=${view.value}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2",
                  active
                    ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                    : "bg-[color:var(--surface-muted)] text-black/65 hover:text-black dark:text-white/65 dark:hover:text-white",
                )}
              >
                {view.label}
              </Link>
            );
          })}
        </IncidentTabsScroller>
      </div>

      <form
        action="/coordinacion/incidentes"
        method="get"
        className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-4"
      >
        <input type="hidden" name="view" value="custom" />
        <h2
          id="filtros-incidentes"
          className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"
        >
          <Filter size={16} aria-hidden />
          Buscar y filtrar
        </h2>

        <label className={labelClass}>
          Buscar
          <span className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              defaultValue={state.query}
              maxLength={QUEUE_TEXT_FILTER_MAX_LENGTH}
              placeholder="Código, título, municipio u organización"
              className={`${fieldClass} pl-9`}
            />
          </span>
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-4 text-sm font-semibold transition hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.04]"
          >
            Buscar
          </button>
          <Link
            href="/coordinacion/incidentes?view=active"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold text-black/55 hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white/55 dark:hover:text-white"
          >
            <RotateCcw size={15} aria-hidden />
            Limpiar
          </Link>
        </div>

        <details
          open={hasAdvancedFilters}
          className="min-w-0 rounded-md border border-[color:var(--border)] sm:col-span-2"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
            Filtros avanzados
          </summary>
          <div className="grid gap-3 border-t border-[color:var(--border)] p-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
            <label className={labelClass}>
              Estado
              <select
                name="status"
                defaultValue={state.status}
                className={fieldClass}
              >
                <option value="">Todos</option>
                <option value="operational">
                  Abiertos, incluida validación
                </option>
                <option value="ongoing">Activos y seguimiento</option>
                <option value="pending_validation">
                  Pendientes de validación
                </option>
                <option value="active">Activos</option>
                <option value="monitoring">En seguimiento</option>
                <option value="draft">Borradores</option>
                <option value="resolved">Resueltos</option>
                <option value="cancelled">Cancelados</option>
                <option value="closed">Todos los cerrados</option>
              </select>
            </label>

            <label className={labelClass}>
              Prioridad
              <select
                name="priority"
                defaultValue={state.priority}
                className={fieldClass}
              >
                <option value="">Todas</option>
                <option value="critical">Crítica</option>
                <option value="high">Alta</option>
                <option value="medium">Media</option>
                <option value="low">Baja</option>
              </select>
            </label>

            <label className={labelClass}>
              Tipo
              <select
                name="type"
                defaultValue={state.type}
                className={fieldClass}
              >
                <option value="">Todos</option>
                {types.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClass}>
              Municipio
              <input
                name="municipality"
                defaultValue={state.municipality}
                maxLength={QUEUE_TEXT_FILTER_MAX_LENGTH}
                placeholder="Nombre"
                className={fieldClass}
              />
            </label>

            <label className={labelClass}>
              Organización
              <input
                name="organization"
                defaultValue={state.organization}
                maxLength={QUEUE_TEXT_FILTER_MAX_LENGTH}
                placeholder="Responsable"
                className={fieldClass}
              />
            </label>

            <label className={labelClass}>
              Creado desde ({operationalTimeZone})
              <input
                type="date"
                name="createdFrom"
                defaultValue={state.createdFrom}
                className={fieldClass}
              />
            </label>

            <label className={labelClass}>
              Creado hasta ({operationalTimeZone})
              <input
                type="date"
                name="createdTo"
                defaultValue={state.createdTo}
                className={fieldClass}
              />
            </label>

            <label className={labelClass}>
              Ordenar por
              <select
                name="sort"
                defaultValue={state.sort}
                className={fieldClass}
              >
                <option value="activity">Última actividad</option>
                <option value="priority">Prioridad</option>
                <option value="created">Fecha de creación</option>
              </select>
            </label>

            <label className={labelClass}>
              Dirección
              <select
                name="direction"
                defaultValue={state.direction}
                className={fieldClass}
              >
                <option value="desc">Más reciente / mayor</option>
                <option value="asc">Más antiguo / menor</option>
              </select>
            </label>

            <label className={labelClass}>
              Filas por página
              <select
                name="pageSize"
                defaultValue={String(state.pageSize)}
                className={fieldClass}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>

            <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold">
              <input
                type="checkbox"
                name="pending"
                value="1"
                defaultChecked={state.hasPendingNeeds}
                className="size-4 accent-[color:var(--foreground)]"
              />
              Solo con aportaciones pendientes
            </label>

            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4 2xl:col-span-6">
              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--foreground)] px-4 text-sm font-semibold transition hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.06]"
              >
                Aplicar filtros
              </button>
            </div>
          </div>
        </details>
      </form>
    </section>
  );
}
