import { RetryExhausted } from '../lib/errors.ts';

export interface BackoffOptions {
  initialMs: number;
  maxMs: number;
  failureBudget: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  retryAfterMs?: () => number | undefined;
}

export interface AttemptOutcome<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  retryAfterMs?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class BackoffRunner {
  private readonly initialMs: number;
  private readonly maxMs: number;
  private readonly failureBudget: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: BackoffOptions) {
    if (opts.initialMs < 1) throw new Error('BackoffRunner: initialMs must be >= 1');
    if (opts.maxMs < opts.initialMs) {
      throw new Error('BackoffRunner: maxMs must be >= initialMs');
    }
    if (opts.failureBudget < 1) throw new Error('BackoffRunner: failureBudget must be >= 1');
    this.initialMs = opts.initialMs;
    this.maxMs = opts.maxMs;
    this.failureBudget = opts.failureBudget;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
  }

  delayMs(attempt: number): number {
    const exp = Math.min(this.maxMs, this.initialMs * 2 ** attempt);
    const jitter = this.random() * exp;
    return Math.floor(jitter);
  }

  async run<T>(label: string, fn: (attempt: number) => Promise<AttemptOutcome<T>>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.failureBudget; attempt++) {
      const outcome = await fn(attempt);
      if (outcome.ok) return outcome.value as T;
      lastError = outcome.error;
      if (attempt + 1 >= this.failureBudget) break;
      const wait = outcome.retryAfterMs ?? this.delayMs(attempt);
      await this.sleep(wait);
    }
    throw new RetryExhausted(`${label}: retries exhausted after ${this.failureBudget} attempts`, {
      lastError: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }
}

export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  if (Number.isFinite(num) && num >= 0) return Math.floor(num * 1000);
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}
