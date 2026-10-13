"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Building2,
  ClipboardList,
  HandHeart,
  MapPinned,
  BellRing,
  Menu,
  RadioTower,
  ShieldCheck,
  Users,
  UserRound,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { CoordinatorSummary } from "@/types/domain";

type NavigationItem = {
  label: string;
  shortLabel?: string;
  href: string;
  path: string;
  icon: typeof ClipboardList;
  exactView?: string;
};

const primaryItems: NavigationItem[] = [
  {
    label: "Emergencias",
    href: "/coordinacion/incidentes?view=active",
    path: "/coordinacion/incidentes",
    icon: ClipboardList,
  },
  {
    label: "Puntos de entrega",
    shortLabel: "Puntos",
    href: "/coordinacion/puntos-entrega",
    path: "/coordinacion/puntos-entrega",
    icon: MapPinned,
  },
  {
    label: "Aportaciones",
    shortLabel: "Entregas",
    href: "/coordinacion/aportaciones?view=open",
    path: "/coordinacion/aportaciones",
    icon: HandHeart,
  },
  {
    label: "Avisos",
    href: "/coordinacion/avisos",
    path: "/coordinacion/avisos",
    icon: BellRing,
  },
];

const utilityItems: NavigationItem[] = [
  {
    label: "Organización",
    href: "/coordinacion/organizaciones",
    path: "/coordinacion/organizaciones",
    icon: Building2,
  },
  {
    label: "Radar externo",
    shortLabel: "Radar",
    href: "/coordinacion/detecciones",
    path: "/coordinacion/detecciones",
    icon: RadioTower,
  },
  {
    label: "Mi cuenta",
    shortLabel: "Cuenta",
    href: "/coordinacion/cuenta",
    path: "/coordinacion/cuenta",
    icon: UserRound,
  },
];

const teamItem: NavigationItem = {
  label: "Equipo y permisos",
  shortLabel: "Equipo",
  href: "/coordinacion/equipo",
  path: "/coordinacion/equipo",
  icon: Users,
};

function isItemActive(pathname: string, itemPath: string) {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

function DesktopLink({
  item,
  pathname,
}: {
  item: NavigationItem;
  pathname: string;
}) {
  const Icon = item.icon;
  const active = isItemActive(pathname, item.path);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2",
        active
          ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
          : "text-black/65 hover:bg-black/[0.04] dark:text-white/65 dark:hover:bg-white/[0.06]",
      )}
    >
      <Icon size={18} aria-hidden />
      {item.label}
    </Link>
  );
}

