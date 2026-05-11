import type { Database } from 'bun:sqlite';
import { ulid } from '../../lib/ids.ts';
import { nowIso } from '../../lib/time.ts';

export type CuratedKind = 'tabular' | 'json' | 'geojson' | 'xml' | 'text' | 'uncurated';

export interface CuratedArtifactRow {
  id: string;
  dataset_id: string;
  resource_id: string;
  kind: CuratedKind;
  path: string;
  schema_json: string;
  transform_rules_json: string;
  encoding: string;
  uncurated_reason: string | null;
  curator_version: string;
  created_at: string;
  last_curated_at: string;
}

export interface UpsertCuratedArtifactInput {
  datasetId: string;
  resourceId: string;
  kind: CuratedKind;
  path: string;
  schemaJson: string;
  transformRulesJson: string;
  encoding?: string;
  uncuratedReason?: string | null;
  curatorVersion: string;
  now?: string;
}

export class CuratedArtifactsRepo {
  constructor(private readonly db: Database) {}

  upsert(input: UpsertCuratedArtifactInput): CuratedArtifactRow {
    const now = input.now ?? nowIso();
    const existing = this.byResourceAndVersion(input.resourceId, input.curatorVersion);
    if (existing) {
      this.db
        .query(
          `UPDATE curated_artifacts SET kind = ?, path = ?, schema_json = ?, transform_rules_json = ?, encoding = ?, uncurated_reason = ?, last_curated_at = ? WHERE id = ?`,
        )
        .run(
          input.kind,
          input.path,
          input.schemaJson,
          input.transformRulesJson,
          input.encoding ?? 'utf-8',
          input.uncuratedReason ?? null,
          now,
          existing.id,
        );
      return this.byId(existing.id) as CuratedArtifactRow;
    }
    const id = ulid();
    this.db
      .query(
        `INSERT INTO curated_artifacts (id, dataset_id, resource_id, kind, path, schema_json, transform_rules_json, encoding, uncurated_reason, curator_version, created_at, last_curated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.datasetId,
        input.resourceId,
        input.kind,
        input.path,
        input.schemaJson,
        input.transformRulesJson,
        input.encoding ?? 'utf-8',
        input.uncuratedReason ?? null,
        input.curatorVersion,
        now,
        now,
      );
    return this.byId(id) as CuratedArtifactRow;
  }

  byId(id: string): CuratedArtifactRow | null {
    return (
      this.db
        .query<CuratedArtifactRow, [string]>('SELECT * FROM curated_artifacts WHERE id = ?')
        .get(id) ?? null
    );
  }

  byResourceAndVersion(resourceId: string, curatorVersion: string): CuratedArtifactRow | null {
    return (
      this.db
        .query<CuratedArtifactRow, [string, string]>(
          'SELECT * FROM curated_artifacts WHERE resource_id = ? AND curator_version = ?',
        )
        .get(resourceId, curatorVersion) ?? null
    );
  }

  byDataset(datasetId: string): CuratedArtifactRow[] {
    return this.db
      .query<CuratedArtifactRow, [string]>(
        'SELECT * FROM curated_artifacts WHERE dataset_id = ? ORDER BY created_at',
      )
      .all(datasetId);
  }
}
