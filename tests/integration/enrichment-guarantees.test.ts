import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCurate } from '../../src/curate/run-curate.ts';
import { LocalMarianMtTranslator } from '../../src/enrich/translators/local-marianmt.ts';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { searchByEntity } from '../../src/index/query.ts';
import { ensureDir } from '../../src/lib/fs.ts';
import { openDb } from '../../src/store/db.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';
import { OrganizationsRepo } from '../../src/store/repos/organizations.ts';
import { ResourcesRepo } from '../../src/store/repos/resources.ts';
import { TranslationsRepo } from '../../src/store/repos/translations.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOFIA_ENTITY = 'geo:bg-municipality-sofia';

interface Seed {
  id: string;
  titleBg: string;
  descriptionBg: string | null;
  publisherId: string | null;
  tags: string[];
}

// A representative corpus: most datasets carry a publisher (→ organization
// entity, confidence 1.0) and/or a gazetteer-matchable place; one dataset
// (d12) is deliberately metadata-bare so it produces zero entities — making
// the SC-009 ratio a real threshold rather than a trivial 100%.
const CORPUS: Seed[] = [
  // SC-011 cohort: three datasets that name "Столична община" (Sofia).
  {
    id: 'd01',
    titleBg: 'Бюджет на Столична община 2025',
    descriptionBg: 'Разходи по дейности.',
    publisherId: 'org-sofia',
    tags: ['финанси'],
  },
  {
    id: 'd02',
    titleBg: 'Регистър на детските градини — Столична община',
    descriptionBg: 'Капацитет и адреси.',
    publisherId: 'org-sofia',
    tags: ['образование'],
  },
  {
    id: 'd03',
    titleBg: 'Паркинги, стопанисвани от Столична община',
    descriptionBg: 'Зони и тарифи.',
    publisherId: 'org-sofia',
    tags: ['транспорт'],
  },
  // Plovdiv + Varna cohorts.
  {
    id: 'd04',
    titleBg: 'Бюджет на Община Пловдив',
    descriptionBg: 'Приходи и разходи.',
    publisherId: 'org-plovdiv',
    tags: ['финанси'],
  },
  {
    id: 'd05',
    titleBg: 'Зелени площи в Община Пловдив',
    descriptionBg: 'Поддръжка на паркове.',
    publisherId: 'org-plovdiv',
    tags: [],
  },
  {
    id: 'd06',
    titleBg: 'Морски плажове — Община Варна',
    descriptionBg: 'Концесии и достъп.',
    publisherId: 'org-varna',
    tags: [],
  },
  // Org-only datasets (entity via publisher, no geography).
  {
    id: 'd07',
    titleBg: 'Обществени поръчки 2024',
    descriptionBg: 'Сключени договори.',
    publisherId: 'org-sofia',
    tags: ['поръчки'],
  },
  {
    id: 'd08',
    titleBg: 'Декларации по ЗПКОНПИ',
    descriptionBg: null,
    publisherId: 'org-sofia',
    tags: [],
  },
  {
    id: 'd09',
    titleBg: 'Регистър на културните институции',
    descriptionBg: 'Музеи и галерии.',
    publisherId: 'org-plovdiv',
    tags: [],
  },
  {
    id: 'd10',
    titleBg: 'Списък на читалищата',
    descriptionBg: null,
    publisherId: 'org-varna',
    tags: [],
  },
  {
    id: 'd11',
    titleBg: 'Регистър на спортните клубове',
    descriptionBg: 'Лицензирани клубове.',
    publisherId: 'org-sofia',
    tags: [],
  },
  // Metadata-bare: no publisher, no tags, no place, no dates → zero entities.
  {
    id: 'd12',
    titleBg: 'Архивен опис на неструктурирани материали',
    descriptionBg: 'Несвързан списък.',
    publisherId: null,
    tags: [],
  },
];

const SOFIA_COHORT = ['d01', 'd02', 'd03'];

