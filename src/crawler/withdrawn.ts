import type { Database } from 'bun:sqlite';
import { DatasetsRepo } from '../store/repos/datasets.ts';
import { ResourcesRepo } from '../store/repos/resources.ts';

export interface WithdrawalDetectorOptions {
  db: Database;
  runId: string;
  observedDatasetIds: Set<string>;
}

export interface WithdrawalEvent {
  datasetId: string;
  reason: string;
}

/**
 * A dataset present in prior runs but absent from the current discovery is
 * marked `withdrawn`. Per FR-016, the row + raw bytes are preserved.
 */
export function detectWithdrawals(opts: WithdrawalDetectorOptions): WithdrawalEvent[] {
  const datasets = new DatasetsRepo(opts.db);
  const resources = new ResourcesRepo(opts.db);
  const events: WithdrawalEvent[] = [];
  for (const row of datasets.listActive()) {
    if (opts.observedDatasetIds.has(row.id)) continue;
    datasets.setLifecycle(row.id, 'withdrawn', 'absent from discovery');
    for (const r of resources.listByDataset(row.id)) {
      resources.setLifecycle(r.id, 'withdrawn');
    }
    events.push({ datasetId: row.id, reason: 'absent from discovery' });
  }
  return events;
}
