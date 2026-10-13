import { cn } from "@/lib/utils";

type MetricTone = "neutral" | "info" | "warning" | "success";

const toneClasses: Record<MetricTone, string> = {
  neutral: "text-[color:var(--foreground)]",
  info: "text-[color:var(--info)]",
  warning: "text-[color:var(--warning)]",
  success: "text-[color:var(--success)]",
};

export function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: MetricTone;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
      <div
        className={cn("text-2xl font-semibold leading-none", toneClasses[tone])}
      >
        {value}
      </div>
      <div className="mt-2 break-words text-xs font-medium text-black/55 dark:text-white/55">
        {label}
      </div>
    </div>
  );
}
