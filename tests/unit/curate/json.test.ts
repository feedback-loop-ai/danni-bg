import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonCurator } from '../../../src/curate/json.ts';
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
    declared_format: 'json',
    detected_content_type: null,
    detected_format: null,
    source_url: 'https://example.org/r1.json',
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

describe('curate.json', () => {
  it('curates a JSON array', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.json');
    writeFileSync(rawPath, readFileSync(join(FIX, 'json-array.json')));
    const out = await new JsonCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('json');
    const schema = JSON.parse(
      readFileSync(join(storeRoot, 'curated', 'd1', 'r1', 'schema.json'), 'utf-8'),
    );
    expect(schema.rootShape).toBe('array');
    expect(existsSync(join(storeRoot, 'curated', 'd1', 'r1', 'data.json'))).toBe(true);
  });

  it('curates a JSON object', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'obj.json');
    writeFileSync(rawPath, '{"a":1}');
    const out = await new JsonCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('json');
  });

  it('throws on malformed JSON', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'bad.json');
    writeFileSync(rawPath, 'not json');
    await expect(
      new JsonCurator().curate({
        storeRoot,
        resource: fakeResource(),
        rawAbsPath: rawPath,
        curatorVersion: 'test',
      }),
    ).rejects.toThrow();
  });

  it('canHandle for json/jsonl/ndjson', () => {
    const c = new JsonCurator();
    expect(
      c.canHandle({ storeRoot: '', resource: fakeResource(), rawAbsPath: '', curatorVersion: 'v' }),
    ).toBe(true);
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: 'jsonl' }),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(true);
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: null, source_url: 'https://x/file.json' }),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(true);
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: 'csv', source_url: 'https://x/y.csv' }),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(false);
  });

  it('records utf8-from-windows1251 transform rule when bytes need decoding', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'cp.json');
    // CP1251 bytes that can't be valid UTF-8: 0xc1 0xfe high-bit cyrillic block
    writeFileSync(rawPath, Buffer.from([0xc1, 0xfe]));
    // The decode produces "Бю" which won't parse as JSON
    await expect(
      new JsonCurator().curate({
        storeRoot,
        resource: fakeResource(),
        rawAbsPath: rawPath,
        curatorVersion: 'test',
      }),
    ).rejects.toThrow();
  });
});
