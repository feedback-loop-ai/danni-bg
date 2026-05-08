import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { nowIso } from '../../lib/time.ts';

export const DatasetTagsSchema = z.array(z.string());
export const DatasetGroupsSchema = z.array(z.string());

export type LifecycleState = 'active' | 'withdrawn' | 'out_of_scope';

export interface DatasetRow {
  id: string;
  slug: string;
  title_bg: string;
  description_bg: string | null;
  publisher_id: string | null;
  license_id: string | null;
  tags_json: string;
  groups_json: string;
  source_url: string;
  metadata_created: string | null;
  metadata_modified: string | null;
  first_seen_at: string;
  last_synced_at: string;
  source_etag_or_hash: string | null;
  lifecycle_state: LifecycleState;
  lifecycle_changed_at: string | null;
  withdrawn_reason: string | null;
}

export interface UpsertDatasetInput {
  id: string;
  slug: string;
  titleBg: string;
  descriptionBg?: string | null | undefined;
  publisherId?: string | null | undefined;
  licenseId?: string | null | undefined;
  tags: string[];
  groups: string[];
  sourceUrl: string;
  metadataCreated?: string | null | undefined;
  metadataModified?: string | null | undefined;
  sourceEtagOrHash?: string | null | undefined;
  lifecycleState?: LifecycleState;
  now?: string;
}

export interface DatasetFieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface UpsertDatasetResult {
  row: DatasetRow;
  changes: DatasetFieldChange[];
  inserted: boolean;
}

const TRACKED_FIELDS: Array<{
  field: string;
  read: (row: DatasetRow) => string | null;
  write: (input: UpsertDatasetInput) => string | null;
}> = [
  { field: 'title_bg', read: (r) => r.title_bg, write: (i) => i.titleBg },
  { field: 'description_bg', read: (r) => r.description_bg, write: (i) => i.descriptionBg ?? null },
  { field: 'publisher_id', read: (r) => r.publisher_id, write: (i) => i.publisherId ?? null },
  { field: 'license_id', read: (r) => r.license_id, write: (i) => i.licenseId ?? null },
  { field: 'tags_json', read: (r) => r.tags_json, write: (i) => JSON.stringify(i.tags) },
  { field: 'groups_json', read: (r) => r.groups_json, write: (i) => JSON.stringify(i.groups) },
  { field: 'source_url', read: (r) => r.source_url, write: (i) => i.sourceUrl },
  { field: 'metadata_modified', read: (r) => r.metadata_modified, write: (i) => i.metadataModified ?? null },
];

export class DatasetsRepo {
  constructor(private readonly db: Database) {}

  upsert(input: UpsertDatasetInput): UpsertDatasetResult {
    const now = input.now ?? nowIso();
    const existing = this.get(input.id);
    const tagsJson = JSON.stringify(input.tags);
    const groupsJson = JSON.stringify(input.groups);
    const lifecycle = input.lifecycleState ?? 'active';

    if (!existing) {
      this.db
        .query(
          `INSERT INTO datasets (id, slug, title_bg, description_bg, publisher_id, license_id, tags_json, groups_json, source_url, metadata_created, metadata_modified, first_seen_at, last_synced_at, source_etag_or_hash, lifecycle_state, lifecycle_changed_at, withdrawn_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          input.id,
          input.slug,
          input.titleBg,
          input.descriptionBg ?? null,
          input.publisherId ?? null,
          input.licenseId ?? null,
          tagsJson,
          groupsJson,
          input.sourceUrl,
          input.metadataCreated ?? null,
          input.metadataModified ?? null,
          now,
          now,
          input.sourceEtagOrHash ?? null,
          lifecycle,
          now,
        );
      return { row: this.get(input.id) as DatasetRow, changes: [], inserted: true };
    }

    const changes: DatasetFieldChange[] = [];
    for (const tracked of TRACKED_FIELDS) {
      const oldVal = tracked.read(existing);
      const newVal = tracked.write(input);
      if (oldVal !== newVal) {
        changes.push({ field: tracked.field, oldValue: oldVal, newValue: newVal });
      }
    }

    const lifecycleChanged = existing.lifecycle_state !== lifecycle;

    this.db
      .query(
        `UPDATE datasets SET slug = ?, title_bg = ?, description_bg = ?, publisher_id = ?, license_id = ?, tags_json = ?, groups_json = ?, source_url = ?, metadata_created = ?, metadata_modified = ?, last_synced_at = ?, source_etag_or_hash = ?, lifecycle_state = ?, lifecycle_changed_at = ? WHERE id = ?`,
      )
      .run(
        input.slug,
        input.titleBg,
        input.descriptionBg ?? null,
        input.publisherId ?? null,
        input.licenseId ?? null,
        tagsJson,
        groupsJson,
        input.sourceUrl,
        input.metadataCreated ?? null,
        input.metadataModified ?? null,
        now,
        input.sourceEtagOrHash ?? null,
        lifecycle,
        lifecycleChanged ? now : existing.lifecycle_changed_at,
        input.id,
      );

    return { row: this.get(input.id) as DatasetRow, changes, inserted: false };
  }

  setLifecycle(id: string, state: LifecycleState, reason: string | null = null, now: string = nowIso()): void {
    this.db
      .query('UPDATE datasets SET lifecycle_state = ?, lifecycle_changed_at = ?, withdrawn_reason = ? WHERE id = ?')
      .run(state, now, state === 'withdrawn' ? reason : null, id);
  }

  get(id: string): DatasetRow | null {
    return this.db.query<DatasetRow, [string]>('SELECT * FROM datasets WHERE id = ?').get(id) ?? null;
  }

  listActive(): DatasetRow[] {
    return this.db
      .query<DatasetRow, []>(
        "SELECT * FROM datasets WHERE lifecycle_state = 'active' ORDER BY id",
      )
      .all();
  }

  listAll(): DatasetRow[] {
    return this.db.query<DatasetRow, []>('SELECT * FROM datasets ORDER BY id').all();
  }
}
