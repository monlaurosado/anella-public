import type { Metadata } from "next";
import { BellRing } from "lucide-react";

import { closeIncidentNotice, publishIncidentNotice } from "@/actions/notices";
import { Badge } from "@/components/ui/badge";
import { getNoticeCoordinationData } from "@/services/incidents";

export const metadata: Metadata = { title: "Avisos · Coordinación" };

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{
    notice?: string;
    error?: string;
    incidentId?: string;
  }>;
}) {
  const [data, query] = await Promise.all([
    getNoticeCoordinationData(),
    searchParams,
  ]);
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-[color:var(--foreground)] text-[color:var(--background)]">
          <BellRing size={19} aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Avisos oficiales
          </h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Información pública no táctica emitida por una entidad verificada.
          </p>
        </div>
      </div>
      {query.notice ? (
        <p
          className="mt-4 rounded-md bg-emerald-500/10 p-3 text-sm"
          role="status"
        >
          {query.notice}
        </p>
      ) : null}
      {query.error ? (
        <p className="mt-4 rounded-md bg-red-500/10 p-3 text-sm" role="alert">
          {query.error}
        </p>
      ) : null}

      <section className="mt-6 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
        <h2 className="font-semibold">Publicar aviso</h2>
        <form action={publishIncidentNotice} className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs font-medium">
            Emergencia
            <select
              name="incidentId"
              required
              defaultValue={
                data.incidents.some(
                  (incident) => incident.id === query.incidentId,
                )
                  ? query.incidentId
                  : ""
              }
              className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
            >
              <option value="">Selecciona una emergencia activa</option>
              {data.incidents.map((incident) => (
                <option key={incident.id} value={incident.id}>
                  {incident.publicCode} · {incident.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Título
            <input
              name="title"
              required
              minLength={5}
              maxLength={191}
              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Contenido público
            <textarea
              name="body"
              required
              minLength={10}
              maxLength={4000}
              className="min-h-28 rounded-md border border-[color:var(--border)] bg-transparent p-3 text-sm"
              placeholder="Sin ubicaciones operativas, recursos desplegados ni datos personales."
            />
          </label>
          <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm leading-5">
            <input
              type="checkbox"
              name="confirmPublicNoticeSafety"
              required
              className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
            />
            He revisado que el aviso no contiene coordenadas operativas,
            posiciones de equipos, recursos desplegados ni datos personales.
          </label>
          <button className="h-11 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] sm:w-fit">
            Publicar aviso oficial
          </button>
        </form>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Historial</h2>
        {data.notices.map((notice) => (
          <article
            key={notice.id}
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={notice.status === "published" ? "info" : "neutral"}>
                {notice.status === "published"
                  ? "Publicado"
                  : notice.status === "closed"
                    ? "Cerrado"
                    : "Borrador"}
              </Badge>
              <span className="text-xs text-black/60 dark:text-white/60">
                {notice.incident.publicCode} · {notice.organization.name}
              </span>
            </div>
            <h3 className="mt-3 font-semibold">{notice.title}</h3>
            <p className="mt-2 text-sm leading-6">{notice.body}</p>
            {notice.status === "published" ? (
              <form action={closeIncidentNotice} className="mt-3">
                <input type="hidden" name="noticeId" value={notice.id} />
                <button className="min-h-11 text-sm font-semibold underline">
                  Cerrar aviso
                </button>
              </form>
            ) : null}
          </article>
        ))}
        {data.notices.length === 0 ? (
          <p className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
            No hay avisos publicados todavía.
          </p>
        ) : null}
      </section>
    </main>
  );
}
