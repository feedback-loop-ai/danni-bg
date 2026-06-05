// Explorer API entrypoint (T015 bootstrap). Thin, logic-free wiring: load config, open the store,
// build the read bridge + crosswalk, and serve the Hono app. Like src/cli/*, this bootstrap is
// exercised by running it / E2E rather than unit coverage (its routes are covered by app.test.ts).

import { resolve } from 'node:path';
import { Crosswalk } from '../../../packages/geo-boundaries/src/crosswalk.ts';
import { loadCrosswalk } from '../../../packages/geo-boundaries/src/load.ts';
import { loadConfig } from '../../../src/config/loader.ts';
import { buildEmbedder } from '../../../src/index/embedders/factory.ts';
import { openDb } from '../../../src/store/db.ts';
import { type AppContext, type HealthInfo, createApp } from './app.ts';
import { log } from './logging.ts';
import { ReadBridge } from './read-bridge.ts';

export function buildHealth(db: import('bun:sqlite').Database, sloSeconds: number): HealthInfo {
  const row = db
    .query<{ last: string | null }, []>('SELECT MAX(last_synced_at) AS last FROM datasets')
    .get();
  const lastSyncedAt = row?.last ?? null;
  const ageMs = lastSyncedAt ? Date.parse(lastSyncedAt) : Number.NaN;
  const isStale = !lastSyncedAt || (Date.now() - ageMs) / 1000 > sloSeconds;
  const defaultProvider = process.env.EXPLORER_DEFAULT_PROVIDER ? 'configured' : 'absent';
  return { lastSyncedAt, isStale, defaultProvider };
}

export function main(): void {
  const config = loadConfig();
  const storeRoot = resolve(process.cwd(), config.store.root);
  const db = openDb({ storeRoot, loadVec: false });
  const slo = config.store.freshnessSloSeconds;
  const ctx: AppContext = {
    bridge: new ReadBridge({
      db,
      storeRoot,
      embedder: buildEmbedder(config.enrichment.embedder),
      freshnessSloSeconds: slo,
    }),
    crosswalk: new Crosswalk(loadCrosswalk()),
    health: () => buildHealth(db, slo),
  };
  const app = createApp(ctx);
  const port = Number.parseInt(process.env.EXPLORER_API_PORT ?? '8790', 10);
  log.info('explorer_api_listening', { port });
  Bun.serve({ port, fetch: app.fetch });
}

if (import.meta.main) main();
