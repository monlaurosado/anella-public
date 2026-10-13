import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Search,
  UserPlus,
  Users,
} from "lucide-react";

import {
  createCoordinator,
  resetCoordinatorPassword,
  setCoordinatorStatus,
} from "@/actions/users";
import {
  copySearchParams,
  type RawSearchParams,
} from "@/components/coordination/queue-query";
import { getOperationalTimeZone } from "@/config/env";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import { canonicalPaginationHref } from "@/lib/pagination-canonical";
import { readSignedFlash } from "@/lib/signed-flash";
import {
  getMunicipalityDirectory,
  getOrganizationDirectory,
  getTeam,
} from "@/services/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Equipo · Coordinación" };

const roleLabels = {
  CITIZEN: "Ciudadanía",
  COORDINATOR: "Coordinación",
  MUNICIPAL_ADMIN: "Administración municipal",
  SUPER_ADMIN: "Administración global",
} as const;
const pageSizes = new Set([10, 25, 50, 100]);
const maximumUrlPage = 999_999;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function textValue(value: string | string[] | undefined) {
  return (first(value) ?? "").trim().slice(0, 160);
}

function idValue(value: string | string[] | undefined) {
  const id = (first(value) ?? "").trim();
  return id && id.length <= 191 ? id : undefined;
}

function pageValue(value: string | string[] | undefined) {
  const raw = first(value) ?? "";
  if (!/^[1-9]\d{0,5}$/.test(raw)) return 1;
  const parsed = Number(raw);
  return parsed <= maximumUrlPage ? parsed : 1;
}

function pageSizeValue(value: string | string[] | undefined) {
  const parsed = Number(first(value));
  return pageSizes.has(parsed) ? parsed : 25;
}

function withoutGlobalTenantParams(query: RawSearchParams) {
  const blocked = new Set([
    "municipalityId",
    "municipalityQuery",
    "municipalityPage",
    "organizationId",
    "organizationQuery",
    "organizationPage",
  ]);
  return Object.fromEntries(
    Object.entries(query).filter(([key]) => !blocked.has(key)),
  ) as RawSearchParams;
}

function teamHref(
  query: RawSearchParams,
  updates: Record<string, string | null>,
  remove: string[] = [],
) {
  const params = copySearchParams(query);
  for (const key of remove) params.delete(key);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const serialized = params.toString();
  return serialized
    ? `/coordinacion/equipo?${serialized}`
    : "/coordinacion/equipo";
}

function PreservedQueryFields({
  query,
  omit,
}: {
  query: RawSearchParams;
  omit: string[];
}) {
  const params = copySearchParams(query);
  for (const key of omit) params.delete(key);
  return [...params.entries()].map(([name, value], index) => (
    <input
      key={`${name}-${value}-${index}`}
      type="hidden"
      name={name}
      value={value}
    />
  ));
}

