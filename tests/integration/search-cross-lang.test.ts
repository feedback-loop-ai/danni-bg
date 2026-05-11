import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { search } from '../../src/index/query.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';
import { TranslationsRepo } from '../../src/store/repos/translations.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const QUERY_SET_PATH = join(ROOT, 'tests/fixtures/search/query-set.json');

interface QueryEntry {
  query: string;
  lang: 'bg' | 'en';
  expected: string[];
  rationale: string;
}

interface QueryFile {
  queries: QueryEntry[];
}

const CORPUS: Array<{
  id: string;
  titleBg: string;
  descriptionBg: string;
  titleEn: string;
  descriptionEn: string;
}> = [
  {
    id: 'd-budget-sofia-2025',
    titleBg: 'Бюджет на Столична община 2025',
    descriptionBg: 'Подробен общински бюджет на София за 2025.',
    titleEn: 'Budget of Sofia Municipality 2025',
    descriptionEn: 'Detailed municipal budget for Sofia 2025.',
  },
  {
    id: 'd-population-sofia',
    titleBg: 'Население на София и Столична община',
    descriptionBg: 'Статистика на населението на София.',
    titleEn: 'Population of Sofia and Sofia Municipality',
    descriptionEn: 'Sofia population statistics.',
  },
  {
    id: 'd-population-plovdiv',
    titleBg: 'Население на Пловдив',
    descriptionBg: 'Статистика за Пловдив.',
    titleEn: 'Population of Plovdiv',
    descriptionEn: 'Plovdiv statistics.',
  },
  {
    id: 'd-education-2024',
    titleBg: 'Образование 2024',
    descriptionBg: 'Резултати от образование през 2024.',
    titleEn: 'Education 2024',
    descriptionEn: 'Education outcomes in 2024.',
  },
  {
    id: 'd-transport-routes',
    titleBg: 'Транспортни маршрути',
    descriptionBg: 'Линии на градския транспорт.',
    titleEn: 'Transport routes',
    descriptionEn: 'Public transport routes.',
  },
  {
    id: 'd-register-companies',
    titleBg: 'Регистър на търговските дружества',
    descriptionBg: 'Регистър на компаниите.',
    titleEn: 'Register of companies',
    descriptionEn: 'Company register.',
  },
  {
    id: 'd-environment-air',
    titleBg: 'Околна среда — качество на въздуха',
    descriptionBg: 'Екология и атмосферни замърсители.',
    titleEn: 'Environment — air quality',
    descriptionEn: 'Environment and air pollutants.',
  },
  {
    id: 'd-health-spending',
    titleBg: 'Здравеопазване — разходи',
    descriptionBg: 'Разходи в здравеопазването.',
    titleEn: 'Health spending',
    descriptionEn: 'Healthcare spending.',
  },
  {
    id: 'd-geo-boundaries',
    titleBg: 'Граници — geojson',
    descriptionBg: 'Граници в geojson формат.',
    titleEn: 'Boundaries — geojson',
    descriptionEn: 'Boundaries in geojson format.',
  },
];

async function setup(): Promise<{ db: Database; embedder: LocalOnnxEmbedder }> {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, join(ROOT, 'migrations'));
  const datasets = new DatasetsRepo(d);
  const translations = new TranslationsRepo(d);
  for (const c of CORPUS) {
    datasets.upsert({
      id: c.id,
      slug: c.id,
      titleBg: c.titleBg,
      descriptionBg: c.descriptionBg,
      tags: [],
      groups: [],
      sourceUrl: `https://example.org/data/dataset/${c.id}`,
    });
    translations.upsert({
      subjectKind: 'dataset_title',
      subjectId: c.id,
      textBg: c.titleBg,
      textEn: c.titleEn,
      translator: 'local-marianmt:test',
      confidence: 0.8,
    });
    translations.upsert({
      subjectKind: 'dataset_description',
      subjectId: c.id,
      textBg: c.descriptionBg,
      textEn: c.descriptionEn,
      translator: 'local-marianmt:test',
      confidence: 0.8,
    });
  }
  const embedder = new LocalOnnxEmbedder({ dimension: 32 });
  await runIndex({ db: d, embedder });
  return { db: d, embedder };
}

describe('integration.search-cross-lang', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('≥75% of query-set queries surface the expected dataset within top 5 (relaxed threshold for fixture corpus)', async () => {
    const queryFile = JSON.parse(readFileSync(QUERY_SET_PATH, 'utf-8')) as QueryFile;
    let hits = 0;
    let total = 0;
    for (const q of queryFile.queries) {
      total++;
      const results = await search({ db: s.db, embedder: s.embedder, query: q.query, limit: 5 });
      const ids = results.map((r) => r.datasetId);
      const expected = q.expected;
      if (expected.some((eid) => ids.includes(eid))) hits++;
    }
    // SC-004 production target is ≥90% on a real curated corpus. The fixture corpus is small
    // and the embedder is a hash stub, so we settle for ≥75% as a CI smoke threshold.
    const ratio = hits / total;
    expect(ratio).toBeGreaterThanOrEqual(0.75);
  });

  it('every result carries sourceUrl and curatedDatasetPath (FR-013)', async () => {
    const results = await search({ db: s.db, embedder: s.embedder, query: 'бюджет', limit: 3 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.sourceUrl.startsWith('http')).toBe(true);
      expect(r.curatedDatasetPath.length).toBeGreaterThan(0);
    }
  });
});
