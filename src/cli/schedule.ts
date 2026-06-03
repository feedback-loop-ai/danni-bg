import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.ts';
import { BackoffRunner } from '../crawler/backoff.ts';
import { CkanClient } from '../crawler/ckan-client.ts';
import { PortalHttp } from '../crawler/http.ts';
import { RateLimiter } from '../crawler/rate-limit.ts';
import { RobotsCache } from '../crawler/robots.ts';
import { runSync } from '../crawler/run-sync.ts';
import { withContext } from '../logging/logger.ts';
import { LockContentionError } from '../manifest/sync-run.ts';
import { createNotifier } from '../notify/notifier.ts';
import { nextFire, parseCron } from '../schedule/cron.ts';
import { Scheduler } from '../schedule/scheduler.ts';
import { openDb } from '../store/db.ts';

export async function run(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub) {
    process.stderr.write('danni schedule {install|disable|show}\n');
    return 2;
  }
  const config = loadConfig();
  const storeRoot = resolve(process.cwd(), config.store.root);

  if (sub === 'show') {
    if (!config.schedule.enabled || !config.schedule.cron) {
      process.stdout.write('schedule: disabled\n');
      return 0;
    }
    const next = nextFire(parseCron(config.schedule.cron), new Date());
    process.stdout.write(
      `schedule: enabled cron='${config.schedule.cron}' tz='${config.schedule.timezone}' next=${next.toISOString()} onOverlap=${config.schedule.onOverlap}\n`,
    );
    return 0;
  }
  if (sub === 'disable') {
    process.stderr.write(
      'danni schedule disable: edit danni.config.json and set schedule.enabled=false (operator-driven, by design).\n',
    );
    return 2;
  }
  if (sub !== 'install') {
    process.stderr.write(`unknown subcommand: ${sub}\n`);
    return 2;
  }
  if (!config.schedule.enabled || !config.schedule.cron) {
    process.stderr.write('schedule.enabled is false or schedule.cron is null in config\n');
    return 2;
  }

  const db = openDb({ storeRoot, loadVec: false });
  const log = withContext({ component: 'schedule' });
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
    });
    const http = new PortalHttp({
      userAgent: config.crawler.userAgent,
      rateLimiter,
      backoff,
      robots,
    });
    const client = new CkanClient({ baseUrl: config.portal.baseUrl, http });
    const notifier = createNotifier({ config: config.schedule.notifier });

    let exitCode = 0;
    const scheduler = new Scheduler({
      cron: config.schedule.cron,
      onOverlap: config.schedule.onOverlap,
      onLockSkip: () => {
        if (config.schedule.onOverlap === 'skip') exitCode = 5;
      },
      fire: async () => {
        try {
          await runSync({
            db,
            config,
            client,
            http,
            storeRoot,
            trigger: 'scheduled',
            notifier,
          });
        } catch (err) {
          if (err instanceof LockContentionError && config.schedule.onOverlap === 'skip') {
            exitCode = 5;
            log.warn('schedule.skipped_overlap', { reason: err.message });
            return;
          }
          throw err;
        }
      },
    });
    log.info('schedule.installed', { cron: config.schedule.cron });
    void args; // reserved for future flags
    await scheduler.start();
    return exitCode;
  } finally {
    db.close();
  }
}
