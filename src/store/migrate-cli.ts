import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/loader.ts';
import { ensureDir } from '../lib/fs.ts';
import { getLogger } from '../logging/logger.ts';
import { runMigrations } from './migrate.ts';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export async function migrateCliMain(argv: string[] = []): Promise<number> {
  const log = getLogger();
  let storeRoot: string;
  try {
    const cfg = loadConfig();
    storeRoot = resolve(process.cwd(), cfg.store.root);
  } catch {
    storeRoot = resolve(process.cwd(), 'store');
  }
  // DANNI_STORE_ROOT (container/deploy override) wins over the config path; an explicit argv wins over both.
  if (process.env.DANNI_STORE_ROOT) storeRoot = resolve(process.cwd(), process.env.DANNI_STORE_ROOT);
  if (argv[0]) storeRoot = resolve(process.cwd(), argv[0]);

  ensureDir(storeRoot);
  const db = new Database(`${storeRoot}/danni.sqlite`, { create: true, readwrite: true });
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    const result = runMigrations(db, resolve(PROJECT_ROOT, 'migrations'));
    log.info('migrations.applied', {
      applied: result.applied.map((m) => `${m.version}_${m.name}`),
      skipped: result.skipped.map((m) => `${m.version}_${m.name}`),
    });
    return 0;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  migrateCliMain(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`migrate failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(4);
    },
  );
}
