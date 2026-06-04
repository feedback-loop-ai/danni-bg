import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { loadConfig } from '../config/loader.ts';
import { type ScopeConfig, ScopeConfigSchema } from '../config/schema.ts';
import { BackoffRunner } from '../crawler/backoff.ts';
import { CkanClient } from '../crawler/ckan-client.ts';
import { EgovBgClient } from '../crawler/egov-bg-client.ts';
import { PortalHttp } from '../crawler/http.ts';
import { RateLimiter } from '../crawler/rate-limit.ts';
import { RobotsCache } from '../crawler/robots.ts';
import { runEgovSyncRun } from '../crawler/run-egov-sync.ts';
import { runSync } from '../crawler/run-sync.ts';
import { LockContentionError } from '../manifest/sync-run.ts';
import { createNotifier } from '../notify/notifier.ts';
import { openDb } from '../store/db.ts';

export interface SyncFlags {
  scope?: ScopeConfig | undefined;
  manifestOut?: string | undefined;
  dryRun?: boolean | undefined;
  max?: number | undefined;
  retryFailed?: boolean | undefined;
}

export function parseScopeArg(
  arg: string | undefined,
  cwd = process.cwd(),
): ScopeConfig | undefined {
  if (!arg) return undefined;
  let raw: string;
  if (arg.startsWith('@')) {
    raw = readFileSync(resolve(cwd, arg.slice(1)), 'utf-8');
  } else {
    raw = arg;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `--scope is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return ScopeConfigSchema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(
        `--scope failed validation: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    throw err;
  }
}

export function parseFlags(args: string[]): SyncFlags {
  const flags: SyncFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--once') {
      // accepted for compatibility; trigger=manual is implicit
    } else if (a === '--dry-run') {
      flags.dryRun = true;
    } else if (a === '--retry-failed') {
      flags.retryFailed = true;
    } else if (a === '--scope') {
      flags.scope = parseScopeArg(args[i + 1]);
      i++;
    } else if (a === '--max') {
      const v = Number(args[i + 1]);
      if (!Number.isInteger(v) || v <= 0) throw new Error('--max requires a positive integer');
      flags.max = v;
      i++;
    } else if (a === '--manifest-out') {
      flags.manifestOut = args[i + 1];
      i++;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'danni sync [--scope <json|@file>] [--once] [--manifest-out <path>] [--dry-run] [--max <n>] [--retry-failed]\n' +
          '  --max <n>        per-session dataset batch (egov): advances and persists the resume cursor\n' +
          '  --retry-failed   re-attempt recorded failures up to the fixed max-attempts cap (egov)\n',
      );
      throw new Error('__HELP__');
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return flags;
}

export async function run(args: string[]): Promise<number> {
  let flags: SyncFlags;
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
    const http = new PortalHttp({
      userAgent: config.crawler.userAgent,
      rateLimiter,
      backoff,
      robots,
    });

    const notifier = createNotifier({ config: config.schedule.notifier });

    // data.egov.bg's custom API: discover + capture via the egov-bg adapter, now inside the Sync
    // Run machinery (FR-007) so it shares the single lock with the CKAN path.
    if (config.portal.api === 'egov-bg') {
      const apiKey = config.portal.apiKeyEnv ? process.env[config.portal.apiKeyEnv] : undefined;
      const egov = new EgovBgClient({ baseUrl: config.portal.baseUrl, http, apiKey });
      try {
        const result = await runEgovSyncRun({
          db,
          config,
          client: egov,
          storeRoot,
          trigger: 'manual',
          scope: flags.scope ?? config.scope,
          notifier,
          ...(flags.max !== undefined ? { max: flags.max } : {}),
          ...(flags.retryFailed !== undefined ? { retryFailed: flags.retryFailed } : {}),
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result.summaryOutcome === 'failed' ? 3 : 0;
      } catch (err) {
        if (err instanceof LockContentionError) {
          process.stderr.write(`sync rejected: ${err.message}\n`);
          return 5;
        }
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        return 4;
      }
    }

    const client = new CkanClient({ baseUrl: config.portal.baseUrl, http });

    try {
      const result = await runSync({
        db,
        config,
        client,
        http,
        storeRoot,
        trigger: 'manual',
        ...(flags.scope ? { scopeFilterOverride: flags.scope } : {}),
        notifier,
        ...(flags.dryRun ? { dryRun: true } : {}),
        ...(flags.manifestOut ? { manifestOutOverride: flags.manifestOut } : {}),
      });
      return result.summaryOutcome === 'success' ? 0 : 3;
    } catch (err) {
      if (err instanceof LockContentionError) {
        process.stderr.write(`sync rejected: ${err.message}\n`);
        return 5;
      }
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 4;
    }
  } finally {
    db.close();
  }
}
