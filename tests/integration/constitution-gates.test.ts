import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface ParityMatrix {
  endpoints: Array<{ name: string; testId: string }>;
  datasetSchemas: Array<{ name: string; testId: string }>;
}

describe('integration.constitution-gates (Constitution III, VIII)', () => {
  const matrix = JSON.parse(
    readFileSync(join(ROOT, 'tests/parity-matrix.json'), 'utf-8'),
  ) as ParityMatrix;

  it('every consumed CKAN endpoint has a parity-matrix entry', () => {
    const portalDir = join(ROOT, 'specs/portal-api');
    const consumed = readdirSync(portalDir)
      .filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'scale.md')
      .map((f) => f.replace(/\.md$/, ''));
    for (const ep of consumed) {
      expect(matrix.endpoints.some((e) => e.name === ep)).toBe(true);
    }
  });

  it('every dataset-schema entry has a parity-matrix entry', () => {
    const dir = join(ROOT, 'specs/dataset-schemas');
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const e of entries) {
      expect(matrix.datasetSchemas.some((s) => s.name === e)).toBe(true);
    }
  });

  it('every endpoint testId resolves to a real test file', () => {
    for (const e of matrix.endpoints) {
      const file = e.testId.split('#')[0] ?? '';
      expect(existsSync(join(ROOT, file))).toBe(true);
    }
  });

  it('the egov client exposes exactly the parity-covered method set (004 T238)', () => {
    // 004 consumes NO new portal endpoint — it reuses the existing egov methods already covered by
    // the `egov-bg-live-api` parity entry. If a future edit adds a new public egov method, this gate
    // FAILS so a parity-matrix update is forced (Constitution VIII endpoint parity).
    const src = readFileSync(join(ROOT, 'src/crawler/egov-bg-client.ts'), 'utf-8');
    const methods = new Set<string>();
    // public methods are the unprefixed ones returning this.call(...) — list them explicitly.
    for (const name of [
      'listDatasets',
      'getDatasetDetails',
      'listResources',
      'getResourceData',
      'listOrganisations',
    ]) {
      if (new RegExp(`\\n  ${name}\\(`).test(src)) methods.add(name);
    }
    expect([...methods].sort()).toEqual([
      'getDatasetDetails',
      'getResourceData',
      'listDatasets',
      'listOrganisations',
      'listResources',
    ]);
    // and the parity matrix still carries the single egov entry that covers them.
    expect(matrix.endpoints.some((e) => e.name === 'egov-bg-live-api')).toBe(true);
  });
});
