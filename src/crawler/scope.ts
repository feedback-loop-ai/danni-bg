import type { ScopeConfig } from '../config/schema.ts';

export interface DatasetSummary {
  id: string;
  slug?: string | undefined;
  publisherId?: string | undefined;
  groups?: string[] | undefined;
  tags?: string[] | undefined;
}

export type ScopePredicate = (d: DatasetSummary) => boolean;

function isEmpty(filter: ScopeConfig): boolean {
  return (
    !(filter.publishers && filter.publishers.length > 0) &&
    !(filter.categories && filter.categories.length > 0) &&
    !(filter.tags && filter.tags.length > 0) &&
    !(filter.datasetIds && filter.datasetIds.length > 0)
  );
}

export function buildScopePredicate(filter: ScopeConfig): ScopePredicate {
  if (isEmpty(filter)) return () => true;

  const publishers = new Set(filter.publishers ?? []);
  const categories = new Set(filter.categories ?? []);
  const tags = new Set(filter.tags ?? []);
  const datasetIds = new Set(filter.datasetIds ?? []);

  return (d: DatasetSummary): boolean => {
    if (datasetIds.size > 0 && (datasetIds.has(d.id) || (d.slug && datasetIds.has(d.slug)))) {
      return true;
    }
    if (publishers.size > 0 && d.publisherId && publishers.has(d.publisherId)) return true;
    if (categories.size > 0 && d.groups?.some((g) => categories.has(g))) return true;
    if (tags.size > 0 && d.tags?.some((t) => tags.has(t))) return true;
    return false;
  };
}

export function summarizeScope(filter: ScopeConfig): string {
  if (isEmpty(filter)) return 'all';
  const parts: string[] = [];
  if (filter.publishers?.length) parts.push(`publishers=${filter.publishers.length}`);
  if (filter.categories?.length) parts.push(`categories=${filter.categories.length}`);
  if (filter.tags?.length) parts.push(`tags=${filter.tags.length}`);
  if (filter.datasetIds?.length) parts.push(`datasetIds=${filter.datasetIds.length}`);
  return parts.join(',');
}
