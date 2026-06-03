import type { Database } from 'bun:sqlite';
import { DatasetsRepo } from '../store/repos/datasets.ts';
import { ResourcesRepo } from '../store/repos/resources.ts';
import type { ScopePredicate } from './scope.ts';

export interface OutOfScopeOptions {
  db: Database;
  runId: string;
  scopePredicate: ScopePredicate;
}

export interface OutOfScopeEvent {
  datasetId: string;
}

/**
 * Datasets whose `lifecycle_state='active'` no longer match the active scope
 * filter transition to `out_of_scope`. Rows + raw bytes are preserved per
 * FR-018a.
 */
export function reconcileOutOfScope(opts: OutOfScopeOptions): OutOfScopeEvent[] {
  const datasets = new DatasetsRepo(opts.db);
  const resources = new ResourcesRepo(opts.db);
  const events: OutOfScopeEvent[] = [];
  for (const row of datasets.listActive()) {
    const inScope = opts.scopePredicate({
      id: row.id,
      slug: row.slug,
      publisherId: row.publisher_id ?? undefined,
      groups: JSON.parse(row.groups_json) as string[],
      tags: JSON.parse(row.tags_json) as string[],
    });
    if (inScope) continue;
    datasets.setLifecycle(row.id, 'out_of_scope');
    for (const r of resources.listByDataset(row.id)) {
      resources.setLifecycle(r.id, 'out_of_scope');
    }
    events.push({ datasetId: row.id });
  }
  return events;
}
