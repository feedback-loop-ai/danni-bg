// Hono app factory for the explorer API (T015). Routes are wired here and bound to an injected
// AppContext so tests can drive them against an in-memory store. Zod failures and not-found errors
// are mapped to the shared error envelope. Authoritative Bulgarian fields and freshness blocks pass
// through verbatim (Constitution IX/X).

import type { LanguageModel } from 'ai';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { Crosswalk } from '../../../packages/geo-boundaries/src/crosswalk.ts';
import { MUNICIPALITIES, OBLASTS } from '../../../src/enrich/gazetteer/bg-admin.ts';
import type { PlatformSettingsRepo } from '../../../src/store/repos/platform-settings.ts';
import type { TokenUsageRepo } from '../../../src/store/repos/token-usage.ts';
import type { UsersRepo } from '../../../src/store/repos/users.ts';
import { resolveServerDefault } from './admin/resolve-default.ts';
import { TOGGLES_SETTING_KEY, togglesSchema } from './admin/settings-schema.ts';
import type { SessionResolver } from './auth/kratos-session.ts';
import { capDatasetDetail } from './chat/cap.ts';
import {
  type ProviderConfig,
  type ServerDefault,
  selectModel,
  serverDefaultFromEnv,
} from './chat/providers.ts';
import { SessionStore } from './chat/session.ts';
import { type DatasetLite, hasGeo, liteToPointer, matchesFiltersLite } from './dataset-lite.ts';
import { requireAuth } from './middleware/require-auth.ts';
import type { ReadBridge } from './read-bridge.ts';
import { viewToPointer } from './read-bridge.ts';
import { aggregateRegions } from './regions-aggregate.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { chatHandler } from './routes/chat.ts';
import { meRoutes } from './routes/me.ts';
import {
  type DatasetPointer,
  type ErrorCode,
  type Facets,
  type FilterState,
  type RegionSummary,
  filterStateSchema,
} from './schemas.ts';
import { matchesFilters } from './scope-filter.ts';

export interface HealthInfo {
  lastSyncedAt: string | null;
  isStale: boolean;
  defaultProvider: 'configured' | 'absent';
}

export interface ChatConfig {
  sessions: SessionStore;
  serverDefault: ServerDefault | null;
  /** Test override; when absent the real provider seam is used. */
  selectModel?: (provider: ProviderConfig) => LanguageModel;
}

export interface AppContext {
  bridge: ReadBridge;
  crosswalk: Crosswalk;
  health: () => HealthInfo;
  chat?: ChatConfig;
  /** App users repo — gates /api/chat + backs /api/auth (spec 019). */
  users: UsersRepo;
  /** Per-user token metering — records chat usage + backs the quota gate and usage views. */
  tokenUsage?: TokenUsageRepo;
  /** Platform settings repo — backs /api/admin/settings + the chat's default provider (spec 019). */
  settings?: PlatformSettingsRepo;
  /** Kratos public base URL (for the logout flow URL). */
  kratosPublicUrl?: string;
  /** Validate a Kratos session cookie directly (single-port mode, no Oathkeeper). When omitted, only
   * Oathkeeper's injected X-User-* headers are trusted (used by hermetic tests). */
  sessionResolver?: SessionResolver;
}

const LABELS = new Map<string, { labelBg: string; labelEn: string | null }>([
  ...OBLASTS.map((o) => [o.id, { labelBg: o.labelBg, labelEn: o.labelEn }] as const),
  ...MUNICIPALITIES.map((m) => [m.id, { labelBg: m.labelBg, labelEn: m.labelEn }] as const),
]);

