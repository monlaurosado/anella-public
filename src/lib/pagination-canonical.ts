export type PaginationBoundary = {
  parameter: string;
  requestedPage: number;
  pageCount: number;
};

/**
 * Builds the canonical URL when a data service has clamped one or more
 * requested pages to their final available page.
 */
export function canonicalPaginationHref(
  basePath: string,
  searchParams: URLSearchParams,
  boundaries: PaginationBoundary[],
) {
  const canonicalParams = new URLSearchParams(searchParams);
  let changed = false;

  for (const { parameter, requestedPage, pageCount } of boundaries) {
    if (requestedPage <= pageCount) continue;

    canonicalParams.set(parameter, String(pageCount));
    changed = true;
  }

  if (!changed) return null;

  const query = canonicalParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}
