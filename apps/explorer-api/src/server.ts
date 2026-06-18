// Explorer API entrypoint (T015 bootstrap). Thin, logic-free wiring: load config, open the store,
// build the read bridge + crosswalk, and serve the Hono app. Like src/cli/*, this bootstrap is
// exercised by running it / E2E rather than unit coverage (its routes are covered by app.test.ts).

import { resolve } from 'node:path';
import { serveStatic } from 'hono/bun';
import { Crosswalk } from '../../../packages/geo-boundaries/src/crosswalk.ts';
import { loadCrosswalk } from '../../../packages/geo-boundaries/src/load.ts';
import { loadConfig } from '../../../src/config/loader.ts';
import { buildEmbedder } from '../../../src/index/embedders/factory.ts';
import { openDb } from '../../../src/store/db.ts';
import { PlatformSettingsRepo } from '../../../src/store/repos/platform-settings.ts';
import { UsersRepo } from '../../../src/store/repos/users.ts';
import { resolveServerDefault } from './admin/resolve-default.ts';
import { LLM_SETTING_KEY } from './admin/settings-schema.ts';
import { type AppContext, type HealthInfo, createApp } from './app.ts';
import { serverDefaultFromEnv } from './chat/providers.ts';
import { log } from './logging.ts';
import { ReadBridge } from './read-bridge.ts';

const SPA_ROOT = './apps/explorer-web/dist';

export function buildHealth(
  db: import('bun:sqlite').Database,
  sloSeconds: number,
  settings: PlatformSettingsRepo,
): HealthInfo {
  const row = db
    .query<{ last: string | null }, []>('SELECT MAX(last_synced_at) AS last FROM datasets')
    .get();
  const lastSyncedAt = row?.last ?? null;
  const ageMs = lastSyncedAt ? Date.parse(lastSyncedAt) : Number.NaN;
  const isStale = !lastSyncedAt || (Date.now() - ageMs) / 1000 > sloSeconds;
  // Resolved from settings (admin-configured) else the env seed — matches what the chat will use.
  const defaultProvider = resolveServerDefault(settings, process.env) ? 'configured' : 'absent';
  return { lastSyncedAt, isStale, defaultProvider };
}

/** Seed the LLM default from EXPLORER_DEFAULT_* on first run; afterwards the settings store is authoritative. */
export function seedSettings(settings: PlatformSettingsRepo): void {
  if (settings.get(LLM_SETTING_KEY) != null) return;
  const env = serverDefaultFromEnv(process.env);
  if (env) {
    settings.set(LLM_SETTING_KEY, {
      kind: env.kind,
      model: env.model,
      baseUrl: env.baseUrl ?? null,
      apiKey: env.apiKey ?? null,
    });
  }
}

export function main(): void {
  const config = loadConfig();
  const storeRoot = resolve(process.cwd(), config.store.root);
  const db = openDb({ storeRoot, loadVec: false });
  const slo = config.store.freshnessSloSeconds;
  const settings = new PlatformSettingsRepo(db);
  seedSettings(settings);
  const ctx: AppContext = {
    bridge: new ReadBridge({
      db,
      storeRoot,
      embedder: buildEmbedder(config.enrichment.embedder),
      freshnessSloSeconds: slo,
    }),
    crosswalk: new Crosswalk(loadCrosswalk()),
    health: () => buildHealth(db, slo, settings),
    users: new UsersRepo(db),
    settings,
    kratosPublicUrl: process.env.KRATOS_PUBLIC_URL ?? 'http://localhost:14433',
  };
  const app = createApp(ctx);
  // Serve the built SPA (production); in dev the Vite server proxies /api here instead (T068).
  app.use('/*', serveStatic({ root: SPA_ROOT }));
  app.get('*', serveStatic({ path: `${SPA_ROOT}/index.html` }));
  const port = Number.parseInt(process.env.EXPLORER_API_PORT ?? '8790', 10);
  log.info('explorer_api_listening', { port });
  // Bun's default idleTimeout is 10s — too short for streaming chat where a large model can take
  // longer than that to emit its first token. Use the max (255s) so SSE connections aren't dropped.
  Bun.serve({ port, fetch: app.fetch, idleTimeout: 255 });
}

if (import.meta.main) main();
