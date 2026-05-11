import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { searchByEntity } from '../../src/index/query.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../src/store/repos/entities.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('integration.search-by-entity (SC-011)', () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db, join(ROOT, 'migrations'));
    const ds = new DatasetsRepo(db);
    for (const id of ['d1', 'd2', 'd3']) {
      ds.upsert({ id, slug: id, titleBg: id, tags: [], groups: [], sourceUrl: `https://x/${id}` });
    }
    const ents = new EntitiesRepo(db);
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
  });
  afterEach(() => {
    db.close();
  });

  it('returns every dataset linked to a known municipality', async () => {
    const out = await searchByEntity(
      { db, embedder: new LocalOnnxEmbedder({ dimension: 8 }), query: '' },
      'geo:bg-municipality-sofia',
    );
    expect(out.map((r) => r.datasetId).sort()).toEqual(['d1', 'd2']);
  });
});
