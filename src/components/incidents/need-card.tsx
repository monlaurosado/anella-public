import { Clock, MapPin, PackageCheck } from "lucide-react";

import type { Need, SafePoint } from "@/types/domain";
import { calculateRemainingQuantity } from "@/lib/contribution-quantities";
import { formatQuantity } from "@/lib/format";
import { formatDateTimeInTimeZone } from "@/lib/time-zone";
import { NeedStatusPill, PriorityPill } from "@/components/ui/status-pill";

export function NeedCard({
  need,
  safePoint,
  headingLevel = 3,
}: {
  need: Need;
  safePoint?: SafePoint;
  headingLevel?: 3 | 5;
}) {
  const Heading = headingLevel === 5 ? "h5" : "h3";
  const remaining = calculateRemainingQuantity(need);
  const deliveredProgress = Math.min(
    Math.round((need.quantityReceived / need.quantityNeeded) * 100),
    100,
  );
  const committedProgress = Math.min(
    Math.round((need.quantityCommitted / need.quantityNeeded) * 100),
    100 - deliveredProgress,
  );

  return (
    <article className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex flex-wrap gap-2">
        <NeedStatusPill status={need.status} />
        <PriorityPill priority={need.priority} />
      </div>
      <Heading className="mt-3 text-lg font-semibold">{need.title}</Heading>
      {need.description ? (
        <p className="mt-2 text-sm leading-6 text-black/65 dark:text-white/65">
          {need.description}
        </p>
      ) : null}
      <div className="mt-4 space-y-2 text-sm">
        <p className="flex items-center gap-2">
          <PackageCheck size={16} aria-hidden />
          Faltan {formatQuantity(remaining, need.unit)} de{" "}
          {formatQuantity(need.quantityNeeded, need.unit)}
        </p>
        {need.quantityCommitted > 0 ? (
          <p className="text-black/65 dark:text-white/65">
            Recepción registrada:{" "}
            {formatQuantity(need.quantityReceived, need.unit)}. Compromiso
            pendiente: {formatQuantity(need.quantityCommitted, need.unit)}.
          </p>
        ) : null}
        {need.quantityEnRoute > 0 ? (
          <p className="text-black/65 dark:text-white/65">
            En camino: {formatQuantity(need.quantityEnRoute, need.unit)}.
          </p>
        ) : null}
        {safePoint ? (
          <p className="flex items-center gap-2 text-black/65 dark:text-white/65">
            <MapPin size={16} aria-hidden />
            {safePoint.name}
          </p>
        ) : null}
        {need.deadline ? (
          <p className="flex items-center gap-2 text-black/65 dark:text-white/65">
            <Clock size={16} aria-hidden />
            Fecha límite:{" "}
            {formatDateTimeInTimeZone(need.deadline, need.timeZone)}
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className="h-full bg-[color:var(--success)]"
          style={{ width: `${deliveredProgress}%` }}
        />
        <div
          className="h-full bg-[color:var(--info)]"
          style={{ width: `${committedProgress}%` }}
        />
      </div>
    </article>
  );
}
