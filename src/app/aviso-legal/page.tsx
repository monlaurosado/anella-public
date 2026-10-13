import Link from "next/link";
import { ArrowLeft, Scale } from "lucide-react";

import { getLegalConfig } from "@/config/env";

export default function LegalNoticePage() {
  const legal = getLegalConfig();

  return (
    <main className="min-h-screen bg-[color:var(--background)] px-4 py-6 text-[color:var(--foreground)] sm:px-6">
      <article className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-black/60 dark:text-white/60"
        >
          <ArrowLeft size={16} aria-hidden />
          Volver
        </Link>
        <Scale className="mt-8" size={28} aria-hidden />
        <h1 className="mt-4 text-3xl font-semibold tracking-normal">
          Aviso legal
        </h1>
        <div className="mt-6 space-y-5 text-sm leading-7 text-black/70 dark:text-white/70">
          <p>
            Titular: <strong>{legal.entityName}</strong>, identificación{" "}
            {legal.identifier}, con domicilio en {legal.address}. Contacto:{" "}
            <a
              className="inline-flex min-h-11 items-center font-semibold underline"
              href={`mailto:${legal.contactEmail}`}
            >
              {legal.contactEmail}
            </a>
            .
          </p>
          <p>
            Anella facilita la coordinación de ayuda ciudadana previamente
            validada. No es un servicio de emergencias, no sustituye al 112 y no
            autoriza a acceder a zonas de intervención o de riesgo.
          </p>
          <p>
            La información pública puede cambiar durante una emergencia. Antes
            de desplazarte, comprueba que el punto de entrega continúa activo y
            sigue exclusivamente sus indicaciones públicas. No acudas a la zona
            de la emergencia.
          </p>
          <p>
            La cartografía usa datos © OpenStreetMap contributors bajo ODbL. Las
            teselas comunitarias son un servicio de disponibilidad no
            garantizada y pueden sustituirse por un proveedor aprobado sin
            alterar la información operativa. Consulta la{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              className="inline-flex min-h-11 items-center font-semibold underline"
            >
              licencia y atribución
            </a>
            . Las detecciones de incendio recibidas de fuentes conectadas se
            representan automáticamente en el mapa público con su procedencia y
            hora. Una detección satelital es aproximada y no equivale por sí
            sola a un perímetro oficial ni a una instrucción de desplazamiento.
          </p>
          <p>
            Consulta también la{" "}
            <Link
              href="/privacidad"
              className="inline-flex min-h-11 items-center font-semibold underline"
            >
              política de privacidad
            </Link>
            .
          </p>
        </div>
      </article>
    </main>
  );
}
