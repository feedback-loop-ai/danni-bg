import type { Database } from 'bun:sqlite';
import type { NotifierConfig } from '../config/schema.ts';
import { type NotificationKind, NotificationsRepo } from '../store/repos/notifications.ts';

export interface NotificationPayload {
  runId: string;
  kind: NotificationKind;
  summary: string;
  totals?: Record<string, number>;
  failureRate?: number;
  threshold?: number;
}

export interface Notifier {
  readonly channel: string;
  dispatch(payload: NotificationPayload): Promise<void>;
}

export interface NotifierFactoryOptions {
  config: NotifierConfig;
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  stderrSink?: (line: string) => void;
}

export function createNotifier(opts: NotifierFactoryOptions): Notifier {
  if (opts.config.kind === 'stderr') {
    return new StderrNotifier(opts.stderrSink);
  }
  if (!opts.config.webhookUrl) {
    throw new Error('webhookUrl is required for webhook notifier');
  }
  const env = opts.env ?? process.env;
  const bearer = opts.config.webhookBearerEnv ? env[opts.config.webhookBearerEnv] : undefined;
  return new WebhookNotifier({
    url: opts.config.webhookUrl,
    ...(bearer ? { bearer } : {}),
    ...(opts.fetcher ? { fetcher: opts.fetcher } : {}),
  });
}

export class StderrNotifier implements Notifier {
  readonly channel = 'stderr';
  constructor(
    private readonly sink: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  ) {}
  async dispatch(payload: NotificationPayload): Promise<void> {
    this.sink(JSON.stringify({ notifier: 'stderr', ...payload }));
  }
}

export class WebhookNotifier implements Notifier {
  readonly channel: string;
  private readonly url: string;
  private readonly bearer?: string;
  private readonly fetcher: typeof fetch;
  constructor(opts: { url: string; bearer?: string; fetcher?: typeof fetch }) {
    this.url = opts.url;
    if (opts.bearer !== undefined) this.bearer = opts.bearer;
    this.fetcher = opts.fetcher ?? fetch;
    this.channel = `webhook:${opts.url}`;
  }
  async dispatch(payload: NotificationPayload): Promise<void> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const res = await this.fetcher(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Webhook ${this.url} returned HTTP ${res.status}`);
    }
  }
}

export interface PersistedDispatchOptions {
  db: Database;
  notifier: Notifier;
}

export async function dispatchAndPersist(
  opts: PersistedDispatchOptions,
  payload: NotificationPayload,
): Promise<void> {
  const repo = new NotificationsRepo(opts.db);
  await opts.notifier.dispatch(payload);
  repo.insert({
    runId: payload.runId,
    kind: payload.kind,
    channel: opts.notifier.channel,
    payload: { ...payload },
  });
}
