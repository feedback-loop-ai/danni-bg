import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CsvCurator } from '../../../src/curate/csv.ts';
import { ensureDir } from '../../../src/lib/fs.ts';
import type { ResourceRow } from '../../../src/store/repos/resources.ts';

const FIX = fileURLToPath(new URL('../../fixtures/resources/', import.meta.url));

function fakeResource(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'r1',
    dataset_id: 'd1',
    position: 0,
    name: 'r1',
    description_bg: null,
    declared_format: 'csv',
    detected_content_type: null,
    detected_format: null,
    source_url: 'https://example.org/r1.csv',
    bytes: null,
    sha256: null,
    raw_path: null,
    etag: null,
    last_modified: null,
    first_seen_at: '2026-05-08T00:00:00Z',
    last_synced_at: '2026-05-08T00:00:00Z',
    last_outcome: 'success',
    last_failure_reason: null,
    lifecycle_state: 'active',
    ...overrides,
  };
}

describe('curate.csv', () => {
  it('curates a UTF-8 CSV and emits ndjson + schema', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.csv');
    writeFileSync(rawPath, readFileSync(join(FIX, 'csv-utf8.csv')));
    const curator = new CsvCurator();
    const out = await curator.curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('tabular');
    expect(existsSync(join(storeRoot, 'curated', 'd1', 'r1', 'data.ndjson'))).toBe(true);
    expect(existsSync(join(storeRoot, 'curated', 'd1', 'r1', 'schema.json'))).toBe(true);
    const schema = JSON.parse(
      readFileSync(join(storeRoot, 'curated', 'd1', 'r1', 'schema.json'), 'utf-8'),
    );
    expect(schema.kind).toBe('tabular');
    expect(schema.encoding).toBe('utf-8');
    expect(Array.isArray(schema.columns)).toBe(true);
  });

  it('curates CP1251 CSV and records a transform rule', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.csv');
    writeFileSync(rawPath, readFileSync(join(FIX, 'csv-cp1251.csv')));
    const curator = new CsvCurator();
    const out = await curator.curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('tabular');
    expect(out.transformRules.some((r) => r.rule === 'utf8-from-windows1251')).toBe(true);
    const ndjson = readFileSync(join(storeRoot, 'curated', 'd1', 'r1', 'data.ndjson'), 'utf-8');
    expect(ndjson.length).toBeGreaterThan(0);
  });

  it('canHandle returns true for CSV declared format', () => {
    const c = new CsvCurator();
    expect(
      c.canHandle({ storeRoot: '', resource: fakeResource(), rawAbsPath: '', curatorVersion: 'v' }),
    ).toBe(true);
  });

  it('canHandle returns true for .csv URL even without declared format', () => {
    const c = new CsvCurator();
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: null, source_url: 'https://x/file.csv' }),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(true);
  });

  it('canHandle returns false for non-CSV', () => {
    const c = new CsvCurator();
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: 'json', source_url: 'https://x/file.json' }),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(false);
  });

  it('handles semicolon delimited rows', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'semi.csv');
    writeFileSync(rawPath, 'a;b\n1;2\n3;4\n');
    const out = await new CsvCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('tabular');
  });

  it('handles quoted commas', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'q.csv');
    writeFileSync(rawPath, 'a,b\n"hello, world","x"\n');
    const out = await new CsvCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    const ndjson = readFileSync(join(storeRoot, 'curated', 'd1', 'r1', 'data.ndjson'), 'utf-8');
    expect(ndjson).toContain('"hello, world"');
    expect(out.kind).toBe('tabular');
  });
});
