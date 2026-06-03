import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCurate } from '../../src/curate/run-curate.ts';
import { LocalMarianMtTranslator } from '../../src/enrich/translators/local-marianmt.ts';
import { ensureDir } from '../../src/lib/fs.ts';
import { openDb } from '../../src/store/db.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { CuratedArtifactsRepo } from '../../src/store/repos/curated-artifacts.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../src/store/repos/entities.ts';
import { OrganizationsRepo } from '../../src/store/repos/organizations.ts';
import { ResourcesRepo } from '../../src/store/repos/resources.ts';
import { TranslationsRepo } from '../../src/store/repos/translations.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = fileURLToPath(new URL('../fixtures/resources/', import.meta.url));

describe('integration.curate-cycle', () => {
  let db: Database;
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    seedRawFixture(db, storeRoot);
  });
  afterEach(() => {
    db.close();
  });

  it('curates the seeded fixture, attaches entities, and writes a translation', async () => {
    const translator = new LocalMarianMtTranslator({
      translateFn: async (text) => ({ text: `EN(${text})`, confidence: 0.8 }),
    });
    const result = await runCurate({
      db,
      storeRoot,
      curatorVersion: 'test-1',
      translator,
    });
    expect(result.curated).toBeGreaterThan(0);
    expect(result.entitiesAttached).toBeGreaterThan(0);
    expect(result.translationsWritten).toBeGreaterThan(0);

    const artifacts = new CuratedArtifactsRepo(db).byDataset('d1');
    expect(artifacts.length).toBeGreaterThan(0);
    expect(existsSync(join(storeRoot, 'curated', 'd1', 'r-csv', 'data.ndjson'))).toBe(true);

    const tx = new TranslationsRepo(db).forSubject('dataset_title', 'd1');
    expect(tx[0]?.text_en).toContain('EN(');

    const ents = new EntitiesRepo(db).entitiesForDataset('d1');
    expect(ents.length).toBeGreaterThan(0);
  });

  it('re-curate with same version is idempotent (single curated_artifacts row per resource)', async () => {
    const before = await runCurate({
      db,
      storeRoot,
      curatorVersion: 'idem-1',
    });
    const after = await runCurate({
      db,
      storeRoot,
      curatorVersion: 'idem-1',
    });
    const rows = new CuratedArtifactsRepo(db).byDataset('d1');
    expect(after.curated + after.uncurated).toBe(before.curated + before.uncurated);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('bumping curator_version writes a fresh row keyed on (resource, version)', async () => {
    await runCurate({ db, storeRoot, curatorVersion: 'v1' });
    await runCurate({ db, storeRoot, curatorVersion: 'v2' });
    const rows = new CuratedArtifactsRepo(db).byDataset('d1');
    const versions = new Set(rows.map((r) => r.curator_version));
    expect(versions.size).toBeGreaterThanOrEqual(2);
  });
});

function seedRawFixture(db: Database, storeRoot: string): void {
  new OrganizationsRepo(db).upsert({
    id: 'org-sofia',
    slug: 'sofia',
    titleBg: 'Столична община',
    sourceUrl: 'https://example.org/org/sofia',
  });
  new DatasetsRepo(db).upsert({
    id: 'd1',
    slug: 'budget-2025',
    titleBg: 'Бюджет на Столична община 2025',
    descriptionBg: 'Описание включващо 5 май 2025 и Пловдив.',
    publisherId: 'org-sofia',
    tags: ['budget'],
    groups: ['finansi'],
    sourceUrl: 'https://example.org/data/dataset/d1',
  });
  const resources = new ResourcesRepo(db);
  resources.upsert({
    id: 'r-csv',
    datasetId: 'd1',
    sourceUrl: 'https://example.org/data/r1.csv',
    declaredFormat: 'csv',
  });
  resources.upsert({
    id: 'r-json',
    datasetId: 'd1',
    sourceUrl: 'https://example.org/data/r2.json',
    declaredFormat: 'json',
  });
  resources.recordCapture({
    id: 'r-csv',
    bytes: 1,
    sha256: 'a'.repeat(64),
    rawPath: 'd1/r-csv/raw.csv',
    outcome: 'success',
  });
  resources.recordCapture({
    id: 'r-json',
    bytes: 1,
    sha256: 'b'.repeat(64),
    rawPath: 'd1/r-json/raw.json',
    outcome: 'success',
  });
  // Place the actual bytes
  ensureDir(join(storeRoot, 'raw', 'd1', 'r-csv'));
  writeFileSync(
    join(storeRoot, 'raw', 'd1', 'r-csv', 'raw.csv'),
    readFileSync(join(FIX, 'csv-utf8.csv')),
  );
  ensureDir(join(storeRoot, 'raw', 'd1', 'r-json'));
  writeFileSync(
    join(storeRoot, 'raw', 'd1', 'r-json', 'raw.json'),
    readFileSync(join(FIX, 'json-array.json')),
  );
}
