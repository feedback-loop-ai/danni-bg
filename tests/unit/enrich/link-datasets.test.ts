import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkAllSharedEntities, linkDatasetsForEntity } from '../../../src/enrich/link-datasets.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetLinksRepo } from '../../../src/store/repos/dataset-links.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../../src/store/repos/entities.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): {
  db: Database;
  entitiesRepo: EntitiesRepo;
  linksRepo: DatasetLinksRepo;
} {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  const ds = new DatasetsRepo(d);
  for (const id of ['d1', 'd2', 'd3']) {
    ds.upsert({ id, slug: id, titleBg: id, tags: [], groups: [], sourceUrl: `https://x/${id}` });
  }
  const ents = new EntitiesRepo(d);
  ents.upsert({
    id: 'geo:bg-municipality-sofia',
    kind: 'geographic_unit',
    canonicalLabelBg: 'Столична община',
  });
  ents.attach({
    datasetId: 'd1',
    entityId: 'geo:bg-municipality-sofia',
    extractor: 'gaz',
    confidence: 0.9,
  });
  ents.attach({
    datasetId: 'd2',
    entityId: 'geo:bg-municipality-sofia',
    extractor: 'gaz',
    confidence: 0.9,
  });
  ents.attach({
    datasetId: 'd3',
    entityId: 'geo:bg-municipality-sofia',
    extractor: 'gaz',
    confidence: 0.9,
  });
  return { db: d, entitiesRepo: ents, linksRepo: new DatasetLinksRepo(d) };
}

describe('enrich.link-datasets', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('creates pairwise links for an entity attached to multiple datasets', () => {
    const r = linkDatasetsForEntity(
      { entitiesRepo: s.entitiesRepo, linksRepo: s.linksRepo },
      'geo:bg-municipality-sofia',
    );
    expect(r.created).toBe(3); // (d1,d2), (d1,d3), (d2,d3)
    const links = s.linksRepo.forDataset('d1');
    expect(links.length).toBe(2);
    for (const l of links) {
      expect(l.dataset_a_id < l.dataset_b_id).toBe(true);
      expect(l.heuristic).toBe('shared_geo');
    }
  });

  it('returns 0 for unknown entity', () => {
    const r = linkDatasetsForEntity(
      { entitiesRepo: s.entitiesRepo, linksRepo: s.linksRepo },
      'missing',
    );
    expect(r.created).toBe(0);
  });

  it('linkAllSharedEntities aggregates across entities', () => {
    const r = linkAllSharedEntities({ entitiesRepo: s.entitiesRepo, linksRepo: s.linksRepo }, [
      'geo:bg-municipality-sofia',
      'missing',
    ]);
    expect(r.created).toBe(3);
  });
});
