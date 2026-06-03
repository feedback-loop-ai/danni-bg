import type { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempPath } from '../lib/fs.ts';
import type { BlobStore } from '../store/blob-store.ts';
import { type ResourceRow, ResourcesRepo } from '../store/repos/resources.ts';
import type { PortalHttp } from './http.ts';

export type ResourceCaptureOutcome =
  | {
      kind: 'captured';
      bytes: number;
      sha256: string;
      rawPath: string;
      etag?: string | undefined;
      lastModified?: string | undefined;
      httpStatus: number;
    }
  | { kind: 'skipped_unchanged'; httpStatus: number }
  | { kind: 'failed'; reason: string; httpStatus?: number | undefined };

export interface CaptureResourceOptions {
  db: Database;
  http: PortalHttp;
  blobStore: BlobStore;
  storeRoot: string;
}

export async function captureResource(
  opts: CaptureResourceOptions,
  resource: ResourceRow,
): Promise<ResourceCaptureOutcome> {
  const repo = new ResourcesRepo(opts.db);
  const target = join(opts.storeRoot, 'raw', resource.dataset_id, resource.id, 'pending.bin');
  const tmp = tempPath(target);

  try {
    const dl = await opts.http.download(resource.source_url, tmp, {
      etag: resource.etag,
      lastModified: resource.last_modified,
    });

    if (dl.notModified) {
      repo.recordOutcome(resource.id, 'skipped_unchanged');
      return { kind: 'skipped_unchanged', httpStatus: dl.status };
    }

    if (dl.sha256 && dl.bytes !== undefined && dl.tempPath) {
      // hash matches a prior capture? blob-store reuses
      const placed = opts.blobStore.put({
        datasetId: resource.dataset_id,
        resourceId: resource.id,
        declaredFormat: resource.declared_format,
        sha256: dl.sha256,
        bytes: dl.bytes,
        tempPath: dl.tempPath,
      });
      const etag = dl.etag ?? null;
      const lastModified = dl.lastModified ?? null;
      repo.recordCapture({
        id: resource.id,
        bytes: placed.bytes,
        sha256: placed.sha256,
        rawPath: placed.relPath,
        detectedContentType: dl.contentType ?? null,
        etag,
        lastModified,
        outcome: 'success',
      });
      const out: ResourceCaptureOutcome = {
        kind: 'captured',
        bytes: placed.bytes,
        sha256: placed.sha256,
        rawPath: placed.relPath,
        httpStatus: dl.status,
      };
      if (etag) out.etag = etag;
      if (lastModified) out.lastModified = lastModified;
      return out;
    }
    return { kind: 'failed', reason: 'incomplete download' };
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best effort
    }
    const reason = err instanceof Error ? err.message : String(err);
    repo.recordOutcome(resource.id, 'failure', reason);
    return { kind: 'failed', reason };
  }
}
