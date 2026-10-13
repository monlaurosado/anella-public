"use client";

import dynamic from "next/dynamic";

import type { Coordinates } from "@/types/domain";

const CoordinateRadiusPicker = dynamic(
  () =>
    import("@/components/coordination/coordinate-radius-picker").then(
      (module) => module.CoordinateRadiusPicker,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-80 items-center justify-center bg-[color:var(--surface-muted)] text-sm text-black/60 dark:text-white/60">
        Cargando mapa…
      </div>
    ),
  },
);

export type CoordinateRadiusPickerShellProps = {
  initialCenter: Coordinates;
  initiallySelected?: boolean;
  initialRadiusMeters: number;
  minimumRadiusMeters: number;
  maximumRadiusMeters: number;
  radiusStepMeters: number;
  latitudeName?: string;
  longitudeName?: string;
  radiusName?: string;
  tone: "danger" | "safe";
  title: string;
  description: string;
  className?: string;
  controlsBottomClassName?: string;
};

export function CoordinateRadiusPickerShell(
  props: CoordinateRadiusPickerShellProps,
) {
  return <CoordinateRadiusPicker {...props} />;
}