function err(code: ErrorCode, message: string, status: 400 | 404 | 500, details?: unknown) {
  return {
    body: { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    status,
  };
}

/** Parse the shared filter query params into a validated FilterState. */
function parseFilters(q: URLSearchParams): FilterState {
  return filterStateSchema.parse({
    tags: q.getAll('tags'),
    publisherIds: q.getAll('publisherIds'),
    geoUnitIds: q.getAll('geoUnitIds'),
    freshness: q.get('freshness') ?? undefined,
    query: q.get('q') ?? undefined,
    includeWithdrawn: q.get('includeWithdrawn') === 'true' ? true : undefined,
  });
}

function clampInt(raw: string | null, def: number, max: number): number {
  const n = raw === null ? def : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.min(n, max);
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  const chat: ChatConfig = ctx.chat ?? {
    sessions: new SessionStore(),
    serverDefault: serverDefaultFromEnv(),
  };
  // The chat's default provider is resolved PER REQUEST so an admin's settings edit takes effect
  // without a restart: settings store wins, else the env seed (spec 019). Falls back to the configured
  // ChatConfig.serverDefault when no settings repo is wired (e.g. focused unit tests).
  const resolveDefault = () =>
    ctx.settings ? resolveServerDefault(ctx.settings, process.env) : chat.serverDefault;

  // The platform default token quota (0/undefined = unlimited), resolved per request from settings.
  const resolveDefaultTokenLimit = (): number | undefined => {
    if (!ctx.settings) return undefined;
    const raw = ctx.settings.get(TOGGLES_SETTING_KEY);
    return raw != null ? togglesSchema.parse(raw).defaultTokenLimit : undefined;
  };

  // Gated chat (spec 019): requireAuth runs before the streaming handler — anon → 401, else the
  // session's app user is resolved/created and the turn proceeds. The cast bridges the auth-typed
  // middleware onto the app's default env (it only gates + sets `user`, which chatHandler ignores).
  app.post(
    '/api/chat',
    requireAuth(ctx.users, ctx.sessionResolver) as MiddlewareHandler,
    chatHandler({
      bridge: ctx.bridge,
      sessions: chat.sessions,
      selectModel: chat.selectModel ?? ((p) => selectModel(p, resolveDefault())),
      ...(ctx.tokenUsage ? { usage: ctx.tokenUsage } : {}),
      defaultTokenLimit: resolveDefaultTokenLimit,
    }),
  );

  // Per-user self view of token usage/quota (token metering) — any signed-in user.
  if (ctx.tokenUsage) {
    app.route(
      '/api/me',
      meRoutes(ctx.users, ctx.tokenUsage, resolveDefaultTokenLimit, ctx.sessionResolver),
    );
  }

  // Backend auth endpoints (find-or-create app user + tier; logout URL). Self-service login/register
  // are Kratos flows driven by the SPA via the /kratos proxy.
  app.route(
    '/api/auth',
    authRoutes(ctx.users, ctx.kratosPublicUrl ?? 'http://localhost:14433', ctx.sessionResolver),
  );

  // Admin platform settings (spec 019) + per-user token usage/quota admin (token metering) — mounted
  // only when a settings repo is wired (always in prod).
  if (ctx.settings) {
    app.route(
      '/api/admin',
      adminRoutes(ctx.users, ctx.settings, {
        sessionResolver: ctx.sessionResolver,
        tokenUsage: ctx.tokenUsage,
        defaultTokenLimit: resolveDefaultTokenLimit,
      }),
    );
  }

  app.get('/healthz', (c) => {
    const h = ctx.health();
    const status = h.isStale || h.defaultProvider === 'absent' ? 'degraded' : 'ok';
    return c.json({
      status,
      lastSyncedAt: h.lastSyncedAt,
      isStale: h.isStale,
      components: { store: 'ok', boundaries: 'ok', defaultProvider: h.defaultProvider },
    });
  });

  // All in-scope datasets, honoring the structured filters (used by list / regions / national /
  // facets). Bulk lite projection (see ReadBridge.listLite) — not a per-dataset view fan-out — so
  // these whole-catalog endpoints scale to the full ~11k-dataset mirror.
  const scopedLites = (f: FilterState) =>
    ctx.bridge.listLite().filter((l) => matchesFiltersLite(l, f));

  // Maps a dataset's geo-link entity id to the region ids (at `level`) it should count toward.
  // Municipalities roll up into their parent oblast via the `part_of` knowledge-graph edges
  // (`parentOf`), so an oblast aggregates its own direct links plus all of its municipalities'
  // (de-duplicated per dataset in the aggregator / belongs check). Level is read from the entity-id
  // namespace; the parent comes from the graph, not the gazetteer crosswalk.
  const rollupTargets =
    (level: 'oblast' | 'municipality', parentOf: Map<string, string>) =>
    (linkEntityId: string): string[] => {
      const isOblast = linkEntityId.startsWith('geo:bg-oblast-');
      const isMunicipality = linkEntityId.startsWith('geo:bg-municipality-');
      if (level === 'municipality') return isMunicipality ? [linkEntityId] : [];
      if (isOblast) return [linkEntityId];
      if (isMunicipality) {
        const parent = parentOf.get(linkEntityId);
        return parent ? [parent] : [];
      }
      return [];
    };

  app.get('/api/datasets', async (c) => {
    const f = parseFilters(new URL(c.req.url).searchParams);
    const q = new URL(c.req.url).searchParams;
    const limit = clampInt(q.get('limit'), 50, 200);
    const offset = clampInt(q.get('offset'), 0, Number.MAX_SAFE_INTEGER);

    let pointers: DatasetPointer[];
    if (f.query.trim() !== '') {
      const hits = await ctx.bridge.search(f.query, undefined, 200);
      const seen = new Set<string>();
      pointers = [];
      for (const hit of hits) {
        if (seen.has(hit.datasetId)) continue;
        seen.add(hit.datasetId);
        const view = ctx.bridge.view(hit.datasetId);
        if (matchesFilters(view, f)) pointers.push(viewToPointer(view, hit.score));
      }
    } else {
      pointers = scopedLites(f).map((l) => liteToPointer(l));
    }

    const total = pointers.length;
    return c.json({ datasets: pointers.slice(offset, offset + limit), total, limit, offset });
  });

  app.get('/api/datasets/:datasetId', (c) => {
    try {
      // Cap related-dataset links/entities: high-degree datasets carry 14k+ links (the link
      // heuristic forms large cliques), which bloats the detail payload sent to the browser.
      return c.json(capDatasetDetail(ctx.bridge.detail(c.req.param('datasetId'))));
    } catch {
      const e = err('not_found', 'dataset not found', 404);
      return c.json(e.body, e.status);
    }
  });

  // Entity knowledge-graph node: the entity plus its typed entity<->entity relations (e.g. a
  // municipality's parent oblast, an oblast's child municipalities) and its direct dataset count.
  app.get('/api/entities/:entityId', (c) => {
    const graph = ctx.bridge.entityGraph(c.req.param('entityId'));
    if (!graph) {
      const e = err('not_found', 'unknown entity', 404);
      return c.json(e.body, e.status);
    }
    return c.json(graph);
  });

  app.get('/api/datasets/:datasetId/resources/:resourceId/rows', (c) => {
    const q = new URL(c.req.url).searchParams;
    const limit = clampInt(q.get('limit'), 100, 1000);
    const offset = clampInt(q.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    // Optional server-side grid: ?sort=<col>&dir=asc|desc&filters=<json {col:substring}>.
    const sortCol = q.get('sort');
    const dir: 'asc' | 'desc' = q.get('dir') === 'desc' ? 'desc' : 'asc';
    const filters: Record<string, string> = {};
    const filtersRaw = q.get('filters');
    if (filtersRaw) {
      try {
        const parsed = JSON.parse(filtersRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') filters[k] = v;
        }
      } catch {
        // Malformed filters are ignored rather than failing the request.
      }
    }
    const grid = { sort: sortCol ? { col: sortCol, dir } : null, filters };
    try {
      return c.json(
        ctx.bridge.rows(c.req.param('datasetId'), c.req.param('resourceId'), limit, offset, grid),
      );
    } catch {
      const e = err('not_found', 'resource not found', 404);
      return c.json(e.body, e.status);
    }
  });

  app.get('/api/regions', (c) => {
    const q = new URL(c.req.url).searchParams;
    const level = q.get('level') === 'municipality' ? 'municipality' : 'oblast';
    const f = parseFilters(q);
    const datasets = scopedLites(f).map((l) => ({
      datasetId: l.datasetId,
      geoLinks: l.geoLinks,
    }));
    const parentOf = ctx.bridge.partOfParents();
    const regions: RegionSummary[] = aggregateRegions({
      entries: ctx.crosswalk.entriesForLevel(level),
      labelOf: (id) => LABELS.get(id),
      datasets,
      rollup: rollupTargets(level, parentOf),
      parentOf: (id) => parentOf.get(id),
    });
    return c.json({ regions });
  });

  app.get('/api/regions/:entityId', (c) => {
    const entityId = c.req.param('entityId');
    const entry = ctx.crosswalk.entry(entityId);
    if (!entry) {
      const e = err('not_found', 'unknown or unlinked region', 404);
      return c.json(e.body, e.status);
    }
    const q = new URL(c.req.url).searchParams;
    const f = parseFilters(q);
    const limit = clampInt(q.get('limit'), 50, 200);
    const offset = clampInt(q.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    // Roll-up–aware membership: an oblast also contains datasets linked to any of its
    // municipalities. `belongsConfidence` returns the strongest confidence among the links that
    // roll up to this region, or -1 when none — so the list + count match the aggregate exactly,
    // and each dataset is included at most once.
    const targetsFor = rollupTargets(entry.level, ctx.bridge.partOfParents());
    const belongsConfidence = (l: DatasetLite): number => {
      let best = -1;
      for (const g of l.geoLinks)
        if (targetsFor(g.entityId).includes(entityId) && g.confidence > best) best = g.confidence;
      return best;
    };
    const lites = scopedLites(f).filter((l) => belongsConfidence(l) >= 0);
    const label = LABELS.get(entityId);
    const region: RegionSummary = {
      entityId,
      level: entry.level,
      labelBg: label?.labelBg ?? entityId,
      labelEn: label?.labelEn ?? null,
      boundaryFeatureId: entry.boundaryFeatureId,
      datasetCount: lites.length,
      hasData: lites.length > 0,
      maxConfidence: lites.reduce((m, l) => Math.max(m, belongsConfidence(l)), 0),
    };
    const datasets = lites.slice(offset, offset + limit).map((l) => liteToPointer(l));
    return c.json({ region, datasets, total: lites.length });
  });

  // National / non-georeferenced grouping: datasets with no geographic entity, so they remain
  // discoverable rather than being dropped off the map (FR-006, SC-009).
  app.get('/api/national', (c) => {
    const q = new URL(c.req.url).searchParams;
    const f = parseFilters(q);
    const limit = clampInt(q.get('limit'), 50, 200);
    const offset = clampInt(q.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    const lites = scopedLites(f).filter((l) => !hasGeo(l));
    const datasets = lites.slice(offset, offset + limit).map((l) => liteToPointer(l));
    return c.json({ datasets, total: lites.length, limit, offset });
  });

  app.get('/api/facets', (c) => {
    const f = parseFilters(new URL(c.req.url).searchParams);
    const lites = scopedLites(f);
    const tags = new Map<string, number>();
    const publishers = new Map<string, { labelBg: string; count: number }>();
    let fresh = 0;
    let stale = 0;
    for (const l of lites) {
      for (const t of l.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
      if (l.publisherId) {
        const p = publishers.get(l.publisherId) ?? { labelBg: l.publisherTitleBg ?? '', count: 0 };
        p.count += 1;
        publishers.set(l.publisherId, p);
      }
      if (l.freshness.isStale) stale += 1;
      else fresh += 1;
    }
    const facets: Facets = {
      tags: [...tags].map(([id, count]) => ({ id, labelBg: id, count })),
      publishers: [...publishers].map(([id, p]) => ({ id, labelBg: p.labelBg, count: p.count })),
      freshnessBuckets: [
        { id: 'fresh', count: fresh },
        { id: 'stale', count: stale },
      ],
    };
    return c.json(facets);
  });

  app.onError((e, c) => {
    if (e instanceof Error && e.name === 'ZodError') {
      const env = err('bad_request', 'invalid request parameters', 400, JSON.parse(e.message));
      return c.json(env.body, env.status);
    }
    const env = err('internal', 'internal error', 500);
    return c.json(env.body, env.status);
  });

  return app;
}
