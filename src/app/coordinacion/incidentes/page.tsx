import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { IncidentQueueFilters } from "@/components/coordination/incident-queue-filters";
import { IncidentQueueList } from "@/components/coordination/incident-queue-list";
import { QueuePagination } from "@/components/coordination/queue-pagination";
import {
  copySearchParams,
  parseIncidentQueueQuery,
  type RawSearchParams,
} from "@/components/coordination/queue-query";
import { canonicalPaginationHref } from "@/lib/pagination-canonical";
import { readSignedFlash } from "@/lib/signed-flash";
import { getIncidentQueue } from "@/services/incidents";

export const metadata: Metadata = {
  title: "Emergencias · Coordinación",
};

export default async function IncidentQueuePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = await searchParams;
  const flash = readSignedFlash(query, "/coordinacion/incidentes");
  const { state, filters } = parseIncidentQueueQuery(query);
  const result = await getIncidentQueue(filters);

  const canonicalPath = canonicalPaginationHref(
    "/coordinacion/incidentes",
    copySearchParams(query),
    [
      {
        parameter: "page",
        requestedPage: filters.page ?? 1,
        pageCount: result.pageCount,
      },
    ],
  );
  if (canonicalPath) redirect(canonicalPath);

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 px-3 pb-24 pt-4 sm:px-5 sm:pt-5 lg:px-6 lg:pb-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/65 dark:text-white/65">
            Cola operativa
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Emergencias
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-black/55 dark:text-white/55">
            Revisa emergencias, señales candidatas y actividad reciente. Abrir
            una fila no cambia su estado.
          </p>
        </div>
        <Link
          href="/coordinacion/incidentes/nuevo"
          className="inline-flex min-h-11 max-w-full shrink-0 items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-center text-sm font-semibold text-[color:var(--background)] transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Plus size={17} aria-hidden />
          Nueva emergencia
        </Link>
      </header>

      {flash.notice ? (
        <p
          className="rounded-md border border-[color:var(--success)]/35 bg-[color:var(--surface)] p-3 text-sm text-[color:var(--success)]"
          role="status"
        >
          {flash.notice}
        </p>
      ) : null}
      {flash.error ? (
        <p
          className="rounded-md border border-[color:var(--danger)]/35 bg-[color:var(--surface)] p-3 text-sm text-[color:var(--danger)]"
          role="alert"
        >
          {flash.error}
        </p>
      ) : null}

      <IncidentQueueFilters state={state} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {result.total.toLocaleString("es-ES")} emergencias
        </p>
        <p className="text-xs text-black/65 dark:text-white/65">
          Página {result.page.toLocaleString("es-ES")} de{" "}
          {result.pageCount.toLocaleString("es-ES")}
        </p>
      </div>

      <IncidentQueueList incidents={result.items} />

      <QueuePagination
        basePath="/coordinacion/incidentes"
        rawSearchParams={query}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        total={result.total}
      />
    </main>
  );
}
