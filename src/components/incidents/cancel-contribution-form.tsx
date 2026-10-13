"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  LoaderCircle,
  RotateCcw,
  XCircle,
} from "lucide-react";

type AccessPhase = "checking" | "missing" | "error";
type CopyPhase = "idle" | "loading" | "copied" | "fallback" | "error";

function readFragmentToken() {
  const fragment = window.location.hash.slice(1);

  if (!fragment) {
    return null;
  }

  const token = new URLSearchParams(fragment).get("token");
  return token && token.length >= 32 && token.length <= 128 ? token : null;
}

export function ContributionAccessBootstrap({
  publicCode,
  hasAccess,
}: {
  publicCode: string;
  hasAccess: boolean;
}) {
  const tokenRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<AccessPhase>("checking");

  useEffect(() => {
    const cleanPath = window.location.pathname;
    let controller: AbortController | null = null;

    function exchangeToken(token: string | null) {
      controller?.abort();
      if (hasAccess) return;
      if (!token) {
        setPhase("missing");
        return;
      }

      const requestController = new AbortController();
      controller = requestController;
      setPhase("checking");

      void fetch(
        `/api/contributions/${encodeURIComponent(publicCode)}/access`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          signal: requestController.signal,
        },
      )
        .then((response) => {
          if (!response.ok) {
            throw new Error("access-denied");
          }

          window.location.replace(cleanPath);
        })
        .catch((error: unknown) => {
          if (
            !requestController.signal.aborted &&
            (!(error instanceof DOMException) || error.name !== "AbortError")
          ) {
            setPhase("error");
          }
        });
    }

    function captureFragment() {
      tokenRef.current = readFragmentToken();
      if (window.location.hash || window.location.search) {
        window.history.replaceState(null, "", cleanPath);
      }
      exchangeToken(tokenRef.current);
    }

    if (window.location.hash || window.location.search) {
      captureFragment();
    } else {
      exchangeToken(tokenRef.current);
    }
    window.addEventListener("hashchange", captureFragment);

    return () => {
      controller?.abort();
      window.removeEventListener("hashchange", captureFragment);
    };
  }, [attempt, hasAccess, publicCode]);

  if (hasAccess) {
    return null;
  }

  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
      {phase === "checking" ? (
        <LoaderCircle className="animate-spin" size={24} aria-hidden />
      ) : (
        <KeyRound size={24} aria-hidden />
      )}
      <h1 className="mt-4 text-2xl font-semibold tracking-normal">
        Acceso privado a tu aportación
      </h1>
      <p
        className="mt-3 text-sm leading-6 text-black/65 dark:text-white/65"
        role={phase === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {phase === "checking"
          ? "Verificando el enlace privado…"
          : phase === "missing"
            ? "Abre el enlace privado original que recibiste al confirmar la aportación. El código por sí solo no permite acceder."
            : "No hemos podido verificar el enlace. Puede haber caducado o existir un problema de conexión."}
      </p>
      {phase === "error" ? (
        <button
          type="button"
          onClick={() => setAttempt((current) => current + 1)}
          className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold"
        >
          <RotateCcw size={16} aria-hidden />
          Reintentar
        </button>
      ) : null}
    </section>
  );
}