export function CoordinationNavigation({
  passwordChangeRequired = false,
  role,
}: {
  passwordChangeRequired?: boolean;
  role: CoordinatorSummary["role"];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const accountItem = utilityItems.find(
    (item) => item.path === "/coordinacion/cuenta",
  )!;
  const visiblePrimaryItems = passwordChangeRequired ? [] : primaryItems;
  const roleUtilityItems =
    role === "SUPER_ADMIN" || role === "MUNICIPAL_ADMIN"
      ? [teamItem, ...utilityItems]
      : utilityItems;
  const visibleUtilityItems = passwordChangeRequired
    ? [accountItem]
    : roleUtilityItems;
  const mobileSecondaryItems = passwordChangeRequired
    ? visibleUtilityItems
    : [primaryItems[3], ...visibleUtilityItems];
  const mobileItems: NavigationItem[] = passwordChangeRequired
    ? [accountItem]
    : [primaryItems[0], primaryItems[1], primaryItems[2], accountItem];
  const homeHref = passwordChangeRequired
    ? "/coordinacion/cuenta"
    : "/coordinacion/incidentes?view=active";

  useEffect(() => {
    if (!menuOpen) return;

    function closeMenu(event: KeyboardEvent | PointerEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (
        event.target instanceof Node &&
        !menuContainerRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", closeMenu);
    document.addEventListener("pointerdown", closeMenu);
    return () => {
      document.removeEventListener("keydown", closeMenu);
      document.removeEventListener("pointerdown", closeMenu);
    };
  }, [menuOpen]);

  return (
    <>
      <a
        href="#contenido-coordinacion"
        className="skip-link sr-only z-[70] rounded-md bg-[color:var(--foreground)] text-[color:var(--background)] focus:fixed focus:left-3 focus:top-3"
      >
        Saltar al contenido
      </a>

      <aside
        data-coordination-sidebar
        className="fixed inset-y-0 left-0 z-40 hidden w-[min(16rem,30vw)] flex-col border-r border-[color:var(--border)] bg-[color:var(--surface)] lg:flex"
      >
        <div className="border-b border-[color:var(--border)] px-5 py-5">
          <Link
            href={homeHref}
            className="flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="inline-flex size-9 items-center justify-center rounded-md bg-[color:var(--foreground)] text-sm font-black text-[color:var(--background)]">
              A
            </span>
            <span>
              <span className="block text-base font-semibold leading-5">
                Anella
              </span>
              <span className="block text-xs text-black/65 dark:text-white/65">
                Coordinación
              </span>
            </span>
          </Link>
        </div>

        <nav aria-label="Navegación operativa" className="flex-1 p-3">
          {visiblePrimaryItems.length > 0 ? (
            <>
              <p className="px-3 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-black/65 dark:text-white/65">
                Operación
              </p>
              <div className="space-y-1">
                {visiblePrimaryItems.map((item) => (
                  <DesktopLink
                    key={item.path}
                    item={item}
                    pathname={pathname}
                  />
                ))}
              </div>
            </>
          ) : null}

          <p className="px-3 pb-2 pt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-black/65 dark:text-white/65">
            Administración
          </p>
          <div className="space-y-1">
            {visibleUtilityItems.map((item) => (
              <DesktopLink key={item.path} item={item} pathname={pathname} />
            ))}
          </div>
        </nav>

        <div className="border-t border-[color:var(--border)] p-3">
          <Link
            href="/"
            className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm font-semibold text-black/60 transition hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white/60 dark:hover:bg-white/[0.06]"
          >
            Mapa público
            <ArrowUpRight size={17} aria-hidden />
          </Link>
          <div className="mt-2 flex items-start gap-2 rounded-md bg-[color:var(--surface-muted)] p-3 text-xs leading-4 text-black/60 dark:text-white/60">
            <ShieldCheck className="mt-0.5 shrink-0" size={16} aria-hidden />
            Solo se publica información validada y segura.
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--surface)] px-4 lg:hidden">
        <Link
          href={homeHref}
          className="flex min-h-11 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="inline-flex size-8 items-center justify-center rounded-md bg-[color:var(--foreground)] text-xs font-black text-[color:var(--background)]">
            A
          </span>
          <span className="text-sm font-semibold">Anella Coordinación</span>
        </Link>

        <div ref={menuContainerRef} className="relative">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex size-11 items-center justify-center rounded-md border border-[color:var(--border)] focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-expanded={menuOpen}
            aria-controls="menu-coordinacion-movil"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          >
            {menuOpen ? (
              <X size={19} aria-hidden />
            ) : (
              <Menu size={19} aria-hidden />
            )}
          </button>
          {menuOpen ? (
            <nav
              id="menu-coordinacion-movil"
              aria-label="Más opciones"
              className="absolute right-0 top-12 w-56 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2 shadow-xl"
            >
              {mobileSecondaryItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <Icon size={17} aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href="/"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                <ArrowUpRight size={17} aria-hidden />
                Mapa público
              </Link>
            </nav>
          ) : null}
        </div>
      </header>

      <nav
        aria-label="Navegación operativa móvil"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 grid border-t border-[color:var(--border)] bg-[color:var(--surface)] pb-[env(safe-area-inset-bottom)] lg:hidden",
          passwordChangeRequired ? "grid-cols-1" : "grid-cols-4",
        )}
      >
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = item.exactView
            ? pathname === item.path &&
              searchParams.get("view") === item.exactView
            : item.path === "/coordinacion/incidentes"
              ? isItemActive(pathname, item.path) &&
                !(pathname === item.path && searchParams.get("view") === "help")
              : isItemActive(pathname, item.path);
          return (
            <Link
              key={`${item.path}:${item.exactView ?? item.href}`}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-[-3px]",
                active
                  ? "text-[color:var(--foreground)]"
                  : "text-black/65 dark:text-white/65",
              )}
            >
              <Icon size={19} strokeWidth={active ? 2.5 : 2} aria-hidden />
              {item.shortLabel ?? item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