describe('integration.enrichment-guarantees (SC-009/SC-010/SC-011)', () => {
  let db: Database;
  let storeRoot: string;

  beforeEach(async () => {
    storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    seedCorpus(db, storeRoot);
    await runCurate({
      db,
      storeRoot,
      curatorVersion: 'enrich-1',
      translator: new LocalMarianMtTranslator({
        translateFn: async (text) => ({ text: `EN: ${text}`, confidence: 0.8 }),
      }),
    });
  });
  afterEach(() => {
    db.close();
  });

  it('SC-009: ≥90% of curated datasets carry at least one entity', () => {
    const curated = curatedDatasetIds(db);
    expect(curated.length).toBeGreaterThanOrEqual(10); // representative sample

    const withEntity = curated.filter(
      (id) =>
        (db
          .query<{ n: number }, [string]>(
            'SELECT COUNT(*) AS n FROM dataset_entities WHERE dataset_id = ?',
          )
          .get(id)?.n ?? 0) > 0,
    );
    const ratio = withEntity.length / curated.length;
    expect(ratio).toBeGreaterThanOrEqual(0.9);

    // Every dataset with a publisher must carry ≥1 entity (the organization extractor).
    for (const seed of CORPUS.filter((s) => s.publisherId)) {
      expect(withEntity).toContain(seed.id);
    }
  });

  it('SC-010: ≥95% of curated datasets have a non-empty EN title with the BG original preserved byte-exact', () => {
    const curated = curatedDatasetIds(db);
    const datasets = new DatasetsRepo(db);
    const translations = new TranslationsRepo(db);

    let satisfied = 0;
    for (const id of curated) {
      const ds = datasets.get(id);
      const tx = translations.forSubject('dataset_title', id)[0];
      // Every curated dataset must carry a title translation row — a missing one
      // would otherwise silently depress the ratio instead of failing loudly.
      expect(ds).not.toBeNull();
      expect(tx).toBeDefined();
      if (!ds || !tx) continue;
      // Original Bulgarian preserved byte-exact (Principle X, FR-019c).
      expect(tx.text_bg).toBe(ds.title_bg);
      if (tx.text_en.length > 0) satisfied++;
    }
    expect(satisfied / curated.length).toBeGreaterThanOrEqual(0.95);
  });

  it('SC-011: querying by a known municipality recovers every dataset linked to it', async () => {
    const results = await searchByEntity(
      { db, embedder: new LocalOnnxEmbedder({ dimension: 8 }), query: '' },
      SOFIA_ENTITY,
    );
    expect(results.map((r) => r.datasetId).sort()).toEqual(SOFIA_COHORT);

    // The shared municipality must materialize cross-dataset links across the
    // whole cohort (C(3,2) = 3 undirected pairs), each via the Sofia entity.
    const linkCount =
      db
        .query<{ n: number }, [string]>(
          'SELECT COUNT(*) AS n FROM dataset_links WHERE via_entity_id = ?',
        )
        .get(SOFIA_ENTITY)?.n ?? 0;
    expect(linkCount).toBe(3);
  });
});

function curatedDatasetIds(db: Database): string[] {
  return db
    .query<{ dataset_id: string }, []>(
      "SELECT DISTINCT dataset_id FROM curated_artifacts WHERE kind != 'uncurated' ORDER BY dataset_id",
    )
    .all()
    .map((r) => r.dataset_id);
}

function seedCorpus(db: Database, storeRoot: string): void {
  const orgs = new OrganizationsRepo(db);
  for (const [id, titleBg, slug] of [
    ['org-sofia', 'Столична община', 'sofia'],
    ['org-plovdiv', 'Община Пловдив', 'plovdiv'],
    ['org-varna', 'Община Варна', 'varna'],
  ] as const) {
    orgs.upsert({ id, slug, titleBg, sourceUrl: `https://example.org/org/${slug}` });
  }

  const datasets = new DatasetsRepo(db);
  const resources = new ResourcesRepo(db);
  for (const seed of CORPUS) {
    datasets.upsert({
      id: seed.id,
      slug: seed.id,
      titleBg: seed.titleBg,
      descriptionBg: seed.descriptionBg,
      publisherId: seed.publisherId,
      tags: seed.tags,
      groups: [],
      sourceUrl: `https://example.org/data/dataset/${seed.id}`,
    });
    const rid = `${seed.id}-r1`;
    const rawPath = join(seed.id, rid, 'raw.csv');
    resources.upsert({
      id: rid,
      datasetId: seed.id,
      sourceUrl: `https://example.org/data/${rid}.csv`,
      declaredFormat: 'csv',
      name: 'данни',
    });
    resources.recordCapture({
      id: rid,
      bytes: 8,
      sha256: 'c'.repeat(64),
      rawPath,
      outcome: 'success',
    });
    ensureDir(join(storeRoot, 'raw', seed.id, rid));
    writeFileSync(join(storeRoot, 'raw', seed.id, rid, 'raw.csv'), 'a,b\n1,2\n');
  }
}
