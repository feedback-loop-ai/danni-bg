import type { Database } from 'bun:sqlite';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { TranslationsRepo } from '../../../src/store/repos/translations.ts';

export interface CrossLangDoc {
  id: string;
  titleBg: string;
  descriptionBg: string;
  titleEn: string;
  descriptionEn: string;
}

/**
 * The small bilingual corpus the committed query set (`query-set.json`) is written against. Shared
 * by the cross-lingual search test and the eval CI smoke so the corpus and the query set never
 * drift apart. Each doc has BG originals + an EN translation, mirroring a curated dataset.
 */
export const CROSS_LANG_CORPUS: CrossLangDoc[] = [
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

/** Upsert the corpus (datasets + BG/EN translations) into a migrated db. Caller runs the index. */
export function seedCrossLangCorpus(db: Database): void {
  const datasets = new DatasetsRepo(db);
  const translations = new TranslationsRepo(db);
  for (const c of CROSS_LANG_CORPUS) {
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
}
