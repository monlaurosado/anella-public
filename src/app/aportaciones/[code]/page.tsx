import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowLeft,
  CircleAlert,
  Clock3,
  MapPinCheck,
  PackageCheck,
  ShieldAlert,
} from "lucide-react";

import {
  CancelContributionForm,
  ContributionAccessBootstrap,
  CopyPrivateContributionLink,
} from "@/components/incidents/cancel-contribution-form";
import { formatQuantity } from "@/lib/format";
import {
  getContributionAccessCookieName,
  getContributionStatus,
} from "@/services/contributions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Aportación privada",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

const statusLabels: Record<string, string> = {
  PLEDGED: "Confirmada",
  EN_ROUTE: "En camino",
  PARTIALLY_DELIVERED: "Entrega parcial",
  DELIVERED: "Entregada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No presentada",
};

const noticeClasses = {
  safe: "border-[color:var(--success)]/35 text-[color:var(--success)]",
  blocked: "border-[color:var(--danger)]/35 text-[color:var(--danger)]",
  complete: "border-[color:var(--border)] text-[color:var(--foreground)]",
};

function isPublicCode(value: string) {
  return /^[A-Za-z0-9-]{3,20}$/.test(value);
}

function formatZonedDateTime(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(value));
  }
}

export default async function ContributionStatusPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cookieStore = await cookies();
  const token = isPublicCode(code)
    ? cookieStore.get(getContributionAccessCookieName(code))?.value
    : undefined;
  const contribution = token ? await getContributionStatus(code, token) : null;

  return (
    <main className="min-h-screen bg-[color:var(--background)] px-4 py-6 text-[color:var(--foreground)] sm:px-6">
      <div className="mx-auto max-w-2xl">
        {contribution?.incidentIsPublic ? (
          <Link
            href={`/incidentes/${contribution.incidentId}`}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-black/60 dark:text-white/60"
          >
            <ArrowLeft size={16} aria-hidden />
            Volver al incidente
          </Link>
        ) : null}

        <div className={contribution?.incidentIsPublic ? "mt-5" : undefined}>
          <ContributionAccessBootstrap
            publicCode={code}
            hasAccess={Boolean(contribution)}
          />
        </div>

        {contribution ? (
          <>
            <section className="rounded-lg border border-[color:var(--danger)]/35 bg-[color:var(--surface)] p-4">
              <ShieldAlert
                className="text-[color:var(--danger)]"
                size={22}
                aria-hidden
              />
              <h2 className="mt-3 text-sm font-semibold">
                En una emergencia, llama al 112
              </h2>
              <p className="mt-2 text-sm leading-6 text-black/65 dark:text-white/65">
                Anella coordina aportaciones hacia puntos de entrega
                habilitados, pero no sustituye a los servicios de emergencia. No
                acudas nunca a la zona de intervención.
              </p>
            </section>

            <section className="mt-5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
              <PackageCheck size={24} aria-hidden />
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-black/65 dark:text-white/65">
                {contribution.publicCode}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-normal">
                {statusLabels[contribution.status] ?? contribution.status}
              </h1>
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                {contribution.incidentTitle}
              </p>

              <div className="mt-5">
                <CopyPrivateContributionLink publicCode={code} />
              </div>

              <div
                className={`mt-5 rounded-md border bg-[color:var(--surface)] p-4 text-sm leading-6 ${noticeClasses[contribution.deliveryNotice.tone]}`}
                role={
                  contribution.deliveryNotice.tone === "blocked"
                    ? "alert"
                    : "status"
                }
              >
                <CircleAlert size={18} aria-hidden />
                <p className="mt-2 font-semibold">
                  {contribution.deliveryNotice.message}
                </p>
              </div>

              <dl className="mt-5 grid gap-4 border-y border-[color:var(--border)] py-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-black/65 dark:text-white/65">
                    Aportación
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {contribution.needTitle}
                  </dd>
                </div>
                <div>
                  <dt className="text-black/65 dark:text-white/65">
                    Cantidad comprometida
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {formatQuantity(contribution.quantity, contribution.unit)}
                  </dd>
                  {contribution.deliveredQuantity > 0 ? (
                    <dd className="mt-1 text-black/60 dark:text-white/60">
                      Entregada:{" "}
                      {formatQuantity(
                        contribution.deliveredQuantity,
                        contribution.unit,
                      )}
                    </dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-black/65 dark:text-white/65">
                    Registrada
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {formatZonedDateTime(
                      contribution.createdAt,
                      contribution.incidentTimeZone,
                    )}
                  </dd>
                </div>
                {contribution.eta ? (
                  <div>
                    <dt className="flex items-center gap-2 text-black/65 dark:text-white/65">
                      <Clock3 size={15} aria-hidden />
                      Llegada estimada
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {formatZonedDateTime(
                        contribution.eta,
                        contribution.incidentTimeZone,
                      )}
                    </dd>
                  </div>
                ) : null}
                {contribution.deadline ? (
                  <div>
                    <dt className="text-black/65 dark:text-white/65">
                      Plazo de la necesidad
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {formatZonedDateTime(
                        contribution.deadline,
                        contribution.incidentTimeZone,
                      )}
                    </dd>
                    <dd className="mt-1 text-xs text-black/65 dark:text-white/65">
                      Zona horaria: {contribution.incidentTimeZone}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {contribution.deliveryNotice.canProceed &&
              contribution.safePointName ? (
                <section className="mt-5 rounded-md border border-[color:var(--success)]/35 p-4">
                  <MapPinCheck
                    className="text-[color:var(--success)]"
                    size={20}
                    aria-hidden
                  />
                  <h2 className="mt-2 text-sm font-semibold">
                    Punto de entrega habilitado
                  </h2>
                  <p className="mt-2 text-sm font-semibold">
                    {contribution.safePointName}
                  </p>
                  {contribution.safePointAddress ? (
                    <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                      {contribution.safePointAddress}
                    </p>
                  ) : null}
                </section>
              ) : null}

              {contribution.canCancel ? (
                <div className="mt-5">
                  <CancelContributionForm publicCode={code} />
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
