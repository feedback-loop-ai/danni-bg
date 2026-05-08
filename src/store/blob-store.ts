import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ensureDir } from '../lib/fs.ts';

const FORMAT_TO_EXT: Record<string, string> = {
  csv: 'csv',
  json: 'json',
  geojson: 'geojson',
  xml: 'xml',
  xlsx: 'xlsx',
  xls: 'xls',
  pdf: 'pdf',
  zip: 'zip',
  txt: 'txt',
  ndjson: 'ndjson',
};

export function extForFormat(declared: string | null | undefined): string {
  if (!declared) return 'bin';
  const f = declared.toLowerCase();
  const fallback = f.replace(/[^a-z0-9]+/g, '').slice(0, 8);
  return FORMAT_TO_EXT[f] ?? (fallback || 'bin');
}

export interface BlobStoreOptions {
  storeRoot: string;
}

export interface PutOptions {
  datasetId: string;
  resourceId: string;
  declaredFormat?: string | null | undefined;
  sha256: string;
  bytes: number;
  tempPath: string;
}

export interface PutResult {
  sha256: string;
  bytes: number;
  relPath: string;
  absPath: string;
  reused: boolean;
}

export class BlobStore {
  private readonly rawRoot: string;

  constructor(opts: BlobStoreOptions) {
    this.rawRoot = join(opts.storeRoot, 'raw');
  }

  pathFor(datasetId: string, resourceId: string, sha256: string, declaredFormat?: string | null): string {
    const ext = extForFormat(declaredFormat);
    return join(this.rawRoot, datasetId, resourceId, `${sha256}.${ext}`);
  }

  exists(datasetId: string, resourceId: string, sha256: string, declaredFormat?: string | null): boolean {
    return existsSync(this.pathFor(datasetId, resourceId, sha256, declaredFormat));
  }

  /** Atomically place a temp file into the content-addressed location. Reuses existing if hashes match. */
  put(opts: PutOptions): PutResult {
    const target = this.pathFor(opts.datasetId, opts.resourceId, opts.sha256, opts.declaredFormat);
    const relPath = relative(this.rawRoot, target);

    if (existsSync(target)) {
      const stat = statSync(target);
      if (stat.size === opts.bytes) {
        try {
          unlinkSync(opts.tempPath);
        } catch {
          // best-effort cleanup
        }
        return { sha256: opts.sha256, bytes: opts.bytes, relPath, absPath: target, reused: true };
      }
    }

    ensureDir(join(this.rawRoot, opts.datasetId, opts.resourceId));
    renameSync(opts.tempPath, target);
    return { sha256: opts.sha256, bytes: opts.bytes, relPath, absPath: target, reused: false };
  }
}
