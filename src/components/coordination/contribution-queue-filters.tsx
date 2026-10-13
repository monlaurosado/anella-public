import Form from "next/form";
import Link from "next/link";
import { Filter, RotateCcw, Search } from "lucide-react";

import {
  QUEUE_TEXT_FILTER_MAX_LENGTH,
  type ContributionFilterState,
  type ContributionQueueView,
} from "@/components/coordination/queue-query";
import { cn } from "@/lib/utils";

const views: Array<{
  value: Exclude<ContributionQueueView, "custom">;
  label: string;
}> = [
  { value: "open", label: "En curso" },
  { value: "delivered", label: "Entregadas" },
  { value: "exceptions", label: "Incidencias" },
];

const fieldClass =
  "h-11 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm outline-none transition focus:border-[color:var(--foreground)] focus:ring-2 focus:ring-[color:var(--foreground)]/10";
const labelClass = "grid min-w-0 gap-1.5 text-xs font-semibold";

export function ContributionQueueFilters({
  state,
}: {
  state: ContributionFilterState;
}) {
  return (
    <section
      aria-labelledby="filtros-aportaciones"
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
    >
      <div className="border-b border-[color:var(--border)] px-3 pt-3 sm:px-4">
        <p className="mb-2 text-xs font-semibold text-black/65 dark:text-white/65">
          Vistas guardadas
        </p>
        <nav
          aria-label="Vistas guardadas de aportaciones"
          className="flex gap-1 overflow-x-auto pb-3"
        >
          {views.map((view) => {
            const active = state.view === view.value;
            return (
              <Link
                key={view.value}
                href={`/coordinacion/aportaciones?view=${view.value}`}
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
        </nav>
      </div>

      <Form
        action="/coordinacion/aportaciones"
        className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-5"
      >
        <input type="hidden" name="view" value="custom" />
        <h2
          id="filtros-aportaciones"
          className="flex items-center gap-2 text-sm font-semibold sm:col-span-2 lg:col-span-5"
        >
          <Filter size={16} aria-hidden />
          Buscar y filtrar
        </h2>

        <label className={`${labelClass} sm:col-span-2`}>
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
              placeholder="Código de aportación, material o emergencia"
              className={`${fieldClass} pl-9`}
            />
          </span>
        </label>

        <label className={labelClass}>
          Estado
          <select
            name="status"
            defaultValue={state.status}
            className={fieldClass}
          >
            <option value="">Todos</option>
            <option value="open">En curso</option>
            <option value="pledged">Confirmadas</option>
            <option value="en_route">En camino</option>
            <option value="partially_delivered">Parciales</option>
            <option value="delivered">Entregadas</option>
            <option value="cancelled">Canceladas</option>
            <option value="no_show">No presentadas</option>
            <option value="exceptions">Todas las incidencias</option>
          </select>
        </label>

        <label className={labelClass}>
          Categoría
          <select
            name="category"
            defaultValue={state.category}
            className={fieldClass}
          >
            <option value="">Todas</option>
            <option value="water">Agua</option>
            <option value="food">Alimentos</option>
            <option value="hygiene">Higiene</option>
            <option value="medical_supplies">Material sanitario</option>
            <option value="tools">Herramientas</option>
            <option value="protective_equipment">Protección</option>
            <option value="transport">Transporte</option>
            <option value="accommodation">Alojamiento</option>
            <option value="animal_support">Apoyo animal</option>
            <option value="other">Otros</option>
          </select>
        </label>

        <label className={labelClass}>
          Llegada estimada
          <select name="eta" defaultValue={state.eta} className={fieldClass}>
            <option value="">Cualquiera</option>
            <option value="with_eta">Con ETA indicada</option>
            <option value="due_soon">En las próximas 2 horas</option>
            <option value="late">ETA superada</option>
          </select>
        </label>

        <label className={labelClass}>
          Emergencia
          <input
            type="search"
            name="incident"
            defaultValue={state.incident}
            maxLength={QUEUE_TEXT_FILTER_MAX_LENGTH}
            placeholder="Código, título o municipio"
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Punto de entrega
          <input
            type="search"
            name="safePoint"
            defaultValue={state.safePoint}
            maxLength={QUEUE_TEXT_FILTER_MAX_LENGTH}
            placeholder="Nombre o código QR"
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Municipio
          <input
            type="search"
            name="municipality"
            defaultValue={state.municipality}
            maxLength={QUEUE_TEXT_FILTER_MAX_LENGTH}
            placeholder="Nombre del municipio"
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Desde
          <input
            type="date"
            name="createdFrom"
            defaultValue={state.createdFrom}
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Hasta
          <input
            type="date"
            name="createdTo"
            defaultValue={state.createdTo}
            className={fieldClass}
          />
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

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--foreground)] px-4 text-sm font-semibold transition hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.06]"
          >
            Aplicar filtros
          </button>
          <Link
            href="/coordinacion/aportaciones?view=open"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold text-black/55 hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white/55 dark:hover:text-white"
          >
            <RotateCcw size={15} aria-hidden />
            Limpiar
          </Link>
        </div>
      </Form>
    </section>
  );
}
