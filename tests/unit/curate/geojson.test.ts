import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeoJsonCurator } from '../../../src/curate/geojson.ts';
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
    declared_format: 'geojson',
    detected_content_type: null,
    detected_format: null,
    source_url: 'https://example.org/r1.geojson',
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

describe('curate.geojson', () => {
  it('curates a feature collection', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'in.geojson');
    writeFileSync(rawPath, readFileSync(join(FIX, 'geojson-sample.geojson')));
    const out = await new GeoJsonCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    expect(out.kind).toBe('geojson');
    const schema = JSON.parse(
      readFileSync(join(storeRoot, 'curated', 'd1', 'r1', 'schema.json'), 'utf-8'),
    );
    expect(schema.rootShape === 'feature_collection' || schema.rootShape === 'feature').toBe(true);
    expect(existsSync(join(storeRoot, 'curated', 'd1', 'r1', 'data.json'))).toBe(true);
  });

  it('curates a single Feature', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'feat.geojson');
    writeFileSync(
      rawPath,
      '{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[0,0]}}',
    );
    const out = await new GeoJsonCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: rawPath,
      curatorVersion: 'test',
    });
    const schema = JSON.parse(
      readFileSync(join(storeRoot, 'curated', 'd1', 'r1', 'schema.json'), 'utf-8'),
    );
    expect(schema.rootShape).toBe('feature');
    expect(out.kind).toBe('geojson');
  });

  it('rejects non-feature root', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const rawDir = join(storeRoot, 'raw', 'd1', 'r1');
    ensureDir(rawDir);
    const rawPath = join(rawDir, 'bad.geojson');
    writeFileSync(rawPath, '{"type":"Polygon"}');
    await expect(
      new GeoJsonCurator().curate({
        storeRoot,
        resource: fakeResource(),
        rawAbsPath: rawPath,
        curatorVersion: 'test',
      }),
    ).rejects.toThrow();
  });

  it('canHandle for geojson', () => {
    const c = new GeoJsonCurator();
    expect(
      c.canHandle({ storeRoot: '', resource: fakeResource(), rawAbsPath: '', curatorVersion: 'v' }),
    ).toBe(true);
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: null, source_url: 'https://x/y.geojson' }),
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
