// Pure pagination helpers for incremental ("load more") dataset loading (T063, FR-030/SC-010).
// The API caps each page (limit/offset); the SPA appends pages and de-dupes so a region or filter
// matching thousands of datasets stays responsive instead of rendering everything at once.

export function hasMore(loaded: number, total: number): boolean {
  return loaded < total;
}

/** Append a page to the loaded list, dropping any datasetId already present. */
export function mergePage<T extends { datasetId: string }>(existing: T[], page: T[]): T[] {
  const seen = new Set(existing.map((d) => d.datasetId));
  return [...existing, ...page.filter((d) => !seen.has(d.datasetId))];
}
