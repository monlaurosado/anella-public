import { CircleDashed, MapPin, QrCode } from "lucide-react";

import type { SafePoint } from "@/types/domain";

export function SafePointCard({
  point,
  headingLevel = 3,
}: {
  point: SafePoint;
  headingLevel?: 3 | 5;
}) {
  const Heading = headingLevel === 5 ? "h5" : "h3";
  const typeLabel = {
    drop_off: "Punto de entrega",
    logistics: "Punto logístico",
    collection: "Punto de recogida",
  }[point.pointType];

  return (
    <article className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--accent)]">
            {typeLabel}
          </p>
          <Heading className="font-semibold">{point.name}</Heading>
          <p className="mt-1 flex items-center gap-2 text-sm text-black/60 dark:text-white/60">
            <MapPin size={15} aria-hidden />
            {point.address}
          </p>
          <p className="mt-1 flex items-center gap-2 text-xs text-[color:var(--success)]">
            <CircleDashed size={14} aria-hidden />
            Entorno inmediato: {point.radiusMeters} m
          </p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[color:var(--border)]">
          <QrCode size={18} aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-black/65 dark:text-white/65">
        {point.instructions}
      </p>
      {point.capacityNote ? (
        <p className="mt-3 text-xs font-medium text-[color:var(--success)]">
          {point.capacityNote}
        </p>
      ) : null}
    </article>
  );
}
