import Link from "next/link";
import { ArrowLeft, MapPinOff } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--background)] px-4 text-[color:var(--foreground)]">
      <section className="max-w-md text-center">
        <MapPinOff className="mx-auto" size={30} aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold tracking-normal">
          No se ha encontrado esta información
        </h1>
        <p className="mt-3 text-sm leading-6 text-black/60 dark:text-white/60">
          Puede haberse retirado, cerrado o no estar disponible para tu cuenta.
          No te desplaces usando información antigua: consulta únicamente los
          incidentes y puntos que sigan publicados. Si hay peligro inmediato,
          llama al 112.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-[color:var(--foreground)] px-3 text-sm font-semibold text-[color:var(--background)]"
        >
          <ArrowLeft size={15} aria-hidden />
          Volver al mapa
        </Link>
      </section>
    </main>
  );
}
