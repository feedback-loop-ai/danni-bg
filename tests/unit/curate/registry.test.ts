import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CuratorRegistry } from '../../../src/curate/registry.ts';
import { UncuratedMarker } from '../../../src/curate/uncurated.ts';
import { ensureDir } from '../../../src/lib/fs.ts';
import type { ResourceRow } from '../../../src/store/repos/resources.ts';

function fakeResource(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'r1',
    dataset_id: 'd1',
    position: 0,
    name: 'r1',
    description_bg: null,
    declared_format: null,
    detected_content_type: null,
    detected_format: null,
    source_url: 'https://example.org/r1',
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

describe('curate.registry', () => {
  it('selects the CSV curator for a CSV resource', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.csv');
    writeFileSync(rawPath, 'a,b\n1,2\n');
    const reg = new CuratorRegistry();
    const c = await reg.select({
      storeRoot,
      resource: fakeResource({ declared_format: 'csv' }),
      rawAbsPath: rawPath,
      curatorVersion: 'v',
    });
    expect(c.kind).toBe('tabular');
  });

  it('selects the JSON curator', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.json');
    writeFileSync(rawPath, '[1,2]');
    const c = await new CuratorRegistry().select({
      storeRoot,
      resource: fakeResource({ declared_format: 'json' }),
      rawAbsPath: rawPath,
      curatorVersion: 'v',
    });
    expect(c.kind).toBe('json');
  });

  it('falls through to text/uncurated when no curator matches confidently', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.bin');
    writeFileSync(rawPath, Buffer.from([0x00, 0x01, 0x02]));
    const c = await new CuratorRegistry().select({
      storeRoot,
      resource: fakeResource({ declared_format: 'pdf' }),
      rawAbsPath: rawPath,
      curatorVersion: 'v',
    });
    // Either text or uncurated is acceptable
    expect(['text', 'uncurated']).toContain(c.kind);
  });

  it('curate() returns the artifact output', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.json');
    writeFileSync(rawPath, '{"a":1}');
    const out = await new CuratorRegistry().curate({
      storeRoot,
      resource: fakeResource({ declared_format: 'json' }),
      rawAbsPath: rawPath,
      curatorVersion: 'v',
    });
    expect(out.kind).toBe('json');
  });

  it('uses provided fallback when nothing matches', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const reg = new CuratorRegistry({ fallback: new UncuratedMarker('test-only') });
    const c = await reg.select({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: join(storeRoot, 'missing.bin'),
      curatorVersion: 'v',
    });
    // Even with a missing file, text/uncurated will be chosen.
    expect(['text', 'uncurated']).toContain(c.kind);
  });
});
