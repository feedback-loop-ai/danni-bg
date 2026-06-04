import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.ts';
import { datasetView } from '../read/dataset-view.ts';
import { openDb } from '../store/db.ts';
import { DatasetsRepo } from '../store/repos/datasets.ts';

interface MirrorInfoFlags {
  json?: boolean;
}

export function parseFlags(args: string[]): { id: string; flags: MirrorInfoFlags } {
  let id: string | undefined;
  const flags: MirrorInfoFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('danni mirror-info <dataset_id> [--json]\n');
      throw new Error('__HELP__');
    } else if (!a?.startsWith('--')) {
      id = a;
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!id) throw new Error('missing <dataset_id>');
  return { id, flags };
}

export async function run(args: string[]): Promise<number> {
  let id: string;
  let flags: MirrorInfoFlags;
  try {
    const parsed = parseFlags(args);
    id = parsed.id;
    flags = parsed.flags;
  } catch (err) {
    if (err instanceof Error && err.message === '__HELP__') return 0;
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const config = loadConfig();
  const storeRoot = resolve(process.cwd(), config.store.root);
  const db = openDb({ storeRoot, loadVec: false });
  try {
    const dataset = new DatasetsRepo(db).get(id);
    if (!dataset) {
      process.stderr.write(`dataset ${id} not found\n`);
      return 4;
    }
    const view = datasetView(db, dataset.id, config.store.freshnessSloSeconds);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
    } else {
      process.stdout.write(`Dataset: ${view.datasetId}\n`);
      process.stdout.write(`Title: ${view.title.bg}\n`);
      if (view.title.en) process.stdout.write(`Title (en): ${view.title.en}\n`);
      process.stdout.write(`Resources: ${view.resources.length}\n`);
      process.stdout.write(`Entities: ${view.entities.length}\n`);
      process.stdout.write(`Links: ${view.links.length}\n`);
    }
    return 0;
  } finally {
    db.close();
  }
}
