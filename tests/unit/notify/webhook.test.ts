import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WebhookNotifier,
  createNotifier,
  dispatchAndPersist,
} from '../../../src/notify/notifier.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { NotificationsRepo } from '../../../src/store/repos/notifications.ts';
import { SyncRunsRepo } from '../../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  new SyncRunsRepo(d).create({ id: 'r1', trigger: 'manual', scopeFilterJson: '{}' });
  return d;
}

describe('notify.webhook', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('POSTs JSON without bearer header by default', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit | undefined) => {
      calls.push({ url: typeof url === 'string' ? url : url.toString(), init: init ?? {} });
      return new Response(null, { status: 200 }) as unknown as Response;
    }) as unknown as typeof fetch;
    const n = new WebhookNotifier({ url: 'https://hook.example/x', fetcher });
    await n.dispatch({ runId: 'r1', kind: 'run_failed', summary: 's' });
    expect(calls.length).toBe(1);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBeUndefined();
    expect(n.channel).toBe('webhook:https://hook.example/x');
  });

  it('attaches Bearer header when bearer is provided', async () => {
    let captured: Record<string, string> = {};
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit | undefined) => {
      captured = (init?.headers ?? {}) as Record<string, string>;
      return new Response(null, { status: 200 }) as unknown as Response;
    }) as unknown as typeof fetch;
    const n = new WebhookNotifier({ url: 'https://hook/x', bearer: 'TOKEN', fetcher });
    await n.dispatch({ runId: 'r1', kind: 'threshold_exceeded', summary: 's' });
    expect(captured.authorization).toBe('Bearer TOKEN');
  });

  it('throws when webhook returns non-2xx', async () => {
    const fetcher = (async () =>
      new Response('boom', { status: 500 }) as unknown as Response) as unknown as typeof fetch;
    const n = new WebhookNotifier({ url: 'https://hook/y', fetcher });
    await expect(n.dispatch({ runId: 'r1', kind: 'run_failed', summary: 's' })).rejects.toThrow();
  });

  it('createNotifier returns stderr notifier for kind=stderr', () => {
    const n = createNotifier({ config: { kind: 'stderr' } });
    expect(n.channel).toBe('stderr');
  });

  it('createNotifier requires webhookUrl for webhook', () => {
    expect(() => createNotifier({ config: { kind: 'webhook' } })).toThrow('webhookUrl is required');
  });

  it('createNotifier reads bearer from env when configured', () => {
    const fetcher = (async () =>
      new Response(null, { status: 200 }) as unknown as Response) as unknown as typeof fetch;
    const n = createNotifier({
      config: {
        kind: 'webhook',
        webhookUrl: 'https://hook/z',
        webhookBearerEnv: 'WEBHOOK_TOKEN',
      },
      env: { WEBHOOK_TOKEN: 'sek' } as NodeJS.ProcessEnv,
      fetcher,
    });
    expect(n.channel).toBe('webhook:https://hook/z');
  });

  it('createNotifier without bearer env still constructs', () => {
    const n = createNotifier({
      config: { kind: 'webhook', webhookUrl: 'https://hook/abc' },
      env: {} as NodeJS.ProcessEnv,
    });
    expect(n.channel).toContain('https://hook/abc');
  });

  it('dispatchAndPersist dispatches then writes a row', async () => {
    const fetcher = (async () =>
      new Response(null, { status: 200 }) as unknown as Response) as unknown as typeof fetch;
    const notifier = new WebhookNotifier({ url: 'https://hook/q', fetcher });
    await dispatchAndPersist(
      { db: database, notifier },
      { runId: 'r1', kind: 'run_failed', summary: 's' },
    );
    const rows = new NotificationsRepo(database).listByRun('r1');
    expect(rows.length).toBe(1);
    expect(rows[0]?.channel).toBe('webhook:https://hook/q');
  });
});
