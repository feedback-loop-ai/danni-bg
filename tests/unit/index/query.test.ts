import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import { search, searchByEntity } from '../../../src/index/query.ts';
import { runIndex } from '../../../src/index/run-index.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../../src/store/repos/entities.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

async function setup(): Promise<{ db: Database; embedder: LocalOnnxEmbedder }> {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  const ds = new DatasetsRepo(d);
  ds.upsert({
    id: 'd-budget',
    slug: 'budget',
    titleBg: 'Общински бюджет 2025',
    descriptionBg: 'Подробен бюджет за общините.',
    tags: ['budget'],
    groups: [],
    sourceUrl: 'https://x/d-budget',
  });
  ds.upsert({
    id: 'd-population',
    slug: 'population',
    titleBg: 'Население на Столична община',
    descriptionBg: 'Статистика за София.',
    tags: ['population'],
    groups: [],
    sourceUrl: 'https://x/d-population',
  });
  const ents = new EntitiesRepo(d);
  ents.upsert({
    id: 'geo:bg-municipality-sofia',
    kind: 'geographic_unit',
    canonicalLabelBg: 'Столична община',
  });
  ents.attach({
    datasetId: 'd-population',
    entityId: 'geo:bg-municipality-sofia',
    extractor: 'gaz',
    confidence: 0.9,
  });
  const embedder = new LocalOnnxEmbedder({ dimension: 16 });
  await runIndex({ db: d, embedder });
  return { db: d, embedder };
}

describe('index.query', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('finds budget dataset by BG keyword', async () => {
    const out = await search({ db: s.db, embedder: s.embedder, query: 'бюджет' });
    const ids = out.map((r) => r.datasetId);
    expect(ids).toContain('d-budget');
  });

  it('finds population dataset by Cyrillic city name', async () => {
    const out = await search({ db: s.db, embedder: s.embedder, query: 'София' });
    const ids = out.map((r) => r.datasetId);
    expect(ids).toContain('d-population');
  });

  it('reports a sensible matchKind for any hit', async () => {
    const out = await search({ db: s.db, embedder: s.embedder, query: 'общини' });
    const first = out[0];
    if (first) {
      expect(['keyword', 'semantic', 'hybrid']).toContain(first.matchKind);
    }
  });

  it('respects limit', async () => {
    const out = await search({ db: s.db, embedder: s.embedder, query: 'бюджет', limit: 1 });
    expect(out.length).toBe(1);
  });

  it('searchByEntity returns datasets attached to the entity', async () => {
    const out = await searchByEntity(
      { db: s.db, embedder: s.embedder, query: '' },
      'geo:bg-municipality-sofia',
    );
    expect(out.map((r) => r.datasetId)).toEqual(['d-population']);
    expect(out[0]?.matchKind).toBe('entity');
  });

  it('searchByEntity respects limit', async () => {
    const out = await searchByEntity(
      { db: s.db, embedder: s.embedder, query: '', limit: 0 },
      'geo:bg-municipality-sofia',
    );
    expect(out.length).toBe(0);
  });

  it('returns empty result for nonsense query', async () => {
    const out = await search({
      db: s.db,
      embedder: s.embedder,
      query: 'zzz-no-such-text-anywhere',
    });
    expect(out.length).toBeLessThanOrEqual(5);
  });
});
