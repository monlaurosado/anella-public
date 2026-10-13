"use client";

import { Check, HandHeart } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import {
  ContributionDraftProvider,
  useContributionDraftStore,
} from "@/components/incidents/contribution-draft-context";

export type ContributionPointOption = {
  id: string;
  title: string;
  card: ReactNode;
  action?: ReactNode;
};

export function ContributionPointSelector({
  options,
  initialSelectedId,
}: {
  options: readonly ContributionPointOption[];
  initialSelectedId?: string;
}) {
  return (
    <ContributionDraftProvider>
      <Selector options={options} initialSelectedId={initialSelectedId} />
    </ContributionDraftProvider>
  );
}

function Selector({
  options,
  initialSelectedId,
}: {
  options: readonly ContributionPointOption[];
  initialSelectedId?: string;
}) {
  const actionable = options.filter((option) => option.action);
  const { busyNeedId } = useContributionDraftStore();
  const panelId = useId();
  const [selectedId, setSelectedId] = useState(
    () =>
      (initialSelectedId &&
      actionable.some((item) => item.id === initialSelectedId)
        ? initialSelectedId
        : actionable[0]?.id) ?? "",
  );

  useEffect(() => {
    function syncPointFromLocation() {
      if (busyNeedId) return;
      const requested = new URL(window.location.href).searchParams.get("punto");
      if (requested && actionable.some((item) => item.id === requested)) {
        setSelectedId(requested);
      }
    }
    window.addEventListener("popstate", syncPointFromLocation);
    return () => window.removeEventListener("popstate", syncPointFromLocation);
  }, [actionable, busyNeedId]);

  function selectPoint(id: string) {
    if (busyNeedId) return;
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("punto", id);
    url.hash = `punto-${encodeURIComponent(id)}`;
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div
      className="space-y-4"
      role="group"
      aria-label="Elige un punto de entrega"
    >
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <div
            key={option.id}
            id={`punto-${option.id}`}
            className={`grid scroll-mt-24 gap-3 ${selected ? "xl:grid-cols-[minmax(0,1fr)_390px]" : ""}`}
          >
            <div className="space-y-3">
              {option.card}
              {option.action ? (
                <button
                  type="button"
                  aria-controls={panelId}
                  aria-expanded={selected}
                  aria-pressed={selected}
                  disabled={Boolean(busyNeedId)}
                  onClick={() => selectPoint(option.id)}
                  className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold ${selected ? "border-[color:var(--success)]/40 bg-emerald-500/10 text-[color:var(--success)]" : "border-[color:var(--border)] bg-[color:var(--surface)]"}`}
                >
                  {selected ? (
                    <Check size={16} aria-hidden />
                  ) : (
                    <HandHeart size={16} aria-hidden />
                  )}
                  {selected
                    ? "Punto seleccionado"
                    : "Puedo llevar material aquí"}
                  <span className="sr-only">: {option.title}</span>
                </button>
              ) : null}
            </div>
            {selected && option.action ? (
              <div
                id={panelId}
                role="region"
                aria-label={`Aportación en ${option.title}`}
              >
                {option.action}
              </div>
            ) : null}
          </div>
        );
      })}
      {busyNeedId ? (
        <p className="text-sm text-black/65 dark:text-white/65" role="status">
          Registrando la aportación. No cierres esta página.
        </p>
      ) : null}
    </div>
  );
}
