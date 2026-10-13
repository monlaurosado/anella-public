import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, BellRing, HandHeart } from "lucide-react";

import {
  ContributionPointSelector,
  type ContributionPointOption,
} from "@/components/incidents/contribution-point-selector";
import { NeedCard } from "@/components/incidents/need-card";
import { SafePointCard } from "@/components/incidents/safe-point-card";
import { IncidentStatusPill, PriorityPill } from "@/components/ui/status-pill";
import { calculateRemainingQuantity } from "@/lib/contribution-quantities";
import type { Incident } from "@/types/domain";

type PublicIncidentViewProps =
  | {
      incident: Incident;
      initialSelectedPointId?: string;
      mode: "public";
      recentContributionPath?: string;
      contributionActions: Readonly<Record<string, ReactNode>>;
    }
  | {
      incident: Incident;
      mode: "preview";
      contributionActions?: never;
    };

function PreviewContributionBoundary() {
  return (
    <section
      className="rounded-lg border border-dashed border-[color:var(--border)] bg-[color:var(--surface)] p-4"
      data-preview-inert-action
    >
      <h5 className="text-sm font-semibold">¿Qué puedes aportar?</h5>
      <p className="mt-2 text-xs leading-5 text-black/60 dark:text-white/60">
        La acción ciudadana aparece aquí en la web pública. Está desactivada en
        la vista previa y no registra datos.
      </p>
      <button
        type="button"
        disabled
        className="mt-4 h-11 w-full rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] opacity-45"
      >
        Voy a aportar · Desactivado
      </button>
    </section>
  );
}

export function PublicIncidentView(props: PublicIncidentViewProps) {
  const { incident, mode } = props;
  const IncidentHeading = mode === "public" ? "h1" : "h3";
  const SectionHeading = mode === "public" ? "h2" : "h4";
  const cardHeadingLevel = mode === "public" ? 3 : 5;
  const pointOptions: ContributionPointOption[] = incident.safePoints.map(
    (point) => ({
      id: point.id,
      title: point.name,
      card: <SafePointCard point={point} headingLevel={cardHeadingLevel} />,
      action:
        mode === "public" ? (
          props.contributionActions[point.id]
        ) : (
          <PreviewContributionBoundary />
        ),
    }),
  );

  return (
    <div
      className="mx-auto max-w-6xl px-4 py-5 sm:px-6"
      data-public-incident-view={mode}
    >
      {mode === "public" ? (
        <nav className="flex flex-wrap gap-3" aria-label="Navegación ciudadana">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-black/65 dark:text-white/65"
          >
            <ArrowLeft size={16} aria-hidden /> Volver al mapa
          </Link>
          <Link
            href="/aportaciones/ultima"
            className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
          >
            Mi última aportación
          </Link>
        </nav>
      ) : (
        <div
          className="rounded-md border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm leading-6"
          role="note"
        >
          <strong>Modo vista previa.</strong> Las acciones ciudadanas están
          aisladas y desactivadas.
        </div>
      )}

      <div
        className="mt-5 rounded-lg border-2 border-[color:var(--danger)] bg-[color:var(--surface)] p-4 text-sm"
        role="alert"
        data-public-section="emergency"
      >
        <strong>Peligro inmediato: llama al 112.</strong> No acudas a la zona de
        la emergencia ni sigas indicaciones no publicadas por una entidad
        responsable.
      </div>

      <section
        className="mt-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5"
        data-public-section="summary"
      >
        <div className="flex flex-wrap gap-2">
          <IncidentStatusPill status={incident.status} />
          <PriorityPill priority={incident.priority} />
        </div>
        <IncidentHeading className="mt-4 text-3xl font-semibold tracking-normal">
          {incident.title}
        </IncidentHeading>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-black/65 dark:text-white/65">
          {incident.publicSummary}
        </p>
        <p className="mt-4 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm font-medium">
          {incident.safetyNotice}
        </p>
      </section>

      {incident.notices.length > 0 ? (
        <section className="mt-4 space-y-3" data-public-section="notices">
          <SectionHeading className="flex items-center gap-2 text-lg font-semibold">
            <BellRing size={18} aria-hidden /> Avisos oficiales
          </SectionHeading>
          {incident.notices.map((notice) => (
            <article
              key={notice.id}
              className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4"
            >
              <h3 className="font-semibold">{notice.title}</h3>
              <p className="mt-2 text-sm leading-6">{notice.body}</p>
              <p className="mt-2 text-xs text-black/60 dark:text-white/60">
                {notice.organizationName}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {mode === "public" && props.recentContributionPath ? (
        <section
          className="mt-4 rounded-lg border border-[color:var(--success)]/35 bg-emerald-500/10 p-4"
          role="status"
        >
          <h2 className="text-base font-semibold">Aportación guardada</h2>
          <p className="mt-2 text-sm">
            Este navegador conserva el acceso privado a tu aportación más
            reciente.
          </p>
          <Link
            href={props.recentContributionPath}
            data-contribution-recovery
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-[color:var(--success)]/40 bg-[color:var(--surface)] px-3 text-sm font-semibold"
          >
            Ver mi última aportación
          </Link>
        </section>
      ) : null}

      <section className="mt-5 space-y-4" data-public-section="drop-off-points">
        <div>
          <SectionHeading className="text-xl font-semibold">
            Puntos de entrega habilitados
          </SectionHeading>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Elige un punto oficial activo y comunica qué puedes llevar. Un punto
            de entrega no es un refugio ni una zona de evacuación.
          </p>
        </div>
        {pointOptions.length > 0 ? (
          <ContributionPointSelector
            options={pointOptions}
            initialSelectedId={
              mode === "public" ? props.initialSelectedPointId : undefined
            }
          />
        ) : (
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
            No hay puntos de entrega activos. No lleves material ni te desplaces
            por tu cuenta.
          </div>
        )}
      </section>

      {incident.needs.length > 0 ? (
        <section className="mt-6" data-public-section="needs">
          <SectionHeading className="text-xl font-semibold">
            Ayuda solicitada ahora
          </SectionHeading>
          <p className="mb-4 mt-1 text-sm text-black/60 dark:text-white/60">
            Necesidades verificadas y asociadas a un punto de entrega público.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {incident.needs.map((need) => {
              const point = incident.safePoints.find(
                (candidate) => candidate.id === need.safePointId,
              );
              const canOffer =
                Boolean(point) &&
                need.status === "active" &&
                calculateRemainingQuantity(need) > 0;
              return (
                <div key={need.id} className="space-y-2">
                  <NeedCard
                    need={need}
                    safePoint={point}
                    headingLevel={cardHeadingLevel}
                  />
                  {mode === "public" && point && canOffer ? (
                    <Link
                      href={`/incidentes/${incident.id}?punto=${encodeURIComponent(point.id)}&necesidad=${encodeURIComponent(need.id)}#punto-${encodeURIComponent(point.id)}`}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)]"
                    >
                      <HandHeart size={16} aria-hidden />
                      Lo ofrezco
                    </Link>
                  ) : mode === "preview" && canOffer ? (
                    <button
                      type="button"
                      disabled
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] opacity-45"
                    >
                      <HandHeart size={16} aria-hidden />
                      Lo ofrezco · Desactivado
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
