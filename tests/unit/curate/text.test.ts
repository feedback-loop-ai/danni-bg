import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextCurator } from '../../../src/curate/text.ts';
import { ensureDir } from '../../../src/lib/fs.ts';
import type { ResourceRow } from '../../../src/store/repos/resources.ts';

function fakeResource(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'r1',
    dataset_id: 'd1',
    position: 0,
    name: 'r1',
    description_bg: null,
    declared_format: 'txt',
    detected_content_type: null,
    detected_format: null,
    source_url: 'https://example.org/r1.txt',
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

describe('curate.text', () => {
  it('decodes UTF-8 text and emits data.txt', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'a.txt');
    writeFileSync(rawPath, 'hello world');
    const out = await new TextCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('text');
    expect(existsSync(join(storeRoot, 'curated', 'd1', 'r1', 'data.txt'))).toBe(true);
  });

  it('canHandle returns true for any input', () => {
    expect(
      new TextCurator().canHandle({
        storeRoot: '',
        resource: fakeResource(),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(true);
  });

  it('decodes cp1251 and records the transform rule', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'cp.txt');
    writeFileSync(rawPath, Buffer.from([0xc1, 0xfe, 0xe4, 0xe6, 0xe5, 0xf2]));
    const out = await new TextCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.transformRules.some((r) => r.rule === 'utf8-from-windows1251')).toBe(true);
    const text = readFileSync(join(storeRoot, 'curated', 'd1', 'r1', 'data.txt'), 'utf-8');
    expect(text).toBe('Бюджет');
  });
});
