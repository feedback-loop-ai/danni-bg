import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { TranslationsRepo } from '../../../../src/store/repos/translations.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

describe('store.repos.translations', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('insert + findExact + forSubject round trip', () => {
    const repo = new TranslationsRepo(database);
    repo.upsert({
      subjectKind: 'dataset_title',
      subjectId: 'd1',
      textBg: 'Бюджет',
      textEn: 'Budget',
      translator: 'local-marianmt:v1',
      confidence: 0.7,
    });
    expect(repo.findExact('dataset_title', 'd1', 'local-marianmt:v1')?.text_en).toBe('Budget');
    expect(repo.forSubject('dataset_title', 'd1').length).toBe(1);
  });

  it('preserves prior non-empty text_en when next is empty', () => {
    const repo = new TranslationsRepo(database);
    repo.upsert({
      subjectKind: 'dataset_title',
      subjectId: 'd1',
      textBg: 'Бюджет',
      textEn: 'Budget',
      translator: 'local-marianmt:v1',
      confidence: 0.7,
    });
    repo.upsert({
      subjectKind: 'dataset_title',
      subjectId: 'd1',
      textBg: 'Бюджет',
      textEn: '',
      translator: 'local-marianmt:v1',
      confidence: 0.0,
    });
    expect(repo.findExact('dataset_title', 'd1', 'local-marianmt:v1')?.text_en).toBe('Budget');
  });

  it('overwrites with non-empty text_en when changed', () => {
    const repo = new TranslationsRepo(database);
    repo.upsert({
      subjectKind: 'dataset_title',
      subjectId: 'd1',
      textBg: 'Бюджет',
      textEn: 'Budget',
      translator: 'local-marianmt:v1',
      confidence: 0.7,
    });
    repo.upsert({
      subjectKind: 'dataset_title',
      subjectId: 'd1',
      textBg: 'Бюджет',
      textEn: 'Budget v2',
      translator: 'local-marianmt:v1',
      confidence: 0.8,
    });
    expect(repo.findExact('dataset_title', 'd1', 'local-marianmt:v1')?.text_en).toBe('Budget v2');
  });

  it('findById returns null when missing', () => {
    expect(new TranslationsRepo(database).findById(999)).toBeNull();
  });
});
