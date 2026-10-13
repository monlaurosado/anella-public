import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MapPin, PackageCheck } from "lucide-react";
import QRCode from "qrcode";

import { ContributionStatusForm } from "@/components/coordination/contribution-status-form";
import { PrintButton } from "@/components/coordination/print-button";
import { QueuePagination } from "@/components/coordination/queue-pagination";
import {
  copySearchParams,
  type RawSearchParams,
} from "@/components/coordination/queue-query";
import { getAppUrl } from "@/config/env";
import { formatQuantity } from "@/lib/format";
import { canonicalPaginationHref } from "@/lib/pagination-canonical";
import { readSignedFlash } from "@/lib/signed-flash";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import {
  getSafePointOperations,
  safePointOperationPageSizes,
} from "@/services/incidents";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Recepción de aportaciones · Coordinación",
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requestedPage(value: string | string[] | undefined) {
  const parsed = Number.parseInt(firstQueryValue(value) ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function requestedPageSize(value: string | string[] | undefined) {
  const parsed = Number.parseInt(firstQueryValue(value) ?? "", 10);
  return safePointOperationPageSizes.includes(
    parsed as (typeof safePointOperationPageSizes)[number],
  )
    ? parsed
    : 25;
}

export default async function SafePointOperationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const page = requestedPage(query.page);
  const safePoint = await getSafePointOperations(token, {
    page,
    pageSize: requestedPageSize(query.pageSize),
  });

  if (!safePoint) {
    notFound();
  }

  const basePath = `/coordinacion/puntos/${encodeURIComponent(safePoint.qrToken)}`;
  const flash = readSignedFlash(query, basePath);
  const canonicalPath = canonicalPaginationHref(
    basePath,
    copySearchParams(query),
    [
      {
        parameter: "page",
        requestedPage: page,
        pageCount: safePoint.contributions.pageCount,
      },
    ],
  );
  if (canonicalPath) redirect(canonicalPath);

  const checkInUrl = `${getAppUrl()}${basePath}`;
  const qrDataUrl = safePoint.isOperational
    ? await QRCode.toDataURL(checkInUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 560,
        color: { dark: "#171713", light: "#ffffff" },
      })
    : null;

  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)] print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <Link
              href={`/coordinacion/incidentes/${safePoint.incidentId}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white/60"
            >
              <ArrowLeft size={16} aria-hidden />
              Volver a la emergencia
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              {safePoint.name}
            </h1>
          </div>
          {safePoint.isOperational ? <PrintButton /> : null}
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] print:block">
        {safePoint.isOperational && qrDataUrl ? (
          <section className="order-2 rounded-lg border border-[color:var(--border)] bg-white p-5 text-[#171713] lg:order-1 print:mx-auto print:max-w-sm print:border-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em]">
              Anella · Punto de entrega validado
            </p>
            <h2 className="mt-3 text-xl font-semibold">{safePoint.name}</h2>
            <p className="mt-1 text-sm text-black/60">{safePoint.address}</p>
            <Image
              src={qrDataUrl}
              alt={`QR de recepción de ${safePoint.name}`}
              width={280}
              height={280}
              unoptimized
              className="mx-auto mt-5 h-auto w-64 max-w-full"
            />
            <p className="mt-4 text-center text-xs leading-5 text-black/60">
              Acceso reservado a coordinadores autorizados.
            </p>
          </section>
        ) : (
          <section
            className="order-2 rounded-lg border-2 border-[color:var(--danger)] bg-red-50 p-5 text-red-950 lg:order-1 print:hidden"
            role="alert"
          >
            <p className="text-xs font-bold uppercase tracking-[0.12em]">
              Punto no operativo
            </p>
            <h2 className="mt-3 text-xl font-semibold">{safePoint.name}</h2>
            <p className="mt-2 text-sm leading-6">
              No imprimas ni uses un QR de este destino. Reactívalo y valida su
              seguridad antes de coordinar nuevas recepciones.
            </p>
          </section>
        )}

        <section className="order-1 lg:order-2 print:hidden">
          {!safePoint.isOperational ? (
            <p
              className="mb-4 rounded-md border-2 border-[color:var(--danger)] bg-red-500/[0.08] p-4 text-sm font-semibold text-[color:var(--danger)]"
              role="alert"
            >
              Recepción bloqueada: este punto está inactivo o carece de una
              validación humana vigente. No dirijas entregas aquí.
            </p>
          ) : null}
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
          <div className="flex items-center gap-2">
            <PackageCheck size={18} aria-hidden />
            <h2 className="text-lg font-semibold">Recepción de aportaciones</h2>
          </div>
          <p className="mt-1 flex items-center gap-2 text-sm text-black/60 dark:text-white/60">
            <MapPin size={15} aria-hidden />
            {safePoint.incidentTitle}
          </p>

          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold">
                {safePoint.contributions.total.toLocaleString("es-ES")}{" "}
                aportaciones
              </p>
              <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                Página {safePoint.contributions.page.toLocaleString("es-ES")} de{" "}
                {safePoint.contributions.pageCount.toLocaleString("es-ES")}
              </p>
            </div>
            <form
              action={basePath}
              method="get"
              className="flex flex-wrap items-end gap-2"
            >
              <label className="grid gap-1 text-xs font-semibold">
                Filas por página
                <select
                  name="pageSize"
                  defaultValue={String(safePoint.contributions.pageSize)}
                  className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {safePointOperationPageSizes.map((pageSize) => (
                    <option key={pageSize} value={pageSize}>
                      {pageSize}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="min-h-11 rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Aplicar
              </button>
            </form>
          </div>

          <div className="mt-4 space-y-3">
            {safePoint.contributions.items.length === 0 ? (
              <p className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
                No hay aportaciones asignadas a este punto.
              </p>
            ) : null}
            {safePoint.contributions.items.map((contribution) => (
              <article
                key={contribution.id}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">
                      {contribution.citizenName}
                    </h3>
                    <p
                      className="mt-1 text-sm text-black/60 dark:text-white/60"
                      data-testid="reception-contribution-quantity"
                    >
                      {contribution.needTitle} ·{" "}
                      {formatQuantity(
                        contribution.quantity,
                        contribution.needUnit,
                      )}
                    </p>
                    <p className="mt-1 text-xs text-black/65 dark:text-white/65">
                      {contribution.publicCode} ·{" "}
                      {formatDateTimeInTimeZone(
                        contribution.createdAt,
                        contribution.incidentTimeZone,
                      )}
                    </p>
                  </div>
                  <ContributionStatusForm
                    key={`${contribution.id}-${contribution.revision}`}
                    incidentId={safePoint.incidentId}
                    contributionId={contribution.id}
                    contributionLabel={`${contribution.publicCode}, ${contribution.citizenName}`}
                    status={contribution.status.toUpperCase()}
                    quantity={contribution.quantity}
                    unit={contribution.needUnit}
                    deliveredQuantity={contribution.deliveredQuantity}
                    revision={contribution.revision}
                    destinationAvailable={contribution.safePointActive}
                    buttonLabel="Confirmar"
                  />
                </div>
              </article>
            ))}
          </div>

          <div className="mt-4">
            <QueuePagination
              basePath={basePath}
              rawSearchParams={query}
              page={safePoint.contributions.page}
              pageCount={safePoint.contributions.pageCount}
              pageSize={safePoint.contributions.pageSize}
              total={safePoint.contributions.total}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
