import { describe, expect, it } from 'bun:test';
import { UncuratedMarker } from '../../../src/curate/uncurated.ts';
import type { ResourceRow } from '../../../src/store/repos/resources.ts';

function fakeResource(): ResourceRow {
  return {
    id: 'r1',
    dataset_id: 'd1',
    position: 0,
    name: null,
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
  };
}

describe('curate.uncurated', () => {
  it('returns an uncurated artifact with reason', async () => {
    const m = new UncuratedMarker('no curator');
    const out = await m.curate({
      storeRoot: '/tmp',
      resource: fakeResource(),
      rawAbsPath: '/tmp/x',
      curatorVersion: 'v',
    });
    expect(out.kind).toBe('uncurated');
    expect(out.uncuratedReason).toContain('no curator');
  });

  it('canHandle is unconditionally true', () => {
    expect(
      new UncuratedMarker('reason').canHandle({
        storeRoot: '',
        resource: fakeResource(),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(true);
  });
});
