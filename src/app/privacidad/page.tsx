import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { getPrivacyConfig } from "@/config/env";

export default function PrivacyPage() {
  const privacy = getPrivacyConfig();

  return (
    <main className="min-h-screen bg-[color:var(--background)] px-4 py-6 text-[color:var(--foreground)] sm:px-6">
      <article className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white/60"
        >
          <ArrowLeft size={16} aria-hidden />
          Volver
        </Link>
        <ShieldCheck className="mt-8" size={28} aria-hidden />
        <h1 className="mt-4 text-3xl font-semibold tracking-normal">
          Privacidad
        </h1>
        <p className="mt-2 text-sm text-black/55 dark:text-white/55">
          Última actualización: 14 de julio de 2026
        </p>
        <div className="mt-6 space-y-6 text-sm leading-7 text-black/70 dark:text-white/70">
          <section aria-labelledby="privacy-controller">
            <h2
              id="privacy-controller"
              className="text-base font-semibold text-[color:var(--foreground)]"
            >
              Responsable y contacto
            </h2>
            <p>
              El responsable del tratamiento es {privacy.controllerName}. Para
              consultas de privacidad o para ejercer tus derechos, escribe a{" "}
              <a
                href={`mailto:${privacy.contactEmail}`}
                className="inline-flex min-h-11 items-center font-semibold text-[color:var(--foreground)] underline underline-offset-4"
              >
                {privacy.contactEmail}
              </a>
              .
            </p>
          </section>
          <section aria-labelledby="privacy-purpose">
            <h2
              id="privacy-purpose"
              className="text-base font-semibold text-[color:var(--foreground)]"
            >
              Finalidad, datos y base jurídica
            </h2>
            <p>
              Anella trata nombre, teléfono, email opcional, cantidad, hora
              estimada y nota opcional únicamente para registrar, coordinar,
              actualizar o cancelar la aportación elegida con un punto de
              entrega habilitado. Nombre, teléfono y correo son opcionales; no
              se crea ninguna cuenta ciudadana.
            </p>
            <p>
              Base jurídica publicada por el responsable: {privacy.legalBasis}
            </p>
          </section>
          <section aria-labelledby="privacy-access">
            <h2
              id="privacy-access"
              className="text-base font-semibold text-[color:var(--foreground)]"
            >
              Acceso, destinatarios y conservación
            </h2>
            <p>
              Los datos no se muestran públicamente ni se usan para publicidad.
              Solo acceden cuentas de coordinación activas con permiso para
              gestionar aportaciones del municipio correspondiente; toda
              mutación relevante queda auditada. La infraestructura es operada
              por {privacy.processorName} por cuenta del responsable.
            </p>
            <p>
              El mapa solicita teselas a OpenStreetMap Foundation. Esa petición
              puede transmitir la dirección IP, el agente del navegador y el
              origen del sitio, pero Anella no envía nombres, teléfonos,
              aportaciones ni señales operativas al servicio cartográfico. Lee
              la{" "}
              <a
                href="https://osmfoundation.org/wiki/Privacy_Policy"
                className="inline-flex min-h-11 items-center font-semibold text-[color:var(--foreground)] underline underline-offset-4"
                rel="noreferrer"
              >
                política de privacidad de OSMF
              </a>
              .
            </p>
            <p>
              Los datos personales de aportaciones y reclamaciones se anonimizan
              como máximo tras {privacy.retentionDays} días, o antes cuando
              vence su fecha de purga. Al cerrar una emergencia, también se
              aplica ese límite a los registros históricos. Los registros
              técnicos mínimos se conservan según las obligaciones de seguridad
              y auditoría del responsable.
            </p>
          </section>
          <section aria-labelledby="privacy-private-link">
            <h2
              id="privacy-private-link"
              className="text-base font-semibold text-[color:var(--foreground)]"
            >
              Enlace privado
            </h2>
            <p>
              El enlace privado entregado al registrar la aportación permite
              consultar su estado y cancelarla antes de la entrega. No lo
              compartas con otras personas.
            </p>
            <p>
              Para recuperar la última aportación en este navegador, Anella usa
              cookies estrictamente necesarias durante un máximo de 30 días. Son
              HttpOnly, Secure y SameSite estrictas; no contienen nombre,
              teléfono, email ni notas y no se usan para seguimiento o
              publicidad. Puedes eliminarlas borrando los datos del sitio en tu
              navegador.
            </p>
          </section>
          <section aria-labelledby="privacy-rights">
            <h2
              id="privacy-rights"
              className="text-base font-semibold text-[color:var(--foreground)]"
            >
              Tus derechos
            </h2>
            <p>
              Puedes solicitar al responsable acceso, rectificación, supresión,
              oposición, limitación o portabilidad cuando sean aplicables, así
              como retirar el consentimiento sin efectos retroactivos. Escribe
              al contacto anterior e identifica la aportación sin enviar el
              token privado completo. No se adoptan decisiones automatizadas ni
              se elaboran perfiles con estos datos.
            </p>
            <p>
              Si la respuesta no es adecuada, puedes reclamar ante la{" "}
              <a
                href="https://www.aepd.es/derechos-y-deberes/ejerce-tus-derechos"
                className="inline-flex min-h-11 items-center font-semibold text-[color:var(--foreground)] underline underline-offset-4"
              >
                Agencia Española de Protección de Datos
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
