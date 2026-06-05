// Hono app factory for the explorer API (T015). Routes are wired here and bound to an injected
// AppContext so tests can drive them against an in-memory store. Zod failures and not-found errors
// are mapped to the shared error envelope. Authoritative Bulgarian fields and freshness blocks pass
// through verbatim (Constitution IX/X).

import { Hono } from 'hono';
import type { Crosswalk } from '../../../packages/geo-boundaries/src/crosswalk.ts';
import { MUNICIPALITIES, OBLASTS } from '../../../src/enrich/gazetteer/bg-admin.ts';
import type { ReadBridge } from './read-bridge.ts';
import { viewToPointer } from './read-bridge.ts';
import { aggregateRegions } from './regions-aggregate.ts';
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

export interface AppContext {
  bridge: ReadBridge;
  crosswalk: Crosswalk;
  health: () => HealthInfo;
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

  // All in-scope dataset views, honoring the structured filters (used by list / regions / facets).
  const scopedViews = (f: FilterState) =>
    ctx.bridge
      .listAllIds()
      .map((id) => ctx.bridge.view(id))
      .filter((v) => matchesFilters(v, f));

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
      pointers = scopedViews(f).map((v) => viewToPointer(v));
    }

    const total = pointers.length;
    return c.json({ datasets: pointers.slice(offset, offset + limit), total, limit, offset });
  });

  app.get('/api/datasets/:datasetId', (c) => {
    try {
      return c.json(ctx.bridge.detail(c.req.param('datasetId')));
    } catch {
      const e = err('not_found', 'dataset not found', 404);
      return c.json(e.body, e.status);
    }
  });

  app.get('/api/datasets/:datasetId/resources/:resourceId/rows', (c) => {
    const q = new URL(c.req.url).searchParams;
    const limit = clampInt(q.get('limit'), 100, 1000);
    const offset = clampInt(q.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    try {
      return c.json(
        ctx.bridge.rows(c.req.param('datasetId'), c.req.param('resourceId'), limit, offset),
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
    const views = scopedViews(f);
    const datasets = views.map((v) => ({
      datasetId: v.datasetId,
      geoLinks: v.entities
        .filter((e) => e.entityId.startsWith('geo:'))
        .map((e) => ({ entityId: e.entityId, confidence: e.confidence })),
    }));
    const regions: RegionSummary[] = aggregateRegions({
      entries: ctx.crosswalk.entriesForLevel(level),
      labelOf: (id) => LABELS.get(id),
      datasets,
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
    const views = scopedViews(f).filter((v) => v.entities.some((e) => e.entityId === entityId));
    const label = LABELS.get(entityId);
    const region: RegionSummary = {
      entityId,
      level: entry.level,
      labelBg: label?.labelBg ?? entityId,
      labelEn: label?.labelEn ?? null,
      boundaryFeatureId: entry.boundaryFeatureId,
      datasetCount: views.length,
      hasData: views.length > 0,
      maxConfidence: views.reduce(
        (m, v) =>
          Math.max(
            m,
            ...v.entities.filter((e) => e.entityId === entityId).map((e) => e.confidence),
          ),
        0,
      ),
    };
    const datasets = views.slice(offset, offset + limit).map((v) => viewToPointer(v));
    return c.json({ region, datasets, total: views.length });
  });

  app.get('/api/facets', (c) => {
    const f = parseFilters(new URL(c.req.url).searchParams);
    const views = scopedViews(f);
    const tags = new Map<string, number>();
    const publishers = new Map<string, { labelBg: string; count: number }>();
    let fresh = 0;
    let stale = 0;
    for (const v of views) {
      for (const t of v.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
      if (v.publisher) {
        const p = publishers.get(v.publisher.id) ?? { labelBg: v.publisher.title.bg, count: 0 };
        p.count += 1;
        publishers.set(v.publisher.id, p);
      }
      if (v.freshness.isStale) stale += 1;
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
