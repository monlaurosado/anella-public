"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function IncidentTabsScroller({
  activeTab,
  ariaLabel = "Secciones de la emergencia",
  className = "mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6 lg:px-8",
  children,
}: {
  activeTab: string;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const activeTab = containerRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );

    activeTab?.scrollIntoView({
      behavior: "instant",
      block: "nearest",
      inline: "center",
    });
  }, [activeTab]);

  return (
    <nav
      ref={containerRef}
      aria-label={ariaLabel}
      className={cn(
        "overscroll-x-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
      data-horizontal-scroller
      tabIndex={0}
    >
      {children}
    </nav>
  );
}
