import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XmlCurator } from '../../../src/curate/xml.ts';
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
    declared_format: 'xml',
    detected_content_type: null,
    detected_format: null,
    source_url: 'https://example.org/r1.xml',
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

describe('curate.xml', () => {
  it('curates xml and identifies the root element', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.xml');
    writeFileSync(rawPath, readFileSync(join(FIX, 'xml-sample.xml')));
    const out = await new XmlCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('xml');
    const schema = JSON.parse(
      readFileSync(join(storeRoot, 'curated', 'd1', 'r1', 'schema.json'), 'utf-8'),
    );
    expect(typeof schema.rootElement).toBe('string');
    expect(existsSync(join(storeRoot, 'curated', 'd1', 'r1', 'data.xml'))).toBe(true);
  });

  it('falls back to "unknown" root on degenerate xml', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'bad.xml');
    writeFileSync(rawPath, '   ');
    const out = await new XmlCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('xml');
  });

  it('canHandle by format and extension', () => {
    const c = new XmlCurator();
    expect(
      c.canHandle({ storeRoot: '', resource: fakeResource(), rawAbsPath: '', curatorVersion: 'v' }),
    ).toBe(true);
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: null, source_url: 'https://x/y.xml' }),
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
});
