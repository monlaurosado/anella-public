import Link from "next/link";
import {
  ClipboardList,
  HandHeart,
  History,
  MapPin,
  PanelsTopLeft,
} from "lucide-react";

import { IncidentTabsScroller } from "@/components/coordination/incident-tabs-scroller";
import { cn } from "@/lib/utils";

const incidentTabs = [
  { value: "summary", label: "Resumen", icon: PanelsTopLeft },
  { value: "safe-points", label: "Puntos de entrega", icon: MapPin },
  {
    value: "contributions",
    label: "Aportaciones",
    icon: HandHeart,
  },
  { value: "activity", label: "Actividad", icon: History },
  { value: "needs", label: "Solicitudes (legado)", icon: ClipboardList },
] as const;

export type IncidentTab = (typeof incidentTabs)[number]["value"];

export function parseIncidentTab(value?: string): IncidentTab {
  return incidentTabs.some((tab) => tab.value === value)
    ? (value as IncidentTab)
    : "summary";
}

export function IncidentTabs({
  incidentId,
  activeTab,
  needCount,
  contributionCount,
  safePointCount,
  activityCount,
}: {
  incidentId: string;
  activeTab: IncidentTab;
  needCount: number;
  contributionCount: number;
  safePointCount: number;
  activityCount: number;
}) {
  const counts: Partial<Record<IncidentTab, number>> = {
    needs: needCount,
    contributions: contributionCount,
    "safe-points": safePointCount,
    activity: activityCount,
  };

  return (
    <IncidentTabsScroller activeTab={activeTab}>
      <div className="flex min-w-max gap-1">
        {incidentTabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.value === activeTab;
          const count = counts[tab.value];

          return (
            <Link
              key={tab.value}
              href={`/coordinacion/incidentes/${incidentId}?tab=${tab.value}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-12 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-[-3px]",
                active
                  ? "border-[color:var(--foreground)] text-[color:var(--foreground)]"
                  : "border-transparent text-black/65 hover:text-black/80 dark:text-white/65 dark:hover:text-white/80",
              )}
            >
              <Icon size={16} aria-hidden />
              {tab.label}
              {count !== undefined ? (
                <span className="rounded-full bg-black/[0.06] px-1.5 py-0.5 text-[11px] tabular-nums dark:bg-white/10">
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </IncidentTabsScroller>
  );
}
