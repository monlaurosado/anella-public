import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContributionQueueFilters } from "@/components/coordination/contribution-queue-filters";
import { ContributionQueueList } from "@/components/coordination/contribution-queue-list";
import { QueuePagination } from "@/components/coordination/queue-pagination";
import {
  copySearchParams,
  parseContributionQueueQuery,
  type RawSearchParams,
} from "@/components/coordination/queue-query";
import { canonicalPaginationHref } from "@/lib/pagination-canonical";
import { readSignedFlash } from "@/lib/signed-flash";
import { getContributionQueue } from "@/services/incidents";

export const metadata: Metadata = {
  title: "Aportaciones · Coordinación",
};

export default async function ContributionQueuePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = await searchParams;
  const flash = readSignedFlash(query, "/coordinacion/aportaciones");
  const { state, filters } = parseContributionQueueQuery(query);
  const result = await getContributionQueue(filters);

  const canonicalPath = canonicalPaginationHref(
    "/coordinacion/aportaciones",
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
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/65 dark:text-white/65">
          Cola operativa
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Aportaciones
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-black/55 dark:text-white/55">
          Seguimiento global de compromisos y entregas. Abrir una fila muestra
          su emergencia; no confirma la recepción automáticamente.
        </p>
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

      <ContributionQueueFilters state={state} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {result.total.toLocaleString("es-ES")} aportaciones
        </p>
        <p className="text-xs text-black/65 dark:text-white/65">
          Página {result.page.toLocaleString("es-ES")} de{" "}
          {result.pageCount.toLocaleString("es-ES")}
        </p>
      </div>

      <ContributionQueueList contributions={result.items} />

      <QueuePagination
        basePath="/coordinacion/aportaciones"
        rawSearchParams={query}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        total={result.total}
      />
    </main>
  );
}
