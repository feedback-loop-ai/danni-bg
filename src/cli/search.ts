import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.ts';
import type { Embedder } from '../index/embedder.ts';
import { HostedApiEmbedder } from '../index/embedders/hosted-api.ts';
import { LocalOnnxEmbedder } from '../index/embedders/local-onnx.ts';
import { search } from '../index/query.ts';
import { openDb } from '../store/db.ts';

interface SearchFlags {
  query?: string;
  lang?: 'auto' | 'bg' | 'en';
  limit?: number;
  json?: boolean;
}

export function parseFlags(args: string[]): SearchFlags {
  const flags: SearchFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--lang') {
      const v = args[i + 1];
      if (v !== 'auto' && v !== 'bg' && v !== 'en') throw new Error('--lang must be auto|bg|en');
      flags.lang = v;
      i++;
    } else if (a === '--limit') {
      const v = Number.parseInt(args[i + 1] ?? '', 10);
      if (!Number.isFinite(v) || v < 1 || v > 50) throw new Error('--limit must be 1..50');
      flags.limit = v;
      i++;
    } else if (a === '--json') {
      flags.json = true;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write('danni search "<query>" [--lang auto|bg|en] [--limit N] [--json]\n');
      throw new Error('__HELP__');
    } else if (!a?.startsWith('--')) {
      flags.query = (flags.query ? `${flags.query} ` : '') + a;
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!flags.query) throw new Error('missing query');
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
  const embedder = new LocalOnnxEmbedder(e.modelId ? { modelId: e.modelId } : {});
  if (embedder.isStub) {
    process.stderr.write(
      `warning: embedder provider 'local-onnx' is a deterministic hash stub (${embedder.id}) — semantic ranking is NOT meaningful; only the FTS/keyword leg is real. Set enrichment.embedder.provider='hosted-api' for genuine semantic vectors.\n`,
    );
  }
  return embedder;
}

export async function run(args: string[]): Promise<number> {
  let flags: SearchFlags;
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
    const embedder = buildEmbedder(config);
    const results = await search({
      db,
      embedder,
      query: flags.query as string,
      ...(flags.lang ? { lang: flags.lang } : {}),
      ...(flags.limit ? { limit: flags.limit } : {}),
      freshnessSloSeconds: config.store.freshnessSloSeconds,
    });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } else {
      for (const r of results) {
        process.stdout.write(
          `${r.score.toFixed(4)}  ${r.matchKind}  ${r.datasetId}  ${r.title.bg}\n`,
        );
      }
    }
    return 0;
  } finally {
    db.close();
  }
}
