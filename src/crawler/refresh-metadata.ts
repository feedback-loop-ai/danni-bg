// Metadata-only refresh (no resource re-download). Re-fetches each dataset's portal details and
// updates only its source timestamps (created_at/updated_at → metadata_created/metadata_modified)
// plus last_synced_at. This is the cheap path to backfill freshness for the existing mirror — the
// full re-crawl (reset checkpoint + re-capture ~30k resources) is the heavy alternative.

import { nowIso } from '../lib/time.ts';
import { withContext } from '../logging/logger.ts';
import type { DatasetsRepo } from '../store/repos/datasets.ts';

/** The slice of the egov client this needs — kept minimal so tests can stub it. */
export interface DatasetDetailFetcher {
  getDatasetDetails(
    datasetUri: string,
    locale?: string,
  ): Promise<{
    data?: {
      created_at?: string | null | undefined;
      updated_at?: string | null | undefined;
    } | null;
  } | null>;
}

export interface RefreshMetadataOptions {
  repo: DatasetsRepo;
  client: DatasetDetailFetcher;
  /** Restrict to these dataset ids; defaults to every active dataset in the mirror. */
  datasetIds?: string[];
  /** Injectable clock (testing). */
  now?: () => string;
}

export interface RefreshMetadataResult {
  total: number;
  refreshed: number;
  failed: number;
}

export async function refreshMetadata(
  opts: RefreshMetadataOptions,
): Promise<RefreshMetadataResult> {
  const log = withContext({ component: 'refresh-metadata' });
  const now = opts.now ?? nowIso;
  const ids = opts.datasetIds ?? opts.repo.listActive().map((d) => d.id);
  let refreshed = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const det = await opts.client.getDatasetDetails(id);
      const data = det?.data ?? null;
      opts.repo.updateMetadata(id, {
        metadataCreated: data?.created_at ?? null,
        metadataModified: data?.updated_at ?? null,
        lastSyncedAt: now(),
      });
      refreshed += 1;
    } catch (err) {
      failed += 1;
      log.warn('refresh-metadata.failed', {
        datasetId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  log.info('refresh-metadata.completed', { total: ids.length, refreshed, failed });
  return { total: ids.length, refreshed, failed };
}
