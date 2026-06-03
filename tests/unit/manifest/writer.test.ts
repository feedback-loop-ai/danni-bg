import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { buildManifest, manifestPath, writeManifest } from '../../../src/manifest/writer.ts';

describe('manifest.writer', () => {
  it('buildManifest pins the manifestVersion', () => {
    const out = buildManifest({
      runId: 'r1',
      trigger: 'manual',
      scopeFilter: {},
      startedAt: '2026-05-08T00:00:00Z',
      endedAt: '2026-05-08T00:01:00Z',
      summaryOutcome: 'success',
      totals: {
        discovered: 0,
        captured: 0,
        skippedUnchanged: 0,
        failed: 0,
        withdrawn: 0,
        outOfScope: 0,
      },
      datasets: [],
    });
    expect(out.manifestVersion).toBe('1.0.0');
  });

  it('manifestPath joins under storeRoot/manifest', () => {
    const p = manifestPath('/tmp/store', '01HABC');
    expect(p.endsWith('/manifest/01HABC.json')).toBe(true);
  });

  it('writeManifest atomically writes and is JSON-parseable', () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const manifest = buildManifest({
      runId: 'rX',
      trigger: 'scheduled',
      scopeFilter: { publishers: ['p1'] },
      startedAt: '2026-05-08T00:00:00Z',
      endedAt: '2026-05-08T00:01:00Z',
      summaryOutcome: 'partial',
      totals: {
        discovered: 1,
        captured: 1,
        skippedUnchanged: 0,
        failed: 0,
        withdrawn: 0,
        outOfScope: 0,
      },
      datasets: [
        {
          datasetId: 'd1',
          sourceUrl: 'https://x/d1',
          outcome: 'captured',
          lifecycleState: 'active',
          capturedAt: '2026-05-08T00:00:30Z',
          resources: [],
        },
      ],
    });
    const path = writeManifest(storeRoot, manifest);
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.runId).toBe('rX');
    expect(parsed.datasets[0].datasetId).toBe('d1');
  });
});
