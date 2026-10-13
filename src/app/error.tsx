"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--background)] px-4 text-[color:var(--foreground)]">
      <section className="max-w-md text-center">
        <AlertTriangle
          className="mx-auto text-[color:var(--danger)]"
          size={30}
          aria-hidden
        />
        <h1 className="mt-4 text-2xl font-semibold tracking-normal">
          No se ha podido cargar la información
        </h1>
        <p className="mt-3 text-sm leading-6 text-black/60 dark:text-white/60">
          Comprueba la conexión. No des la operación por confirmada: revisa el
          estado actual antes de reintentar para evitar duplicados.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-[color:var(--foreground)] px-3 text-sm font-semibold text-[color:var(--background)]"
        >
          <RotateCcw size={15} aria-hidden />
          Reintentar
        </button>
      </section>
    </main>
  );
}
