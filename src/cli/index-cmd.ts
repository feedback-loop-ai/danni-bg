import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.ts';
import type { DanniConfig } from '../config/schema.ts';
import type { Embedder } from '../index/embedder.ts';
import { HostedApiEmbedder } from '../index/embedders/hosted-api.ts';
import { LocalOnnxEmbedder } from '../index/embedders/local-onnx.ts';
import { type RunIndexOptions, runIndex } from '../index/run-index.ts';
import { openDb } from '../store/db.ts';

interface IndexFlags {
  full?: boolean;
  datasets?: string[];
}

/**
 * Resolve the runIndex mode from CLI flags + config (FR-009 precedence:
 * `--full` > `config.index.incremental` > default true). `--full` is a one-shot override and
 * never mutates config.
 */
export function resolveMode(
  flags: IndexFlags,
  index: DanniConfig['index'],
): Omit<RunIndexOptions, 'db' | 'embedder'> {
  return {
    incremental: index.incremental,
    ...(flags.datasets ? { datasetIds: flags.datasets } : {}),
    ...(flags.full ? { full: true } : {}),
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

function buildEmbedder(config: ReturnType<typeof loadConfig>): Embedder {
  const e = config.enrichment.embedder;
  if (e.provider === 'hosted-api') {
    if (!e.endpointUrl) throw new Error('embedder.endpointUrl is required for hosted-api');
    const bearer = e.apiKeyEnv ? process.env[e.apiKeyEnv] : undefined;
    return new HostedApiEmbedder({
      endpointUrl: e.endpointUrl,
      ...(bearer ? { bearer } : {}),
      ...(e.modelId ? { modelId: e.modelId } : {}),
    });
  }
  return new LocalOnnxEmbedder(e.modelId ? { modelId: e.modelId } : {});
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
      embedder: buildEmbedder(config),
      ...resolveMode(flags, config.index),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } finally {
    db.close();
  }
}
