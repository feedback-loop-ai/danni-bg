import type { Database } from 'bun:sqlite';
import type { DanniConfig, ScopeConfig } from '../config/schema.ts';
import type { Notifier } from '../notify/notifier.ts';
import type { RunTrigger } from '../store/repos/sync-runs.ts';
import { BackoffRunner } from './backoff.ts';
import { CkanClient } from './ckan-client.ts';
import { EgovBgClient } from './egov-bg-client.ts';
import { PortalHttp } from './http.ts';
import { RateLimiter } from './rate-limit.ts';
import { RobotsCache } from './robots.ts';
import { type RunEgovSyncRunResult, runEgovSyncRun } from './run-egov-sync.ts';
import { type RunSyncResult, runSync } from './run-sync.ts';

/**
 * Build the shared HTTP stack (rate limiter + backoff + robots), honoring the operator's robots
 * opt-out (`obey` / `allowHosts`). The live data.egov.bg API serves `robots.txt: Disallow: /`,
 * so an authorized crawl needs the opt-out; both the interactive `sync` CLI and the scheduler
 * build their HTTP through here so the daemon path can never silently re-impose robots (which
 * would capture nothing).
 */
export function buildPortalHttp(config: DanniConfig, fetcher?: typeof fetch): PortalHttp {
  const rateLimiter = new RateLimiter({
    requestsPerSecond: config.crawler.rateLimit.requestsPerSecondPerHost,
    concurrency: config.crawler.concurrency.maxConcurrentRequestsPerHost,
  });
  const backoff = new BackoffRunner({
    initialMs: config.crawler.backoff.initialMs,
    maxMs: config.crawler.backoff.maxMs,
    failureBudget: config.crawler.backoff.failureBudget,
  });
  const robots = new RobotsCache({
    recheckIntervalSeconds: config.crawler.robots.recheckIntervalSeconds,
    obey: config.crawler.robots.obey,
    allowHosts: config.crawler.robots.allowHosts,
  });
  return new PortalHttp({
    userAgent: config.crawler.userAgent,
    rateLimiter,
    backoff,
    robots,
    ...(fetcher ? { fetcher } : {}),
  });
}

export interface RunPortalSyncOptions {
  db: Database;
  config: DanniConfig;
  http: PortalHttp;
  storeRoot: string;
  trigger: RunTrigger;
  notifier?: Notifier | undefined;
  scope?: ScopeConfig | undefined;
  max?: number | undefined;
  retryFailed?: boolean | undefined;
  dryRun?: boolean | undefined;
  manifestOut?: string | undefined;
}

export type RunPortalSyncResult =
  | { api: 'ckan'; result: RunSyncResult }
  | { api: 'egov-bg'; result: RunEgovSyncRunResult };

/**
 * Select the portal client + sync runner from `config.portal.api` and run one sync session.
 * `egov-bg` (the real data.egov.bg API; CKAN `/api/3/action/` returns "Непознат метод") routes
 * through the resumable campaign runner; `ckan` routes through the standard CKAN runner.
 * Centralizing the dispatch keeps the interactive and scheduled entry points in lockstep — the
 * scheduler previously hardcoded CkanClient and could never crawl the live portal.
 */
export async function runPortalSync(opts: RunPortalSyncOptions): Promise<RunPortalSyncResult> {
  const { db, config, http, storeRoot, trigger, notifier } = opts;

  if (config.portal.api === 'egov-bg') {
    const apiKey = config.portal.apiKeyEnv ? process.env[config.portal.apiKeyEnv] : undefined;
    const client = new EgovBgClient({ baseUrl: config.portal.baseUrl, http, apiKey });
    const result = await runEgovSyncRun({
      db,
      config,
      client,
      storeRoot,
      trigger,
      scope: opts.scope ?? config.scope,
      notifier,
      ...(opts.max !== undefined ? { max: opts.max } : {}),
      ...(opts.retryFailed !== undefined ? { retryFailed: opts.retryFailed } : {}),
    });
    return { api: 'egov-bg', result };
  }

  const client = new CkanClient({ baseUrl: config.portal.baseUrl, http });
  const result = await runSync({
    db,
    config,
    client,
    http,
    storeRoot,
    trigger,
    ...(opts.scope ? { scopeFilterOverride: opts.scope } : {}),
    ...(notifier ? { notifier } : {}),
    ...(opts.dryRun ? { dryRun: true } : {}),
    ...(opts.manifestOut ? { manifestOutOverride: opts.manifestOut } : {}),
  });
  return { api: 'ckan', result };
}