export function CopyPrivateContributionLink({
  publicCode,
}: {
  publicCode: string;
}) {
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const [fallbackLink, setFallbackLink] = useState("");

  async function copyPrivateLink() {
    setPhase("loading");
    setFallbackLink("");

    try {
      const response = await fetch(
        `/api/contributions/${encodeURIComponent(publicCode)}/private-link`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
        },
      );
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("privateLink" in payload) ||
        typeof payload.privateLink !== "string"
      ) {
        throw new Error("private-link-unavailable");
      }

      const privateUrl = new URL(payload.privateLink, window.location.origin);
      const token = new URLSearchParams(privateUrl.hash.slice(1)).get("token");
      if (
        privateUrl.origin !== window.location.origin ||
        privateUrl.pathname !==
          `/aportaciones/${encodeURIComponent(publicCode)}` ||
        privateUrl.search !== "" ||
        !token ||
        token.length < 32 ||
        token.length > 128
      ) {
        throw new Error("private-link-invalid");
      }

      const privateLink = privateUrl.toString();
      if (!navigator.clipboard?.writeText) {
        setFallbackLink(privateLink);
        setPhase("fallback");
        return;
      }

      try {
        await navigator.clipboard.writeText(privateLink);
        setPhase("copied");
      } catch {
        setFallbackLink(privateLink);
        setPhase("fallback");
      }
    } catch {
      setPhase("error");
    }
  }

  return (
    <section className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
      <Copy size={18} aria-hidden />
      <h2 className="mt-2 text-sm font-semibold">Guarda tu enlace privado</h2>
      <p className="mt-2 text-xs leading-5 text-black/65 dark:text-white/65">
        El código por sí solo no permite entrar. Copia este enlace para volver
        desde otro dispositivo; tiene una validez máxima de 30 días y no debes
        compartirlo.
      </p>
      <button
        type="button"
        onClick={copyPrivateLink}
        disabled={phase === "loading"}
        className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold disabled:cursor-wait disabled:opacity-60"
      >
        {phase === "loading" ? (
          <LoaderCircle className="animate-spin" size={16} aria-hidden />
        ) : phase === "copied" ? (
          <CheckCircle2 size={16} aria-hidden />
        ) : (
          <Copy size={16} aria-hidden />
        )}
        {phase === "loading"
          ? "Preparando enlace…"
          : phase === "copied"
            ? "Enlace copiado"
            : "Copiar enlace privado"}
      </button>

      {phase === "copied" ? (
        <p className="mt-2 text-xs text-[color:var(--success)]" role="status">
          Enlace copiado. Guárdalo en un lugar seguro.
        </p>
      ) : phase === "fallback" ? (
        <div className="mt-3">
          <label className="grid gap-1 text-xs font-medium">
            Selecciona y copia el enlace privado
            <input
              value={fallbackLink}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 min-w-0 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
            />
          </label>
          <p className="mt-2 text-xs leading-5" role="status">
            Tu navegador no ha permitido copiarlo automáticamente.
          </p>
        </div>
      ) : phase === "error" ? (
        <p className="mt-2 text-xs text-[color:var(--danger)]" role="alert">
          No hemos podido preparar el enlace. Revisa la conexión e inténtalo de
          nuevo.
        </p>
      ) : null}
    </section>
  );
}

export function CancelContributionForm({ publicCode }: { publicCode: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function cancelContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const statusPath = `/aportaciones/${encodeURIComponent(publicCode)}`;
      const response = await fetch(
        `/api/contributions/${encodeURIComponent(publicCode)}/cancel`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ confirmed: true }),
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
        },
      );

      if (!response.ok) {
        throw new Error("cancel-failed");
      }

      window.location.replace(statusPath);
    } catch {
      setPending(false);
      setError(
        "No hemos podido cancelar la aportación. Revisa la conexión e inténtalo de nuevo.",
      );
    }
  }

  return (
    <details className="rounded-md border border-[color:var(--danger)]/40 p-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-[color:var(--danger)]">
        Cancelar aportación
      </summary>
      <form onSubmit={cancelContribution} className="mt-2">
        <p className="text-sm leading-6">
          El equipo dejará de contar con esta entrega. No podrás deshacerlo
          desde este enlace.
        </p>
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input name="confirmed" type="checkbox" required className="size-5" />
          Confirmo que no podré realizar la entrega.
        </label>
        <button
          type="submit"
          disabled={pending}
          className="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[color:var(--danger)] px-3 text-sm font-semibold text-white dark:text-[#171713]"
        >
          <XCircle size={16} aria-hidden />
          {pending ? "Cancelando…" : "Confirmar cancelación"}
        </button>
        {error ? (
          <p className="mt-3 text-sm text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
