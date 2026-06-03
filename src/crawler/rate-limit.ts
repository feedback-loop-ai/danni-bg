export interface RateLimitOptions {
  requestsPerSecond: number;
  concurrency: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface HostState {
  inFlight: number;
  nextSlot: number;
  waiters: Array<() => void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  private readonly hosts = new Map<string, HostState>();
  private readonly requestsPerSecond: number;
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;

  constructor(opts: RateLimitOptions) {
    if (opts.requestsPerSecond <= 0) {
      throw new Error('RateLimiter: requestsPerSecond must be > 0');
    }
    if (opts.concurrency < 1) {
      throw new Error('RateLimiter: concurrency must be >= 1');
    }
    this.requestsPerSecond = opts.requestsPerSecond;
    this.concurrency = opts.concurrency;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.minIntervalMs = 1000 / this.requestsPerSecond;
  }

  private getOrCreate(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = { inFlight: 0, nextSlot: 0, waiters: [] };
      this.hosts.set(host, s);
    }
    return s;
  }

  async acquire(host: string): Promise<void> {
    const state = this.getOrCreate(host);
    while (state.inFlight >= this.concurrency) {
      await new Promise<void>((resolve) => state.waiters.push(resolve));
    }
    state.inFlight += 1;
    const wait = state.nextSlot - this.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    state.nextSlot = Math.max(this.now(), state.nextSlot) + this.minIntervalMs;
  }

  release(host: string): void {
    const state = this.hosts.get(host);
    if (!state) return;
    state.inFlight = Math.max(0, state.inFlight - 1);
    const waiter = state.waiters.shift();
    if (waiter) waiter();
  }
}
