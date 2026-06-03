import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { search } from '../../src/index/query.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { ensureDir } from '../../src/lib/fs.ts';
import { openDb } from '../../src/store/db.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { CuratedArtifactsRepo } from '../../src/store/repos/curated-artifacts.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';
import { ResourcesRepo } from '../../src/store/repos/resources.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('integration.search-traceability (FR-013, SC-005)', () => {
  let db: Database;
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    new DatasetsRepo(db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Бюджет 2025',
      tags: [],
      groups: [],
      sourceUrl: 'https://data.egov.bg/data/dataset/d1',
    });
    new ResourcesRepo(db).upsert({
      id: 'r1',
      datasetId: 'd1',
      sourceUrl: 'https://x/r1.csv',
      declaredFormat: 'csv',
    });
    new CuratedArtifactsRepo(db).upsert({
      datasetId: 'd1',
      resourceId: 'r1',
      kind: 'tabular',
      path: 'd1/r1/data.ndjson',
      schemaJson: '{}',
      transformRulesJson: '[]',
      curatorVersion: 'v1',
    });
    ensureDir(join(storeRoot, 'curated', 'd1'));
    writeFileSync(join(storeRoot, 'curated', 'd1', 'placeholder.txt'), 'x');
  });
  afterEach(() => {
    db.close();
  });

  it('every result includes a non-empty sourceUrl pointing at data.egov.bg and a curatedDatasetPath', async () => {
    const embedder = new LocalOnnxEmbedder({ dimension: 8 });
    await runIndex({ db, embedder });
    const results = await search({ db, embedder, query: 'бюджет' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.sourceUrl).toContain('data.egov.bg');
      const curatedAbs = join(storeRoot, 'curated', r.curatedDatasetPath);
      expect(existsSync(curatedAbs)).toBe(true);
    }
  });
});
