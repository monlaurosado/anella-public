import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LAST_CONTRIBUTION_COOKIE_NAME } from "@/services/contributions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mi última aportación",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

function isPublicCode(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9-]{3,20}$/.test(value));
}

export default async function LastContributionPage() {
  const cookieStore = await cookies();
  const publicCode = cookieStore.get(LAST_CONTRIBUTION_COOKIE_NAME)?.value;

  if (isPublicCode(publicCode)) {
    redirect(`/aportaciones/${publicCode}`);
  }

  return (
    <main className="min-h-screen bg-[color:var(--background)] px-4 py-10 text-[color:var(--foreground)] sm:px-6">
      <section className="mx-auto max-w-xl rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
        <h1 className="text-2xl font-semibold tracking-normal">
          No hay una aportación reciente guardada
        </h1>
        <p className="mt-3 text-sm leading-6 text-black/65 dark:text-white/65">
          Este navegador todavía no conserva acceso a una aportación. Confirma
          qué puedes aportar desde una emergencia con un punto de entrega
          habilitado y guarda el enlace privado que se mostrará al terminar.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold"
        >
          Volver al mapa de emergencias
        </Link>
      </section>
    </main>
  );
}
