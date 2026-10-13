import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, Radio } from "lucide-react";

import { IncidentActivity } from "@/components/coordination/incident-activity";
import {
  IncidentContributions,
  parseIncidentContributionFilter,
} from "@/components/coordination/incident-contributions";
import { IncidentNeeds } from "@/components/coordination/incident-needs";
import { IncidentSafePoints } from "@/components/coordination/incident-safe-points";
import { IncidentSummary } from "@/components/coordination/incident-summary";
import {
  IncidentTabs,
  parseIncidentTab,
} from "@/components/coordination/incident-tabs";
import { IncidentStatusPill, PriorityPill } from "@/components/ui/status-pill";
import { QueuePagination } from "@/components/coordination/queue-pagination";
import {
  copySearchParams,
  type RawSearchParams,
} from "@/components/coordination/queue-query";
import { canonicalPaginationHref } from "@/lib/pagination-canonical";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import { readSignedFlash, signedFlashPath } from "@/lib/signed-flash";
import {
  getManagedContributionPage,
  getManagedIncidentTitle,
  getManagedIncidentById,
} from "@/services/incidents";

type IncidentPageSearchParams = RawSearchParams;

const detailPageSizes = [10, 25, 50, 100] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const incident = await getManagedIncidentTitle(id);
  return {
    title: incident
      ? `${incident.publicCode} · ${incident.title} · Coordinación`
      : "Emergencia no disponible · Coordinación",
  };
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | string[] | undefined) {
  const raw = firstQueryValue(value) ?? "";
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1;
}

function detailPageSize(value: string | string[] | undefined) {
  const parsed = Number.parseInt(firstQueryValue(value) ?? "", 10);
  return detailPageSizes.includes(parsed as (typeof detailPageSizes)[number])
    ? parsed
    : 25;
}

export default async function ManageIncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<IncidentPageSearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab = parseIncidentTab(firstQueryValue(query.tab));
  const contributionStatus = parseIncidentContributionFilter(
    firstQueryValue(query.contributionStatus),
  );
  const requestedPage = positiveInteger(query.page);
  const pageSize = detailPageSize(query.pageSize);
  const focusContributionId = firstQueryValue(
    query.focusContributionId,
  )?.trim();
  const basePath = `/coordinacion/incidentes/${encodeURIComponent(id)}`;

  if (tab === "contributions" && focusContributionId) {
    const targetPage = await getManagedContributionPage(
      id,
      focusContributionId,
      { pageSize, contributionStatus },
    );
    const canonicalQuery = copySearchParams(query);
    canonicalQuery.delete("focusContributionId");
    canonicalQuery.set("tab", "contributions");
    if (targetPage) {
      canonicalQuery.set("page", String(targetPage));
      redirect(
        `${basePath}?${canonicalQuery.toString()}#aportacion-${encodeURIComponent(focusContributionId)}`,
      );
    }
    canonicalQuery.delete("page");
    redirect(
      signedFlashPath(
        `${basePath}?${canonicalQuery.toString()}`,
        "error",
        "La aportación no está disponible en esta emergencia.",
      ),
    );
  }

  const incident = await getManagedIncidentById(id, {
    tab,
    page: requestedPage,
    pageSize,
    contributionStatus,
  });

  if (!incident) {
    notFound();
  }

  const canonicalBasePath = `/coordinacion/incidentes/${incident.id}`;
  const canonicalPath = canonicalPaginationHref(
    canonicalBasePath,
    copySearchParams(query),
    [
      {
        parameter: "page",
        requestedPage,
        pageCount: incident.pagination.pageCount,
      },
    ],
  );
  if (canonicalPath) redirect(canonicalPath);
  const { notice, error } = readSignedFlash(query, canonicalBasePath);

  return (
    <main className="min-h-screen pb-24 lg:pb-8">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <Link
            href="/coordinacion/incidentes?view=active"
            className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white/60"
          >
            <ArrowLeft size={17} aria-hidden />
            Volver a emergencias
          </Link>

          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-black/65 dark:text-white/65">
                {incident.publicCode} · {incident.municipality.name}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                {incident.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <IncidentStatusPill status={incident.status} />
                <PriorityPill priority={incident.priority} />
                <span className="text-xs text-black/65 dark:text-white/65">
                  Última actividad{" "}
                  {formatDateTimeInTimeZone(
                    incident.lastActivityAt,
                    incident.timeZone,
                  )}
                </span>
              </div>
            </div>

            {incident.isPubliclyVisible ? (
              <Link
                href={`/incidentes/${incident.id}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold transition hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.04]"
              >
                <ExternalLink size={16} aria-hidden />
                Abrir vista pública
              </Link>
            ) : null}
          </div>
        </div>

        <IncidentTabs
          incidentId={incident.id}
          activeTab={tab}
          needCount={incident.counts.needs}
          contributionCount={incident.counts.contributions}
          safePointCount={incident.counts.safePoints}
          activityCount={incident.counts.activity}
        />
      </header>

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {notice ? (
          <p
            className="mb-5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.08] p-3 text-sm font-medium text-[color:var(--success)]"
            role="status"
          >
            {notice}
          </p>
        ) : null}
        {error ? (
          <p
            className="mb-5 rounded-md border border-red-500/30 bg-red-500/[0.08] p-3 text-sm font-medium text-[color:var(--danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {tab === "summary" ? <IncidentSummary incident={incident} /> : null}
        {tab === "needs" ? <IncidentNeeds incident={incident} /> : null}
        {tab === "contributions" ? (
          <IncidentContributions
            incident={incident}
            statusFilter={contributionStatus}
          />
        ) : null}
        {tab === "safe-points" ? (
          <IncidentSafePoints incident={incident} />
        ) : null}
        {tab === "activity" ? <IncidentActivity incident={incident} /> : null}

        {tab !== "summary" ? (
          <section
            aria-label="Paginación de la sección"
            className="mt-6 space-y-4"
          >
            <form
              action={canonicalBasePath}
              method="get"
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="tab" value={tab} />
              {tab === "contributions" ? (
                <input
                  type="hidden"
                  name="contributionStatus"
                  value={contributionStatus}
                />
              ) : null}
              <label className="grid gap-1 text-xs font-semibold">
                Filas por página
                <select
                  name="pageSize"
                  defaultValue={String(incident.pagination.pageSize)}
                  className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {detailPageSizes.map((pageSize) => (
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
            <QueuePagination
              basePath={canonicalBasePath}
              rawSearchParams={query}
              page={incident.pagination.page}
              pageCount={incident.pagination.pageCount}
              pageSize={incident.pagination.pageSize}
              total={incident.pagination.total}
            />
          </section>
        ) : null}

        <p className="mt-8 flex items-center gap-2 border-t border-[color:var(--border)] pt-5 text-xs text-black/65 dark:text-white/65">
          <Radio size={14} aria-hidden />
          Zona horaria operativa: {incident.timeZone}
        </p>
      </div>
    </main>
  );
}
