import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.ts';
import type { DanniConfig } from '../config/schema.ts';
import { buildEmbedder } from '../index/embedders/factory.ts';
import { type RunIndexOptions, runIndex } from '../index/run-index.ts';
import { openDb } from '../store/db.ts';

interface IndexFlags {
  full?: boolean;
  datasets?: string[];
}

/**
 * Resolve the runIndex mode from CLI flags + config (FR-009 precedence:
 * `--full` > `config.index.incremental` > default true). `--full` is a one-shot override and
 * never mutates config. The embedder batch sizes (002, FR-002) are threaded from config into the
 * loop (resolved to `effectiveBatchSize` inside it alongside the provider cap) — NOT into the
 * provider constructor.
 */
export function resolveMode(
  flags: IndexFlags,
  index: DanniConfig['index'],
  embedder?: DanniConfig['enrichment']['embedder'],
): Omit<RunIndexOptions, 'db' | 'embedder'> {
  return {
    incremental: index.incremental,
    ...(flags.datasets ? { datasetIds: flags.datasets } : {}),
    ...(flags.full ? { full: true } : {}),
    ...(embedder ? { batchSize: embedder.batchSize } : {}),
    ...(embedder?.maxBatchSize != null ? { maxBatchSize: embedder.maxBatchSize } : {}),
  };
}

export function parseFlags(args: string[]): IndexFlags {
  const flags: IndexFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--full') {
      flags.full = true;
    } else if (a === '--datasets') {
      const v = args[i + 1];
      if (!v) throw new Error('--datasets requires a comma-separated value');
      flags.datasets = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write('danni index [--full] [--datasets <id1,id2,...>]\n');
      throw new Error('__HELP__');
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return flags;
}

export async function run(args: string[]): Promise<number> {
  let flags: IndexFlags;
  try {
    flags = parseFlags(args);
  } catch (err) {
    if (err instanceof Error && err.message === '__HELP__') return 0;
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const config = loadConfig();
  const storeRoot = resolve(process.cwd(), config.store.root);
  const db = openDb({ storeRoot, loadVec: false });
  try {
    const result = await runIndex({
      db,
      embedder: buildEmbedder(config.enrichment.embedder),
      ...resolveMode(flags, config.index, config.enrichment.embedder),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } finally {
    db.close();
  }
}
