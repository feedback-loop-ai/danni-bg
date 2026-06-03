import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { CuratedArtifactsRepo } from '../../../../src/store/repos/curated-artifacts.ts';
import { DatasetsRepo } from '../../../../src/store/repos/datasets.ts';
import { ResourcesRepo } from '../../../../src/store/repos/resources.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): { db: Database; repo: CuratedArtifactsRepo } {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  new DatasetsRepo(d).upsert({
    id: 'd1',
    slug: 'd1',
    titleBg: 'A',
    tags: [],
    groups: [],
    sourceUrl: 'https://x/d1',
  });
  new ResourcesRepo(d).upsert({ id: 'r1', datasetId: 'd1', sourceUrl: 'https://x/r1' });
  return { db: d, repo: new CuratedArtifactsRepo(d) };
}

describe('store.repos.curated-artifacts', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('inserts then updates by (resource, version)', () => {
    const first = s.repo.upsert({
      datasetId: 'd1',
      resourceId: 'r1',
      kind: 'tabular',
      path: 'd1/r1/data.ndjson',
      schemaJson: '{}',
      transformRulesJson: '[]',
      curatorVersion: 'v1',
    });
    expect(first.kind).toBe('tabular');
    const second = s.repo.upsert({
      datasetId: 'd1',
      resourceId: 'r1',
      kind: 'json',
      path: 'd1/r1/data.json',
      schemaJson: '{}',
      transformRulesJson: '[]',
      curatorVersion: 'v1',
    });
    expect(second.id).toBe(first.id);
    expect(second.kind).toBe('json');
  });

  it('treats different curator_version as a new row', () => {
    s.repo.upsert({
      datasetId: 'd1',
      resourceId: 'r1',
      kind: 'tabular',
      path: 'a',
      schemaJson: '{}',
      transformRulesJson: '[]',
      curatorVersion: 'v1',
    });
    s.repo.upsert({
      datasetId: 'd1',
      resourceId: 'r1',
      kind: 'tabular',
      path: 'b',
      schemaJson: '{}',
      transformRulesJson: '[]',
      curatorVersion: 'v2',
    });
    expect(s.repo.byDataset('d1').length).toBe(2);
  });

  it('byResourceAndVersion returns null when missing', () => {
    expect(s.repo.byResourceAndVersion('r1', 'never')).toBeNull();
  });

  it('byId returns null when missing', () => {
    expect(s.repo.byId('missing')).toBeNull();
  });

  it('records uncurated reason', () => {
    const out = s.repo.upsert({
      datasetId: 'd1',
      resourceId: 'r1',
      kind: 'uncurated',
      path: '',
      schemaJson: '{}',
      transformRulesJson: '[]',
      curatorVersion: 'v1',
      uncuratedReason: 'no curator',
    });
    expect(out.uncurated_reason).toBe('no curator');
  });
});
