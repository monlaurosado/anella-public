import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";

import { changeOwnPassword } from "@/actions/users";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getAccount } from "@/services/users";
import { readSignedFlash, type FlashSearchParams } from "@/lib/signed-flash";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mi cuenta · Coordinación" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<FlashSearchParams>;
}) {
  const [account, query] = await Promise.all([getAccount(), searchParams]);
  const flash = readSignedFlash(query, "/coordinacion/cuenta");

  return (
    <main className="min-h-screen bg-[color:var(--background)] px-4 py-6 text-[color:var(--foreground)] sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={account.mustChangePassword ? "/" : "/coordinacion"}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-black/60 dark:text-white/60"
          >
            <ArrowLeft size={16} aria-hidden />
            {account.mustChangePassword
              ? "Mapa público"
              : "Centro de operaciones"}
          </Link>
          <SignOutButton />
        </div>
        <section className="mt-5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
          <KeyRound size={22} aria-hidden />
          <h1 className="mt-3 text-2xl font-semibold tracking-normal">
            Mi cuenta
          </h1>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            {account.name} · {account.email}
          </p>
          <p className="mt-1 text-xs text-black/65 dark:text-white/65">
            {account.organizationName ??
              account.municipalityName ??
              "Administración global"}
          </p>
          {account.mustChangePassword ? (
            <p
              className="mt-4 rounded-md border border-[color:var(--warning)]/35 bg-[color:var(--warning)]/5 p-3 text-sm text-[color:var(--warning)]"
              role="alert"
            >
              Esta cuenta usa una contraseña temporal. Cámbiala antes de acceder
              a cualquier operación.
            </p>
          ) : null}
          {flash.notice ? (
            <p
              className="mt-4 rounded-md border border-[color:var(--success)]/35 p-3 text-sm text-[color:var(--success)]"
              role="status"
            >
              {flash.notice}
            </p>
          ) : null}
          {flash.error ? (
            <p
              className="mt-4 rounded-md border border-[color:var(--danger)]/35 p-3 text-sm text-[color:var(--danger)]"
              role="alert"
            >
              {flash.error}
            </p>
          ) : null}
          <form action={changeOwnPassword} className="mt-5 grid gap-3">
            <p
              id="own-password-policy"
              className="text-xs leading-5 text-black/65 dark:text-white/65"
            >
              La nueva contraseña debe tener al menos 12 caracteres y no superar
              72 bytes en UTF-8.
            </p>
            <label className="grid gap-1 text-sm font-medium">
              Contraseña actual
              <input
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Nueva contraseña
              <input
                name="newPassword"
                type="password"
                required
                minLength={12}
                aria-describedby="own-password-policy"
                autoComplete="new-password"
                className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Confirmar nueva contraseña
              <input
                name="confirmation"
                type="password"
                required
                minLength={12}
                aria-describedby="own-password-policy"
                autoComplete="new-password"
                className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
              />
            </label>
            <button
              type="submit"
              className="mt-2 h-11 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)]"
            >
              Cambiar contraseña
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
