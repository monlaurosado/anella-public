import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  copySearchParams,
  type RawSearchParams,
} from "@/components/coordination/queue-query";

function pageNumbers(current: number, count: number) {
  if (count <= 7) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }

  const visible = new Set([1, count, current - 1, current, current + 1]);
  const ordered = [...visible]
    .filter((page) => page >= 1 && page <= count)
    .sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];

  for (const page of ordered) {
    const previous = result.at(-1);
    if (typeof previous === "number" && page - previous > 1) {
      result.push("ellipsis");
    }
    result.push(page);
  }

  return result;
}

function pageHref(
  basePath: string,
  rawSearchParams: RawSearchParams,
  page: number,
) {
  const params = copySearchParams(rawSearchParams);
  params.delete("notice");
  params.delete("error");
  params.set("page", String(page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const controlClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[color:var(--border)] px-3 text-sm font-semibold transition hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.06]";

export function QueuePagination({
  basePath,
  rawSearchParams,
  page,
  pageCount,
  pageSize,
  total,
}: {
  basePath: string;
  rawSearchParams: RawSearchParams;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}) {
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Paginación de la cola"
      className="flex flex-col gap-3 border-t border-[color:var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p
        className="text-sm text-black/60 dark:text-white/60"
        aria-live="polite"
      >
        {firstItem.toLocaleString("es-ES")}–{lastItem.toLocaleString("es-ES")}{" "}
        de {total.toLocaleString("es-ES")}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {page > 1 ? (
          <Link
            href={pageHref(basePath, rawSearchParams, page - 1)}
            className={controlClass}
            aria-label="Página anterior"
          >
            <ChevronLeft size={16} aria-hidden />
          </Link>
        ) : (
          <span
            className={`${controlClass} cursor-not-allowed opacity-40`}
            aria-disabled="true"
          >
            <ChevronLeft size={16} aria-hidden />
          </span>
        )}

        {pageNumbers(page, pageCount).map((item, index) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="inline-flex min-h-11 min-w-8 items-center justify-center text-sm text-black/65 dark:text-white/65"
              aria-hidden
            >
              …
            </span>
          ) : (
            <Link
              key={item}
              href={pageHref(basePath, rawSearchParams, item)}
              aria-current={item === page ? "page" : undefined}
              aria-label={`Página ${item}`}
              className={`${controlClass} ${
                item === page
                  ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)] hover:opacity-90"
                  : ""
              }`}
            >
              {item}
            </Link>
          ),
        )}

        {page < pageCount ? (
          <Link
            href={pageHref(basePath, rawSearchParams, page + 1)}
            className={controlClass}
            aria-label="Página siguiente"
          >
            <ChevronRight size={16} aria-hidden />
          </Link>
        ) : (
          <span
            className={`${controlClass} cursor-not-allowed opacity-40`}
            aria-disabled="true"
          >
            <ChevronRight size={16} aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}
