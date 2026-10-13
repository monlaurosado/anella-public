import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";

import { requestOrganizationClaim } from "@/actions/organization-claims";
import { listClaimableOrganizations } from "@/services/organization-claims";

export const metadata: Metadata = {
  title: "Representar una entidad · Anella",
  robots: { index: false, follow: false },
};

export default async function ClaimOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{
    enviado?: string;
    verificado?: string;
    error?: string;
  }>;
}) {
  const [organizations, query] = await Promise.all([
    listClaimableOrganizations(),
    searchParams,
  ]);
  return (
    <main className="min-h-screen bg-[color:var(--background)] px-4 py-8 text-[color:var(--foreground)]">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm font-semibold underline"
        >
          Volver al mapa
        </Link>
        <div className="mt-4 flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-[color:var(--foreground)] text-[color:var(--background)]">
            <Building2 size={19} aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Representar una entidad</h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              Solicita la verificación de una entidad precargada. Esto no crea
              una cuenta ciudadana ni concede acceso inmediato.
            </p>
          </div>
        </div>
        {query.enviado ? (
          <p
            className="mt-5 rounded-md bg-emerald-500/10 p-4 text-sm"
            role="status"
          >
            Si la solicitud es válida, enviaremos un enlace al correo indicado.
            Después deberá revisarla superadministración.
          </p>
        ) : null}
        {query.verificado ? (
          <p
            className="mt-5 rounded-md bg-blue-500/10 p-4 text-sm"
            role="status"
          >
            Correo verificado. La solicitud queda pendiente de revisión humana;
            aún no existe acceso operativo.
          </p>
        ) : null}
        {query.error ? (
          <p className="mt-5 rounded-md bg-red-500/10 p-4 text-sm" role="alert">
            {query.error}
          </p>
        ) : null}

        <form
          action={requestOrganizationClaim}
          className="mt-6 grid gap-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5"
        >
          <label className="grid gap-1 text-xs font-medium">
            Entidad
            <select
              name="organizationId"
              required
              className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
            >
              <option value="">Selecciona una entidad</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organization.municipalityName}
                  {organization.province ? ` (${organization.province})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Nombre y apellidos
            <input
              name="claimantName"
              required
              minLength={2}
              maxLength={191}
              autoComplete="name"
              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Correo institucional
            <input
              name="claimantEmail"
              type="email"
              required
              maxLength={191}
              autoComplete="email"
              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
            />
          </label>
          <div className="flex gap-2 rounded-md bg-[color:var(--surface-muted)] p-3 text-xs leading-5">
            <ShieldCheck className="mt-0.5 shrink-0" size={16} aria-hidden />
            <p>
              El dominio se contrastará con la política de la entidad. Un
              dominio no reconocido pasa a revisión manual; nunca se crea
              automáticamente una cuenta coordinadora.
            </p>
          </div>
          <button className="h-11 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)]">
            Enviar solicitud de verificación
          </button>
        </form>
      </div>
    </main>
  );
}
