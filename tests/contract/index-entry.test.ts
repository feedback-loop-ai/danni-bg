import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { search } from '../../src/index/query.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';
import { OrganizationsRepo } from '../../src/store/repos/organizations.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

const LocalizedText = z.object({
  bg: z.string(),
  en: z.string().nullable().optional(),
  translator: z.string().nullable().optional(),
  translationConfidence: z.number().min(0).max(1).nullable().optional(),
});

const Freshness = z.object({
  lastSyncedAt: z.string(),
  sourceLastModified: z.string().nullable().optional(),
  sourceEtagOrHash: z.string().nullable().optional(),
  isStale: z.boolean(),
  freshnessSloSeconds: z.number().int().min(0),
});

const IndexEntry = z.object({
  datasetId: z.string(),
  score: z.number(),
  matchKind: z.enum(['keyword', 'semantic', 'hybrid', 'entity']),
  title: LocalizedText,
  snippet: z.string().nullable().optional(),
  publisher: z
    .object({
      id: z.string(),
      title: LocalizedText,
    })
    .nullable(),
  matchedEntities: z.array(z.unknown()).optional(),
  sourceUrl: z.string(),
  curatedDatasetPath: z.string(),
  freshness: Freshness,
});

describe('contract.index-entry', () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db, MIGRATIONS);
  });
  afterEach(() => {
    db.close();
  });

  it('search() output validates against the index-entry schema', async () => {
    new OrganizationsRepo(db).upsert({
      id: 'p1',
      slug: 'p1',
      titleBg: 'Столична община',
      sourceUrl: 'https://x/p1',
    });
    new DatasetsRepo(db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Бюджет 2025',
      publisherId: 'p1',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    const embedder = new LocalOnnxEmbedder({ dimension: 8 });
    await runIndex({ db, embedder });
    const results = await search({ db, embedder, query: 'бюджет' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const parsed = IndexEntry.safeParse(r);
      if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
      expect(parsed.success).toBe(true);
    }
  });
});
