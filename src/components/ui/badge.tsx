import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "info" | "warning" | "success" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral:
    "border-black/10 bg-black/[0.04] text-black/70 dark:border-white/10 dark:bg-white/10 dark:text-white/75",
  info: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-200",
  warning:
    "border-amber-500/25 bg-amber-500/12 text-amber-800 dark:text-amber-200",
  success:
    "border-emerald-500/25 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200",
  danger: "border-red-500/25 bg-red-500/12 text-red-700 dark:text-red-200",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
