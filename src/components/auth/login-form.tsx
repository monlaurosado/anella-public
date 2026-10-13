"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { LogIn } from "lucide-react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const formData = new FormData(event.currentTarget);
      const result = await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
        callbackUrl: "/coordinacion",
      });

      if (result?.ok) {
        window.location.assign(result.url ?? "/coordinacion");
        return;
      }

      setError("No se ha podido iniciar sesión con esos datos.");
    } catch {
      setError(
        "No se ha podido conectar. Comprueba tu conexión e inténtalo de nuevo.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5"
    >
      <h1 className="text-2xl font-semibold tracking-normal">
        Acceso coordinadores
      </h1>
      <p className="mt-2 text-sm leading-6 text-black/65 dark:text-white/65">
        Esta entrada quedará reservada a ayuntamientos, Protección Civil y
        coordinadores autorizados.
      </p>
      <div className="mt-5 grid gap-4">
        <label className="grid gap-1 text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
            placeholder="coordinador@municipio.es"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Contraseña
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
            placeholder="••••••••"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogIn size={16} aria-hidden />
        {pending ? "Entrando..." : "Entrar"}
      </button>
      {error ? (
        <p
          className="mt-3 text-sm text-[color:var(--danger)]"
          role="alert"
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
