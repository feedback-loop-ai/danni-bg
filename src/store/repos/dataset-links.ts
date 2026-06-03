import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

export interface DatasetLinkRow {
  dataset_a_id: string;
  dataset_b_id: string;
  via_entity_id: string;
  heuristic: string;
  confidence: number;
  created_at: string;
}

export interface InsertLinkInput {
  datasetA: string;
  datasetB: string;
  viaEntityId: string;
  heuristic: string;
  confidence: number;
  createdAt?: string;
}

export class DatasetLinksRepo {
  constructor(private readonly db: Database) {}

  insert(input: InsertLinkInput): DatasetLinkRow | null {
    const [a, b] = input.datasetA < input.datasetB
      ? [input.datasetA, input.datasetB]
      : [input.datasetB, input.datasetA];
    if (a === b) return null;
    const at = input.createdAt ?? nowIso();
    this.db
      .query(
        `INSERT OR REPLACE INTO dataset_links (dataset_a_id, dataset_b_id, via_entity_id, heuristic, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(a, b, input.viaEntityId, input.heuristic, input.confidence, at);
    return {
      dataset_a_id: a,
      dataset_b_id: b,
      via_entity_id: input.viaEntityId,
      heuristic: input.heuristic,
      confidence: input.confidence,
      created_at: at,
    };
  }

  forDataset(datasetId: string): DatasetLinkRow[] {
    return this.db
      .query<DatasetLinkRow, [string, string]>(
        'SELECT * FROM dataset_links WHERE dataset_a_id = ? OR dataset_b_id = ? ORDER BY created_at',
      )
      .all(datasetId, datasetId);
  }
}
