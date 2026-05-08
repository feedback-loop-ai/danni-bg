import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

export interface DatasetRevisionRow {
  id: number;
  dataset_id: string;
  observed_at: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  run_id: string;
}

export interface InsertRevisionInput {
  datasetId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  runId: string;
  observedAt?: string;
}

export class DatasetRevisionsRepo {
  constructor(private readonly db: Database) {}

  insert(input: InsertRevisionInput): void {
    const observedAt = input.observedAt ?? nowIso();
    this.db
      .query(
        `INSERT INTO dataset_revisions (dataset_id, observed_at, field, old_value, new_value, run_id) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.datasetId, observedAt, input.field, input.oldValue, input.newValue, input.runId);
  }

  listForDataset(datasetId: string): DatasetRevisionRow[] {
    return this.db
      .query<DatasetRevisionRow, [string]>(
        'SELECT * FROM dataset_revisions WHERE dataset_id = ? ORDER BY observed_at, id',
      )
      .all(datasetId);
  }
}
