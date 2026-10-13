import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentCoordinator } from "@/lib/dal";
import { readSignedFlash, type FlashSearchParams } from "@/lib/signed-flash";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Acceso a coordinación" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<FlashSearchParams>;
}) {
  const [coordinator, query] = await Promise.all([
    getCurrentCoordinator(),
    searchParams,
  ]);

  if (coordinator) {
    redirect(
      coordinator.mustChangePassword ? "/coordinacion/cuenta" : "/coordinacion",
    );
  }
  const flash = readSignedFlash(query, "/login");

  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div className="mx-auto max-w-md px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white/60"
        >
          <ArrowLeft size={16} aria-hidden />
          Volver al mapa
        </Link>
        <div className="mt-6">
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
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
