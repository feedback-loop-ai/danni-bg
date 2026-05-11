import type { Database } from 'bun:sqlite';
import { CuratedArtifactsRepo } from '../store/repos/curated-artifacts.ts';
import { DatasetsRepo } from '../store/repos/datasets.ts';
import { EntitiesRepo } from '../store/repos/entities.ts';
import { OrganizationsRepo } from '../store/repos/organizations.ts';
import { TranslationsRepo } from '../store/repos/translations.ts';

export interface FtsRow {
  dataset_id: string;
  title_bg: string;
  title_en: string;
  description_bg: string;
  description_en: string;
  publisher_label: string;
  tag_labels: string;
  group_labels: string;
  column_labels: string;
  entity_labels: string;
}

function readColumnLabels(schemaJson: string | null | undefined): string[] {
  if (!schemaJson) return [];
  try {
    const parsed = JSON.parse(schemaJson) as {
      columns?: Array<{ sourceName?: string; canonicalName?: string }>;
    };
    if (!parsed.columns) return [];
    return parsed.columns.map((c) => c.sourceName ?? c.canonicalName ?? '').filter((s) => s);
  } catch {
    return [];
  }
}

export function buildFtsRow(db: Database, datasetId: string): FtsRow | null {
  const ds = new DatasetsRepo(db).get(datasetId);
  if (!ds) return null;
  const orgs = new OrganizationsRepo(db);
  const translations = new TranslationsRepo(db);
  const entities = new EntitiesRepo(db);
  const artifacts = new CuratedArtifactsRepo(db);

  const titleTx = translations.forSubject('dataset_title', datasetId)[0];
  const descTx = translations.forSubject('dataset_description', datasetId)[0];
  const org = ds.publisher_id ? orgs.get(ds.publisher_id) : null;
  const tags = (JSON.parse(ds.tags_json) as string[]).join(' ');
  const groups = (JSON.parse(ds.groups_json) as string[]).join(' ');
  const ents = entities.entitiesForDataset(datasetId);
  const entityLabels = ents
    .flatMap((e) => [e.canonical_label_bg, e.canonical_label_en ?? ''])
    .filter((s) => s.length > 0)
    .join(' ');
  const columnLabels = artifacts
    .byDataset(datasetId)
    .flatMap((a) => readColumnLabels(a.schema_json))
    .join(' ');

  return {
    dataset_id: datasetId,
    title_bg: ds.title_bg,
    title_en: titleTx?.text_en ?? '',
    description_bg: ds.description_bg ?? '',
    description_en: descTx?.text_en ?? '',
    publisher_label: org?.title_bg ?? '',
    tag_labels: tags,
    group_labels: groups,
    column_labels: columnLabels,
    entity_labels: entityLabels,
  };
}

export function upsertFtsRow(db: Database, row: FtsRow): void {
  db.query('DELETE FROM datasets_fts WHERE dataset_id = ?').run(row.dataset_id);
  db.query(
    'INSERT INTO datasets_fts (dataset_id, title_bg, title_en, description_bg, description_en, publisher_label, tag_labels, group_labels, column_labels, entity_labels) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.dataset_id,
    row.title_bg,
    row.title_en,
    row.description_bg,
    row.description_en,
    row.publisher_label,
    row.tag_labels,
    row.group_labels,
    row.column_labels,
    row.entity_labels,
  );
}

export function deleteFtsRow(db: Database, datasetId: string): void {
  db.query('DELETE FROM datasets_fts WHERE dataset_id = ?').run(datasetId);
}
