import { createWriteStream } from 'node:fs';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureDir, tempPath } from '../lib/fs.ts';
import { Sha256Stream } from '../lib/hash.ts';
import type { BackoffRunner } from './backoff.ts';
import { parseRetryAfter } from './backoff.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { RobotsCache } from './robots.ts';

export interface PortalHttpOptions {
  userAgent: string;
  rateLimiter: RateLimiter;
  backoff: BackoffRunner;
  robots: RobotsCache;
  fetcher?: typeof fetch;
}

export interface ConditionalHeaders {
  etag?: string | null | undefined;
  lastModified?: string | null | undefined;
}

export interface JsonResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

export interface DownloadResult {
  status: number;
  notModified: boolean;
  bytes?: number;
  sha256?: string;
  etag?: string | undefined;
  lastModified?: string | undefined;
  contentType?: string | undefined;
  tempPath?: string;
}

function hostOf(url: string): string {
  return new URL(url).host;
}

const isRetryable = (status: number): boolean => status === 429 || (status >= 500 && status < 600);

export class PortalHttp {
  private readonly userAgent: string;
  private readonly rateLimiter: RateLimiter;
  private readonly backoff: BackoffRunner;
  private readonly robots: RobotsCache;
  private readonly fetcher: typeof fetch;

  constructor(opts: PortalHttpOptions) {
    this.userAgent = opts.userAgent;
    this.rateLimiter = opts.rateLimiter;
    this.backoff = opts.backoff;
    this.robots = opts.robots;
    this.fetcher = opts.fetcher ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'user-agent': this.userAgent, accept: 'application/json', ...extra };
  }

  async getJson<T>(url: string): Promise<JsonResponse<T>> {
    if (!(await this.robots.isAllowed(url, this.userAgent))) {
      throw new Error(`robots.txt disallows ${url}`);
    }
    return this.backoff.run(`GET ${url}`, async () => {
      const host = hostOf(url);
      await this.rateLimiter.acquire(host);
      try {
        const res = await this.fetcher(url, { headers: this.headers() });
        if (isRetryable(res.status)) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after')) ?? undefined;
          return retryAfter !== undefined
            ? { ok: false, error: new Error(`HTTP ${res.status}`), retryAfterMs: retryAfter }
            : { ok: false, error: new Error(`HTTP ${res.status}`) };
        }
        const body = (await res.json()) as T;
        return { ok: true, value: { status: res.status, body, headers: res.headers } };
      } catch (err) {
        return { ok: false, error: err };
      } finally {
        this.rateLimiter.release(host);
      }
    });
  }

  async postJson<T>(
    url: string,
    payload: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<JsonResponse<T>> {
    if (!(await this.robots.isAllowed(url, this.userAgent))) {
      throw new Error(`robots.txt disallows ${url}`);
    }
    return this.backoff.run(`POST ${url}`, async () => {
      const host = hostOf(url);
      await this.rateLimiter.acquire(host);
      try {
        const res = await this.fetcher(url, {
          method: 'POST',
          headers: this.headers({ 'content-type': 'application/json', ...extraHeaders }),
          body: JSON.stringify(payload),
        });
        if (isRetryable(res.status)) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after')) ?? undefined;
          return retryAfter !== undefined
            ? { ok: false, error: new Error(`HTTP ${res.status}`), retryAfterMs: retryAfter }
            : { ok: false, error: new Error(`HTTP ${res.status}`) };
        }
        const body = (await res.json()) as T;
        return { ok: true, value: { status: res.status, body, headers: res.headers } };
      } catch (err) {
        return { ok: false, error: err };
      } finally {
        this.rateLimiter.release(host);
      }
    });
  }

  async download(
    url: string,
    targetPath: string,
    cond: ConditionalHeaders = {},
  ): Promise<DownloadResult> {
    if (!(await this.robots.isAllowed(url, this.userAgent))) {
      throw new Error(`robots.txt disallows ${url}`);
    }
    return this.backoff.run(`GET ${url}`, async () => {
      const host = hostOf(url);
      await this.rateLimiter.acquire(host);
      const headers = this.headers({ accept: '*/*' });
      if (cond.etag) headers['if-none-match'] = cond.etag;
      else if (cond.lastModified) headers['if-modified-since'] = cond.lastModified;
      try {
        const res = await this.fetcher(url, { headers });
        if (res.status === 304) {
          return {
            ok: true,
            value: {
              status: 304,
              notModified: true,
              etag: res.headers.get('etag') ?? cond.etag ?? undefined,
              lastModified: res.headers.get('last-modified') ?? cond.lastModified ?? undefined,
              contentType: res.headers.get('content-type') ?? undefined,
            } as DownloadResult,
          };
        }
        if (isRetryable(res.status)) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after')) ?? undefined;
          return retryAfter !== undefined
            ? { ok: false, error: new Error(`HTTP ${res.status}`), retryAfterMs: retryAfter }
            : { ok: false, error: new Error(`HTTP ${res.status}`) };
        }
        if (res.status >= 400) {
          return { ok: false, error: new Error(`HTTP ${res.status}`) };
        }
        if (!res.body) {
          return { ok: false, error: new Error('Empty response body') };
        }
        const tmp = tempPath(targetPath);
        ensureDir(dirname(tmp));
        const out = createWriteStream(tmp);
        const hasher = new Sha256Stream();
        try {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              hasher.update(value);
              await new Promise<void>((resolve, reject) => {
                out.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
              });
            }
          }
        } catch (err) {
          out.close();
          rmSync(tmp, { force: true });
          return { ok: false, error: err };
        }
        await new Promise<void>((resolve, reject) =>
          out.end((err: Error | undefined) => (err ? reject(err) : resolve())),
        );
        const { sha256, bytes } = hasher.digest();
        return {
          ok: true,
          value: {
            status: res.status,
            notModified: false,
            sha256,
            bytes,
            etag: res.headers.get('etag') ?? undefined,
            lastModified: res.headers.get('last-modified') ?? undefined,
            contentType: res.headers.get('content-type') ?? undefined,
            tempPath: tmp,
          } as DownloadResult,
        };
      } catch (err) {
        return { ok: false, error: err };
      } finally {
        this.rateLimiter.release(host);
      }
    });
  }
}
