import { join } from 'node:path';
import type { ScopeConfig } from '../config/schema.ts';
import { atomicWriteFile } from '../lib/fs.ts';

export type DatasetOutcome =
  | 'captured'
  | 'skipped_unchanged'
  | 'failed'
  | 'withdrawn'
  | 'out_of_scope';
export type LifecycleState = 'active' | 'withdrawn' | 'out_of_scope';

export interface ManifestResourceEntry {
  resourceId: string;
  sourceUrl: string;
  outcome: DatasetOutcome;
  bytes?: number | undefined;
  sha256?: string | undefined;
  rawPath?: string | undefined;
  declaredFormat?: string | undefined;
  detectedFormat?: string | undefined;
  detectedContentType?: string | undefined;
  etag?: string | undefined;
  lastModified?: string | undefined;
  httpStatus?: number | undefined;
  failureReason?: string | undefined;
}

export interface ManifestDatasetEntry {
  datasetId: string;
  sourceUrl: string;
  outcome: DatasetOutcome;
  lifecycleState: LifecycleState;
  capturedAt: string;
  metadataHash?: string | undefined;
  failureReason?: string | undefined;
  resources: ManifestResourceEntry[];
}

export interface ManifestTotals {
  discovered: number;
  captured: number;
  skippedUnchanged: number;
  failed: number;
  withdrawn: number;
  outOfScope: number;
}

export interface ManifestPayload {
  manifestVersion: '1.0.0';
  runId: string;
  trigger: 'manual' | 'scheduled';
  scopeFilter: ScopeConfig;
  startedAt: string;
  endedAt: string;
  summaryOutcome: 'success' | 'partial' | 'failed';
  totals: ManifestTotals;
  notes?: string;
  datasets: ManifestDatasetEntry[];
}

export function buildManifest(input: Omit<ManifestPayload, 'manifestVersion'>): ManifestPayload {
  return { manifestVersion: '1.0.0', ...input };
}

export function manifestPath(storeRoot: string, runId: string): string {
  return join(storeRoot, 'manifest', `${runId}.json`);
}

export function writeManifest(storeRoot: string, manifest: ManifestPayload): string {
  const path = manifestPath(storeRoot, manifest.runId);
  atomicWriteFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}
