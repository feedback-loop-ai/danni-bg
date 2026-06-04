import { describe, expect, it } from 'bun:test';
import { DatasetDetailsResponseSchema } from '../../src/crawler/egov-bg-schema.ts';
import { datasetValidator } from '../../src/crawler/egov-validator.ts';

function details(data: Record<string, unknown>) {
  return DatasetDetailsResponseSchema.parse({
    success: true,
    data: { uri: 'u1', name: 'n', ...data },
  });
}

describe('crawler.egov-validator', () => {
  it('uses updated_at as a stable validator when present', () => {
    const v1 = datasetValidator(details({ updated_at: '2026-06-01 17:00:47' }));
    const v2 = datasetValidator(details({ updated_at: '2026-06-01 17:00:47' }));
    expect(v1).toBe(v2);
    expect(v1.length).toBeGreaterThan(0);
  });

  it('a different updated_at flips the validator', () => {
    expect(datasetValidator(details({ updated_at: '2026-06-01 17:00:47' }))).not.toBe(
      datasetValidator(details({ updated_at: '2026-06-02 09:00:00' })),
    );
  });

  it('version change flips the hash even when updated_at is equal', () => {
    const base = { updated_at: '2026-06-01 17:00:47' };
    expect(datasetValidator(details({ ...base, version: '23.1' }))).not.toBe(
      datasetValidator(details({ ...base, version: '23.2' })),
    );
  });

  it('folding version in does not equal updated_at-only (version is consumed)', () => {
    const base = { updated_at: '2026-06-01 17:00:47' };
    expect(datasetValidator(details(base))).not.toBe(
      datasetValidator(details({ ...base, version: '1.0' })),
    );
  });

  it('both updated_at and version null → deterministic content-hash fallback', () => {
    const d = { name: 'Регистър', descript: 'Описание', org_id: 5, tags: [{ name: 'данни' }] };
    const v1 = datasetValidator(details(d));
    const v2 = datasetValidator(details(d));
    expect(v1).toBe(v2);
    expect(v1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('content-hash fallback is Cyrillic-byte-exact (different titles → different hashes)', () => {
    expect(datasetValidator(details({ name: 'Регистър А' }))).not.toBe(
      datasetValidator(details({ name: 'Регистър Б' })),
    );
  });

  it('content-hash fallback changes when a consumed field changes', () => {
    const a = datasetValidator(details({ name: 'n', descript: 'd1' }));
    const b = datasetValidator(details({ name: 'n', descript: 'd2' }));
    expect(a).not.toBe(b);
  });
});
