"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Check, HandHeart } from "lucide-react";

import {
  ContributionDraftProvider,
  useContributionDraftStore,
} from "@/components/incidents/contribution-draft-context";

export type ContributionNeedOption = {
  action?: ReactNode;
  card: ReactNode;
  id: string;
  title: string;
};

export function ContributionNeedSelector({
  initialSelectedId,
  options,
  recoveryPath,
  requestedId,
}: {
  initialSelectedId?: string;
  options: readonly ContributionNeedOption[];
  recoveryPath?: string;
  requestedId?: string;
}) {
  return (
    <ContributionDraftProvider>
      <ContributionNeedSelectorContent
        initialSelectedId={initialSelectedId}
        options={options}
        recoveryPath={recoveryPath}
        requestedId={requestedId}
      />
    </ContributionDraftProvider>
  );
}

function ContributionNeedSelectorContent({
  initialSelectedId,
  options,
  recoveryPath,
  requestedId,
}: {
  initialSelectedId?: string;
  options: readonly ContributionNeedOption[];
  recoveryPath?: string;
  requestedId?: string;
}) {
  const selectableOptions = options.filter((option) => option.action);
  const selectableIds = selectableOptions.map((option) => option.id);
  const selectableIdsKey = selectableIds.join("\u0000");
  const contributionPanelId = useId();
  const { busyNeedId, clearSnapshot, setBusy } = useContributionDraftStore();
  const idleRecoveryPathRef = useRef(recoveryPath);
  const [selectedId, setSelectedId] = useState(
    () =>
      (initialSelectedId && selectableIds.includes(initialSelectedId)
        ? initialSelectedId
        : requestedId
          ? undefined
          : selectableOptions[0]?.id) ?? "",
  );
  const [unavailableRequestedId, setUnavailableRequestedId] = useState(
    () =>
      (requestedId && !selectableIds.includes(requestedId)
        ? requestedId
        : undefined) ?? "",
  );

  useEffect(() => {
    if (!busyNeedId) {
      idleRecoveryPathRef.current = recoveryPath;
      return;
    }
    if (!recoveryPath || recoveryPath === idleRecoveryPathRef.current) {
      return;
    }
    const confirmedNeedId = busyNeedId;
    const frame = window.requestAnimationFrame(() => {
      clearSnapshot(confirmedNeedId);
      setSelectedId("");
      setBusy(confirmedNeedId, false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busyNeedId, clearSnapshot, recoveryPath, setBusy]);

  useEffect(() => {
    function selectRequestedNeed() {
      if (busyNeedId) return;

      const availableIds = selectableIdsKey
        ? selectableIdsKey.split("\u0000")
        : [];
      const queryRequestedId = new URL(window.location.href).searchParams.get(
        "necesidad",
      );
      const hashPrefix = "#necesidad-";
      let locationRequestedId = queryRequestedId ?? "";
      try {
        if (window.location.hash.startsWith(hashPrefix)) {
          locationRequestedId = decodeURIComponent(
            window.location.hash.slice(hashPrefix.length),
          );
        }
      } catch {
        return;
      }

      setSelectedId((currentId) =>
        availableIds.includes(locationRequestedId)
          ? locationRequestedId
          : locationRequestedId
            ? ""
            : availableIds.includes(currentId)
              ? currentId
              : (availableIds[0] ?? ""),
      );
      setUnavailableRequestedId(
        locationRequestedId && !availableIds.includes(locationRequestedId)
          ? locationRequestedId
          : "",
      );
    }

    const frame = window.requestAnimationFrame(selectRequestedNeed);
    window.addEventListener("hashchange", selectRequestedNeed);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", selectRequestedNeed);
    };
  }, [busyNeedId, selectableIdsKey]);

  function selectNeed(id: string) {
    if (busyNeedId) return;

    setSelectedId(id);
    setUnavailableRequestedId("");
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("necesidad", id);
    nextUrl.hash = `necesidad-${encodeURIComponent(id)}`;
    const nextRelativeUrl = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    if (
      `${window.location.pathname}${window.location.search}${window.location.hash}` !==
      nextRelativeUrl
    ) {
      window.history.replaceState(window.history.state, "", nextRelativeUrl);
    }
  }

  return (
    <div
      className="space-y-4"
      role="group"
      aria-label="Selecciona una necesidad para aportar"
    >
      {unavailableRequestedId ? (
        <p
          className="rounded-md border border-[color:var(--warning)]/40 bg-amber-500/10 p-3 text-sm leading-6"
          role="alert"
        >
          La necesidad enlazada ya no admite aportaciones. Elige otra solicitud
          activa antes de confirmar ayuda.
        </p>
      ) : null}
      {options.map((option) => {
        const selected = option.id === selectedId;

        return (
          <div
            key={option.id}
            id={`necesidad-${option.id}`}
            className={`grid scroll-mt-4 gap-3 ${
              selected ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""
            }`}
          >
            <div className="space-y-3">
              {option.card}
              {option.action ? (
                <button
                  type="button"
                  aria-controls={contributionPanelId}
                  aria-expanded={selected}
                  aria-pressed={selected}
                  disabled={Boolean(busyNeedId)}
                  onClick={() => selectNeed(option.id)}
                  className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60 ${
                    selected
                      ? "border-[color:var(--success)]/40 bg-emerald-500/10 text-[color:var(--success)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  }`}
                >
                  {selected ? (
                    <Check size={16} aria-hidden />
                  ) : (
                    <HandHeart size={16} aria-hidden />
                  )}
                  {selected
                    ? "Necesidad seleccionada"
                    : "Elegir esta necesidad"}
                  <span className="sr-only">: {option.title}</span>
                </button>
              ) : null}
            </div>

            {selected && option.action ? (
              <div
                id={contributionPanelId}
                role="region"
                aria-label={`Aportación para ${option.title}`}
              >
                {option.action}
              </div>
            ) : null}
          </div>
        );
      })}
      {busyNeedId ? (
        <p className="text-sm text-black/65 dark:text-white/65" role="status">
          Registrando la aportación. Espera y no cambies de necesidad ni de
          página.
        </p>
      ) : null}
    </div>
  );
}
