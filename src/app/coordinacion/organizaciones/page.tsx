import type { Metadata } from "next";

import {
  addOrganizationDomain,
  reviewOrganizationClaim,
} from "@/actions/organization-claims";
import { Badge } from "@/components/ui/badge";
import { OrganizationClaimStatus } from "@/generated/prisma/enums";
import { getOrganizationDashboard } from "@/services/organization-claims";

export const metadata: Metadata = { title: "Organización · Coordinación" };

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [dashboard, query] = await Promise.all([
    getOrganizationDashboard(),
    searchParams,
  ]);
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">Cuenta y organización</h1>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        Verificación, dominios institucionales y solicitudes de representación.
      </p>
      {query.notice ? (
        <p
          className="mt-4 rounded-md bg-emerald-500/10 p-3 text-sm"
          role="status"
        >
          {query.notice}
        </p>
      ) : null}
      {query.error ? (
        <p className="mt-4 rounded-md bg-red-500/10 p-3 text-sm" role="alert">
          {query.error}
        </p>
      ) : null}

      <section className="mt-6 grid gap-3 md:grid-cols-2">
        {dashboard.organizations.map((organization) => (
          <article
            key={organization.id}
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  organization.verificationStatus === "VERIFIED"
                    ? "success"
                    : "warning"
                }
              >
                {organization.verificationStatus === "VERIFIED"
                  ? "Verificada"
                  : organization.verificationStatus}
              </Badge>
              <span className="text-xs">{organization.kind}</span>
            </div>
            <h2 className="mt-3 font-semibold">{organization.name}</h2>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              {organization.municipality?.name ?? "Ámbito supramunicipal"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {organization.domains.map((domain) => (
                <span
                  key={domain.id}
                  className="rounded-md bg-[color:var(--surface-muted)] px-2 py-1 text-xs"
                >
                  {domain.domain}
                </span>
              ))}
            </div>
            {dashboard.canReview ? (
              <form
                action={addOrganizationDomain}
                className="mt-4 flex flex-col gap-2 sm:flex-row"
              >
                <input
                  type="hidden"
                  name="organizationId"
                  value={organization.id}
                />
                <input
                  name="domain"
                  required
                  placeholder="entidad.es"
                  className="h-11 min-w-0 flex-1 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
                />
                <button className="h-11 rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold">
                  Autorizar dominio
                </button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      <section className="mt-7 space-y-3">
        <h2 className="text-lg font-semibold">Solicitudes de representación</h2>
        {dashboard.claims.map((claim) => (
          <article
            key={claim.id}
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
          >
            <div className="flex flex-wrap gap-2">
              <Badge
                tone={
                  claim.status === OrganizationClaimStatus.PENDING_REVIEW
                    ? "warning"
                    : claim.status === OrganizationClaimStatus.APPROVED
                      ? "success"
                      : "neutral"
                }
              >
                {claim.status}
              </Badge>
              <span className="text-xs text-black/60 dark:text-white/60">
                {claim.organization.name}
              </span>
            </div>
            <p className="mt-3 text-sm font-semibold">{claim.claimantName}</p>
            <p className="text-sm text-black/60 dark:text-white/60">
              {claim.claimantEmail} · {claim.emailDomain}
            </p>
            {dashboard.canReview &&
            claim.status === OrganizationClaimStatus.PENDING_REVIEW ? (
              <form
                action={reviewOrganizationClaim}
                className="mt-4 grid gap-2"
              >
                <input type="hidden" name="claimId" value={claim.id} />
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={500}
                  className="min-h-20 rounded-md border border-[color:var(--border)] bg-transparent p-3 text-sm"
                  placeholder="Motivo de la decisión y comprobaciones realizadas"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    name="decision"
                    value="approve"
                    className="h-11 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)]"
                  >
                    Aprobar y preparar cuenta
                  </button>
                  <button
                    name="decision"
                    value="reject"
                    className="h-11 rounded-md border border-[color:var(--danger)] px-4 text-sm font-semibold text-[color:var(--danger)]"
                  >
                    Rechazar
                  </button>
                </div>
              </form>
            ) : null}
          </article>
        ))}
        {dashboard.claims.length === 0 ? (
          <p className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
            No hay solicitudes en este ámbito.
          </p>
        ) : null}
      </section>
    </main>
  );
}
