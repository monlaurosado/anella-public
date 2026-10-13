import type { Metadata } from "next";

import { verifyOrganizationClaim } from "@/actions/organization-claims";

export const metadata: Metadata = {
  title: "Verificar solicitud · Anella",
  robots: { index: false, follow: false },
};

export default async function VerifyClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-[color:var(--background)] px-4 py-12 text-[color:var(--foreground)]">
      <div className="mx-auto max-w-lg rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
        <h1 className="text-2xl font-semibold">
          Verificar correo institucional
        </h1>
        <p className="mt-3 text-sm leading-6 text-black/65 dark:text-white/65">
          Confirma que solicitaste representar a la entidad. La verificación del
          correo no concede acceso: superadministración revisará después la
          solicitud.
        </p>
        <form action={verifyOrganizationClaim} className="mt-5">
          <input type="hidden" name="token" value={token} />
          <button className="h-11 w-full rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)]">
            Confirmar correo
          </button>
        </form>
      </div>
    </main>
  );
}