function TeamPagination({
  query,
  pageParam,
  page,
  pageCount,
  pageSize,
  total,
  label,
}: {
  query: RawSearchParams;
  pageParam: string;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  label: string;
}) {
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(total, page * pageSize);
  const controlClass =
    "inline-flex min-h-11 items-center justify-center rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold";

  return (
    <nav
      aria-label={label}
      className="mt-4 flex flex-col gap-3 border-t border-[color:var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p
        className="text-sm text-black/60 dark:text-white/60"
        aria-live="polite"
      >
        {firstItem.toLocaleString("es-ES")}–{lastItem.toLocaleString("es-ES")}{" "}
        de {total.toLocaleString("es-ES")}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={teamHref(query, { [pageParam]: String(page - 1) })}
            className={controlClass}
            aria-label="Página anterior"
          >
            <ChevronLeft size={16} aria-hidden />
          </Link>
        ) : (
          <span className={`${controlClass} opacity-40`} aria-disabled="true">
            <ChevronLeft size={16} aria-hidden />
          </span>
        )}
        <span className="text-sm font-medium">
          Página {page.toLocaleString("es-ES")} de{" "}
          {pageCount.toLocaleString("es-ES")}
        </span>
        {page < pageCount ? (
          <Link
            href={teamHref(query, { [pageParam]: String(page + 1) })}
            className={controlClass}
            aria-label="Página siguiente"
          >
            <ChevronRight size={16} aria-hidden />
          </Link>
        ) : (
          <span className={`${controlClass} opacity-40`} aria-disabled="true">
            <ChevronRight size={16} aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = await searchParams;
  const state = {
    query: textValue(query.q),
    page: pageValue(query.page),
    pageSize: pageSizeValue(query.pageSize),
    municipalityId: idValue(query.municipalityId),
    municipalityQuery: textValue(query.municipalityQuery),
    municipalityPage: pageValue(query.municipalityPage),
    organizationId: idValue(query.organizationId),
    organizationQuery: textValue(query.organizationQuery),
    organizationPage: pageValue(query.organizationPage),
  };
  const team = await getTeam({
    query: state.query,
    page: state.page,
    pageSize: state.pageSize,
    municipalityId: state.municipalityId,
  });
  const isSuperAdmin = team.coordinator.role === "SUPER_ADMIN";
  const navigationQuery = isSuperAdmin
    ? query
    : withoutGlobalTenantParams(query);
  const [municipalityDirectory, organizationDirectory] = isSuperAdmin
    ? await Promise.all([
        getMunicipalityDirectory({
          query: state.municipalityQuery,
          page: state.municipalityPage,
          pageSize: 10,
        }),
        team.selectedMunicipality
          ? getOrganizationDirectory({
              municipalityId: team.selectedMunicipality.id,
              query: state.organizationQuery,
              page: state.organizationPage,
              pageSize: 10,
              selectedOrganizationId: state.organizationId,
            })
          : Promise.resolve(null),
      ])
    : [null, null];
  const canonicalPath = canonicalPaginationHref(
    "/coordinacion/equipo",
    copySearchParams(navigationQuery),
    [
      {
        parameter: "page",
        requestedPage: state.page,
        pageCount: team.pagination.pageCount,
      },
      ...(municipalityDirectory
        ? [
            {
              parameter: "municipalityPage",
              requestedPage: state.municipalityPage,
              pageCount: municipalityDirectory.pagination.pageCount,
            },
          ]
        : []),
      ...(organizationDirectory
        ? [
            {
              parameter: "organizationPage",
              requestedPage: state.organizationPage,
              pageCount: organizationDirectory.pagination.pageCount,
            },
          ]
        : []),
    ],
  );
  if (canonicalPath) redirect(canonicalPath);
  const flash = readSignedFlash(query, "/coordinacion/equipo");
  const operationalTimeZone = getOperationalTimeZone();
  const returnPath = teamHref(navigationQuery, {
    page: String(team.pagination.page),
    pageSize: String(team.pagination.pageSize),
  });

  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <Link
            href="/coordinacion"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-black/60 dark:text-white/60"
          >
            <ArrowLeft size={16} aria-hidden />
            Centro de operaciones
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <Users size={20} aria-hidden />
            <h1 className="text-2xl font-semibold tracking-normal">Equipo</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        {flash.notice ? (
          <p
            className="rounded-md border border-[color:var(--success)]/35 bg-[color:var(--surface)] p-3 text-sm text-[color:var(--success)]"
            role="status"
          >
            {flash.notice}
          </p>
        ) : null}
        {flash.error ? (
          <p
            className="rounded-md border border-[color:var(--danger)]/35 bg-[color:var(--surface)] p-3 text-sm text-[color:var(--danger)]"
            role="alert"
          >
            {flash.error}
          </p>
        ) : null}

        {isSuperAdmin && municipalityDirectory ? (
          <section
            aria-labelledby="tenant-directory-title"
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
          >
            <div className="flex items-center gap-2">
              <Building2 size={17} aria-hidden />
              <h2 id="tenant-directory-title" className="text-sm font-semibold">
                Municipio de gestión
              </h2>
            </div>
            <p className="mt-2 text-sm text-black/65 dark:text-white/65">
              Selecciona un municipio antes de consultar cuentas. Hasta entonces
              no se carga ni serializa información personal del equipo.
            </p>
            {team.selectedMunicipality ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[color:var(--success)]/40 p-3 text-sm">
                <strong>{team.selectedMunicipality.name}</strong>
                <span className="text-black/60 dark:text-white/60">
                  {[
                    team.selectedMunicipality.province,
                    team.selectedMunicipality.region,
                  ]
                    .filter(Boolean)
                    .join(" · ") || team.selectedMunicipality.country}
                </span>
                <Link
                  href={teamHref(
                    navigationQuery,
                    { municipalityId: null, page: "1" },
                    ["organizationId", "organizationQuery", "organizationPage"],
                  )}
                  className="ml-auto inline-flex min-h-11 items-center font-semibold underline"
                >
                  Cambiar selección
                </Link>
              </div>
            ) : null}
            {team.municipalitySelectionInvalid ? (
              <p
                className="mt-3 text-sm text-[color:var(--danger)]"
                role="alert"
              >
                El municipio indicado en la URL no existe. Selecciona uno del
                directorio.
              </p>
            ) : null}

            <form
              method="get"
              role="search"
              aria-label="Buscar municipios"
              className="mt-4 flex flex-col gap-2 sm:flex-row"
            >
              <PreservedQueryFields
                query={navigationQuery}
                omit={["municipalityQuery", "municipalityPage"]}
              />
              <label className="grid flex-1 gap-1 text-sm font-medium">
                Buscar municipio
                <input
                  name="municipalityQuery"
                  defaultValue={municipalityDirectory.filters.query}
                  maxLength={160}
                  className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
                />
              </label>
              <button
                type="submit"
                className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold transition hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.04]"
              >
                <Search size={15} aria-hidden /> Buscar
              </button>
            </form>

            <ul className="mt-4 grid gap-2 md:grid-cols-2">
              {municipalityDirectory.municipalities.map((municipality) => {
                const selected =
                  municipality.id === team.selectedMunicipality?.id;
                return (
                  <li
                    key={municipality.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] p-3"
                  >
                    <span className="min-w-0 text-sm">
                      <strong className="block truncate">
                        {municipality.name}
                      </strong>
                      <span className="text-black/60 dark:text-white/60">
                        {[municipality.province, municipality.region]
                          .filter(Boolean)
                          .join(" · ") || municipality.country}
                      </span>
                    </span>
                    {selected ? (
                      <span className="text-xs font-semibold text-[color:var(--success)]">
                        Seleccionado
                      </span>
                    ) : (
                      <Link
                        href={teamHref(
                          navigationQuery,
                          { municipalityId: municipality.id, page: "1" },
                          [
                            "organizationId",
                            "organizationQuery",
                            "organizationPage",
                          ],
                        )}
                        prefetch={false}
                        className="inline-flex min-h-11 items-center font-semibold underline"
                      >
                        Seleccionar
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            {municipalityDirectory.pagination.total === 0 ? (
              <p className="mt-4 text-sm text-black/65 dark:text-white/65">
                No hay municipios que coincidan con la búsqueda.
              </p>
            ) : null}
            <TeamPagination
              query={navigationQuery}
              pageParam="municipalityPage"
              label="Paginación del directorio de municipios"
              {...municipalityDirectory.pagination}
            />

            {team.selectedMunicipality && organizationDirectory ? (
              <div className="mt-6 border-t border-[color:var(--border)] pt-5">
                <h3 className="text-sm font-semibold">
                  Organización de la nueva cuenta (opcional)
                </h3>
                <p className="mt-1 text-sm text-black/65 dark:text-white/65">
                  La organización seleccionada solo se aplicará a la próxima
                  cuenta que crees en {team.selectedMunicipality.name}.
                </p>
                {organizationDirectory.selectedOrganization ? (
                  <p className="mt-3 rounded-md border border-[color:var(--success)]/40 p-3 text-sm">
                    Organización seleccionada:{" "}
                    <strong>
                      {organizationDirectory.selectedOrganization.name}
                    </strong>
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-black/65 dark:text-white/65">
                    La nueva cuenta se creará sin organización específica.
                  </p>
                )}
                {organizationDirectory.organizationSelectionInvalid ? (
                  <p
                    className="mt-2 text-sm text-[color:var(--danger)]"
                    role="alert"
                  >
                    La organización indicada no pertenece al municipio y no se
                    aplicará.
                  </p>
                ) : null}
                <form
                  method="get"
                  role="search"
                  aria-label="Buscar organizaciones"
                  className="mt-4 flex flex-col gap-2 sm:flex-row"
                >
                  <PreservedQueryFields
                    query={navigationQuery}
                    omit={["organizationQuery", "organizationPage"]}
                  />
                  <label className="grid flex-1 gap-1 text-sm font-medium">
                    Buscar organización
                    <input
                      name="organizationQuery"
                      defaultValue={organizationDirectory.filters.query}
                      maxLength={160}
                      className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
                    />
                  </label>
                  <button
                    type="submit"
                    className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold"
                  >
                    <Search size={15} aria-hidden /> Buscar
                  </button>
                </form>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {organizationDirectory.organizations.map((organization) => {
                    const selected =
                      organization.id ===
                      organizationDirectory.selectedOrganization?.id;
                    return (
                      <li
                        key={organization.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] p-3 text-sm"
                      >
                        <span>
                          <strong className="block">{organization.name}</strong>
                          <span className="text-xs text-black/60 dark:text-white/60">
                            {organization.kind}
                          </span>
                        </span>
                        {selected ? (
                          <span className="text-xs font-semibold text-[color:var(--success)]">
                            Seleccionada
                          </span>
                        ) : (
                          <Link
                            href={teamHref(navigationQuery, {
                              organizationId: organization.id,
                            })}
                            className="inline-flex min-h-11 items-center font-semibold underline"
                          >
                            Seleccionar
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Link
                  href={teamHref(navigationQuery, { organizationId: null })}
                  className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline"
                >
                  Crear sin organización
                </Link>
                <TeamPagination
                  query={navigationQuery}
                  pageParam="organizationPage"
                  label="Paginación del directorio de organizaciones"
                  {...organizationDirectory.pagination}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="new-account-title">
          <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
            <summary className="min-h-12 cursor-pointer list-none px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2">
              <h2
                id="new-account-title"
                className="flex items-center gap-3 text-left"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[color:var(--surface-muted)]">
                  <UserPlus size={17} aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold">
                    Nueva cuenta
                  </span>
                  <span className="mt-0.5 block text-xs font-normal leading-5 text-black/60 dark:text-white/60">
                    Abre el formulario solo cuando vayas a dar un alta.
                  </span>
                </span>
              </h2>
            </summary>
            {isSuperAdmin && !team.selectedMunicipality ? (
              <p className="border-t border-[color:var(--border)] p-4 text-sm text-black/65 dark:text-white/65">
                Selecciona primero un municipio válido en el directorio. La
                administración global nunca hereda un tenant implícito.
              </p>
            ) : (
              <form
                action={createCoordinator}
                className="grid gap-3 border-t border-[color:var(--border)] p-4 md:grid-cols-2"
              >
                <input type="hidden" name="returnTo" value={returnPath} />
                {isSuperAdmin && team.selectedMunicipality ? (
                  <>
                    <input
                      type="hidden"
                      name="municipalityId"
                      value={team.selectedMunicipality.id}
                    />
                    {organizationDirectory?.selectedOrganization ? (
                      <input
                        type="hidden"
                        name="organizationId"
                        value={organizationDirectory.selectedOrganization.id}
                      />
                    ) : null}
                    <p className="rounded-md border border-[color:var(--border)] p-3 text-sm md:col-span-2">
                      Tenant de la nueva cuenta:{" "}
                      <strong>{team.selectedMunicipality.name}</strong>
                      {organizationDirectory?.selectedOrganization
                        ? ` · ${organizationDirectory.selectedOrganization.name}`
                        : " · sin organización específica"}
                    </p>
                  </>
                ) : null}
                <label className="grid gap-1 text-sm font-medium">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Email
                  <input
                    name="email"
                    type="email"
                    required
                    className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Teléfono
                  <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Rol
                  <select
                    name="role"
                    defaultValue="COORDINATOR"
                    className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                  >
                    <option value="COORDINATOR">Coordinador</option>
                    <option value="MUNICIPAL_ADMIN">
                      Administrador municipal
                    </option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium md:col-span-2">
                  Contraseña temporal
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                    aria-describedby="team-password-policy"
                    autoComplete="new-password"
                    className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
                  />
                </label>
                <p
                  id="team-password-policy"
                  className="text-xs leading-5 text-black/65 dark:text-white/65 md:col-span-2"
                >
                  Mínimo 12 caracteres y máximo 72 bytes en UTF-8. La persona
                  deberá cambiarla en su primer acceso.
                </p>
                <label className="grid gap-1 text-sm font-medium md:col-span-2">
                  Confirma tu contraseña actual
                  <input
                    name="currentPassword"
                    type="password"
                    required
                    autoComplete="current-password"
                    className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
                  />
                </label>
                <p className="text-xs leading-5 text-black/65 dark:text-white/65 md:col-span-2">
                  Verificación adicional de la persona administradora antes de
                  crear la cuenta.
                </p>
                <button
                  type="submit"
                  className="min-h-11 w-fit rounded-md bg-[color:var(--foreground)] px-3 text-sm font-semibold text-[color:var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Crear cuenta
                </button>
              </form>
            )}
          </details>
        </section>

        <section aria-labelledby="team-list-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="team-list-title" className="text-lg font-semibold">
                Cuentas ({team.pagination.total.toLocaleString("es-ES")})
              </h2>
              {team.selectedMunicipality ? (
                <p className="text-sm text-black/60 dark:text-white/60">
                  Municipio: {team.selectedMunicipality.name}
                </p>
              ) : null}
            </div>
          </div>

          {team.selectedMunicipality ? (
            <form
              method="get"
              role="search"
              aria-label="Buscar cuentas del equipo"
              className="mt-3 grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <PreservedQueryFields
                query={navigationQuery}
                omit={["q", "page", "pageSize"]}
              />
              <label className="grid gap-1 text-sm font-medium">
                Nombre, email, teléfono u organización
                <input
                  name="q"
                  defaultValue={team.filters.query}
                  maxLength={160}
                  className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Por página
                <select
                  name="pageSize"
                  defaultValue={String(team.pagination.pageSize)}
                  className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                >
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="mt-auto min-h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold transition hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.04]"
              >
                Aplicar filtros
              </button>
            </form>
          ) : (
            <p className="mt-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm text-black/65 dark:text-white/65">
              Selecciona un municipio para consultar las cuentas. No se ha
              cargado PII global.
            </p>
          )}

          <div className="mt-3 space-y-3">
            {team.users.map((user) => (
              <article
                key={user.id}
                aria-labelledby={`team-user-${user.id}`}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
              >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id={`team-user-${user.id}`} className="font-semibold">
                        {user.name ?? user.email}
                        <span className="sr-only">, cuenta {user.email}</span>
                      </h3>
                      <span className="text-xs font-semibold text-black/65 dark:text-white/65">
                        {roleLabels[user.role]}
                      </span>
                      <span
                        className={`text-xs font-semibold ${user.isActive ? "text-[color:var(--success)]" : "text-[color:var(--danger)]"}`}
                      >
                        {user.isActive ? "Activa" : "Inactiva"}
                      </span>
                      {user.mustChangePassword ? (
                        <span className="text-xs font-semibold text-[color:var(--warning)]">
                          Clave temporal
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                      {user.email}
                      {user.phone ? ` · ${user.phone}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-black/65 dark:text-white/65">
                      {user.municipalityName}
                      {user.organizationName
                        ? ` · ${user.organizationName}`
                        : ""}
                    </p>
                    <p className="mt-2 text-xs text-black/65 dark:text-white/65">
                      Último acceso:{" "}
                      {user.lastLoginAt
                        ? formatDateTimeInTimeZone(
                            user.lastLoginAt,
                            operationalTimeZone,
                          )
                        : "Nunca"}
                    </p>
                  </div>
                  {user.id !== team.coordinator.id ? (
                    <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                      <details className="w-full max-w-md rounded-md border border-[color:var(--border)] p-3">
                        <summary
                          aria-label={`Restablecer credenciales de ${user.name ?? user.email}, ${user.email}`}
                          className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold"
                        >
                          <KeyRound size={14} aria-hidden /> Restablecer
                          credenciales
                        </summary>
                        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
                          Esta acción cerrará todas sus sesiones y exigirá
                          cambiar la clave temporal en el siguiente acceso.
                        </p>
                        <form
                          action={resetCoordinatorPassword}
                          aria-label={`Restablecer credenciales de ${user.name ?? user.email}, ${user.email}`}
                          className="mt-3 grid gap-3"
                        >
                          <input
                            type="hidden"
                            name="returnTo"
                            value={returnPath}
                          />
                          <input type="hidden" name="userId" value={user.id} />
                          <label className="grid gap-1 text-sm font-medium">
                            Nueva contraseña temporal
                            <span className="sr-only">
                              {" "}
                              de {user.name ?? user.email}, {user.email}
                            </span>
                            <input
                              name="password"
                              type="password"
                              minLength={12}
                              required
                              aria-describedby={`reset-password-policy-${user.id}`}
                              autoComplete="new-password"
                              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
                            />
                          </label>
                          <p
                            id={`reset-password-policy-${user.id}`}
                            className="text-xs leading-5 text-black/65 dark:text-white/65"
                          >
                            Mínimo 12 caracteres y máximo 72 bytes en UTF-8.
                          </p>
                          <label className="grid gap-1 text-sm font-medium">
                            Confirma tu contraseña actual
                            <span className="sr-only">
                              {" "}
                              para restablecer la cuenta de{" "}
                              {user.name ?? user.email}, {user.email}
                            </span>
                            <input
                              name="currentPassword"
                              type="password"
                              required
                              autoComplete="current-password"
                              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-medium">
                            Motivo del restablecimiento
                            <span className="sr-only">
                              {" "}
                              de credenciales de {user.name ?? user.email},{" "}
                              {user.email}
                            </span>
                            <textarea
                              name="reason"
                              minLength={8}
                              maxLength={500}
                              required
                              className="min-h-20 rounded-md border border-[color:var(--border)] bg-transparent p-3 text-sm"
                              placeholder="Describe la solicitud o incidencia verificada"
                            />
                          </label>
                          <label className="flex min-h-11 items-start gap-2 text-sm">
                            <input
                              name="confirmSensitiveAction"
                              value="confirmed"
                              type="checkbox"
                              required
                              className="mt-1 size-4 shrink-0"
                            />
                            <span>
                              Confirmo que he verificado la identidad o la
                              solicitud y que revocaré todas sus sesiones.
                              <span className="sr-only">
                                {" "}
                                Cuenta de {user.name ?? user.email},{" "}
                                {user.email}.
                              </span>
                            </span>
                          </label>
                          <button
                            type="submit"
                            aria-label={`Restablecer credenciales de ${user.name ?? user.email}, ${user.email}`}
                            className="min-h-11 w-fit rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold transition hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.04]"
                          >
                            Restablecer credenciales
                          </button>
                        </form>
                      </details>
                      <details className="w-full max-w-md rounded-md border border-[color:var(--border)] p-3">
                        <summary
                          aria-label={`${user.isActive ? "Desactivar cuenta" : "Activar cuenta"} de ${user.name ?? user.email}, ${user.email}`}
                          className="flex min-h-11 cursor-pointer items-center text-sm font-semibold"
                        >
                          {user.isActive
                            ? "Desactivar cuenta"
                            : "Activar cuenta"}
                        </summary>
                        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
                          {user.isActive
                            ? "La cuenta perderá acceso inmediatamente y se cerrarán todas sus sesiones."
                            : "La cuenta recuperará el acceso; sus sesiones anteriores seguirán revocadas."}
                        </p>
                        <form
                          action={setCoordinatorStatus}
                          aria-label={`${user.isActive ? "Desactivar" : "Activar"} la cuenta de ${user.name ?? user.email}, ${user.email}`}
                          className="mt-3 grid gap-3"
                        >
                          <input
                            type="hidden"
                            name="returnTo"
                            value={returnPath}
                          />
                          <input type="hidden" name="userId" value={user.id} />
                          <input
                            type="hidden"
                            name="statusAction"
                            value={user.isActive ? "deactivate" : "activate"}
                          />
                          <label className="grid gap-1 text-sm font-medium">
                            Confirma tu contraseña actual
                            <span className="sr-only">
                              {" "}
                              para cambiar el acceso de{" "}
                              {user.name ?? user.email}, {user.email}
                            </span>
                            <input
                              name="currentPassword"
                              type="password"
                              required
                              autoComplete="current-password"
                              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-medium">
                            Motivo del cambio de acceso
                            <span className="sr-only">
                              {" "}
                              de {user.name ?? user.email}, {user.email}
                            </span>
                            <textarea
                              name="reason"
                              minLength={8}
                              maxLength={500}
                              required
                              className="min-h-20 rounded-md border border-[color:var(--border)] bg-transparent p-3 text-sm"
                              placeholder="Describe la decisión autorizada"
                            />
                          </label>
                          <label className="flex min-h-11 items-start gap-2 text-sm">
                            <input
                              name="confirmSensitiveAction"
                              value="confirmed"
                              type="checkbox"
                              required
                              className="mt-1 size-4 shrink-0"
                            />
                            <span>
                              Confirmo que he comprobado la cuenta y autorizo
                              este cambio de acceso.
                              <span className="sr-only">
                                {" "}
                                Cuenta de {user.name ?? user.email},{" "}
                                {user.email}.
                              </span>
                            </span>
                          </label>
                          <button
                            type="submit"
                            aria-label={`${user.isActive ? "Desactivar y revocar sesiones de" : "Activar cuenta de"} ${user.name ?? user.email}, ${user.email}`}
                            className={`min-h-11 w-fit rounded-md border bg-[color:var(--surface)] px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${user.isActive ? "border-[color:var(--danger)] text-[color:var(--danger)]" : "border-[color:var(--success)] text-[color:var(--success)]"}`}
                          >
                            {user.isActive
                              ? "Desactivar y revocar sesiones"
                              : "Activar cuenta"}
                          </button>
                        </form>
                      </details>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {team.selectedMunicipality && team.users.length === 0 ? (
            <p className="mt-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm text-black/65 dark:text-white/65">
              No hay cuentas que coincidan con los filtros.
            </p>
          ) : null}
          {team.selectedMunicipality ? (
            <TeamPagination
              query={navigationQuery}
              pageParam="page"
              label="Paginación de cuentas del equipo"
              {...team.pagination}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}
