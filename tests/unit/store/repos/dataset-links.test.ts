import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { DatasetLinksRepo } from '../../../../src/store/repos/dataset-links.ts';
import { DatasetsRepo } from '../../../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../../../src/store/repos/entities.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): { db: Database; repo: DatasetLinksRepo } {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  const ds = new DatasetsRepo(d);
  for (const id of ['d1', 'd2']) {
    ds.upsert({ id, slug: id, titleBg: id, tags: [], groups: [], sourceUrl: `https://x/${id}` });
  }
  new EntitiesRepo(d).upsert({ id: 'tag:x', kind: 'tag', canonicalLabelBg: 'x' });
  return { db: d, repo: new DatasetLinksRepo(d) };
}

describe('store.repos.dataset-links', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('orders datasets canonically and inserts a row', () => {
    const r = s.repo.insert({
      datasetA: 'd2',
      datasetB: 'd1',
      viaEntityId: 'tag:x',
      heuristic: 'shared_tag',
      confidence: 0.5,
    });
    expect(r?.dataset_a_id).toBe('d1');
    expect(r?.dataset_b_id).toBe('d2');
  });

  it('returns null when datasetA == datasetB', () => {
    expect(
      s.repo.insert({
        datasetA: 'd1',
        datasetB: 'd1',
        viaEntityId: 'tag:x',
        heuristic: 'self',
        confidence: 1,
      }),
    ).toBeNull();
  });

  it('forDataset returns links involving the dataset', () => {
    s.repo.insert({
      datasetA: 'd1',
      datasetB: 'd2',
      viaEntityId: 'tag:x',
      heuristic: 'shared_tag',
      confidence: 0.5,
    });
    expect(s.repo.forDataset('d1').length).toBe(1);
    expect(s.repo.forDataset('d2').length).toBe(1);
  });
});
