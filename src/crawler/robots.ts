interface RobotsRule {
  userAgent: string;
  rules: Array<{ kind: 'allow' | 'disallow'; path: string }>;
}

interface RobotsCacheEntry {
  fetchedAt: number;
  rules: RobotsRule[];
}

export interface RobotsCacheOptions {
  recheckIntervalSeconds: number;
  fetcher?: (url: string) => Promise<{ status: number; body: string }>;
  now?: () => number;
  /** When false, robots.txt is never fetched/consulted (operator opt-out). */
  obey?: boolean;
  /** Hosts exempted from robots.txt even when `obey` is true. */
  allowHosts?: string[];
}

function parseRobotsTxt(body: string): RobotsRule[] {
  const groups: RobotsRule[] = [];
  let current: RobotsRule | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      current = { userAgent: value, rules: [] };
      groups.push(current);
    } else if (current && (key === 'allow' || key === 'disallow')) {
      current.rules.push({ kind: key, path: value });
    }
  }
  return groups;
}

function matchesAgent(rule: RobotsRule, agent: string): boolean {
  if (rule.userAgent === '*') return true;
  return agent.toLowerCase().includes(rule.userAgent.toLowerCase());
}

function isAllowedByRules(rules: RobotsRule[], agent: string, path: string): boolean {
  // Standard semantics: pick the single most specific user-agent group that matches
  // and apply only its rules. A specific group (substring match) wins over the
  // wildcard group ("*"). Multiple specific groups are merged.
  const specific = rules.filter((r) => r.userAgent !== '*' && matchesAgent(r, agent));
  const groups = specific.length > 0 ? specific : rules.filter((r) => r.userAgent === '*');
  let matchedAllow: number | null = null;
  let matchedDisallow: number | null = null;
  for (const rule of groups) {
    for (const r of rule.rules) {
      if (!r.path) continue;
      if (path.startsWith(r.path)) {
        if (r.kind === 'allow' && (matchedAllow === null || r.path.length > matchedAllow)) {
          matchedAllow = r.path.length;
        } else if (
          r.kind === 'disallow' &&
          (matchedDisallow === null || r.path.length > matchedDisallow)
        ) {
          matchedDisallow = r.path.length;
        }
      }
    }
  }
  if (matchedAllow !== null && matchedDisallow !== null) return matchedAllow >= matchedDisallow;
  if (matchedDisallow !== null) return false;
  return true;
}

const defaultFetcher = async (url: string): Promise<{ status: number; body: string }> => {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
};

export class RobotsCache {
  private readonly cache = new Map<string, RobotsCacheEntry>();
  private readonly recheckIntervalMs: number;
  private readonly fetcher: (url: string) => Promise<{ status: number; body: string }>;
  private readonly now: () => number;
  private readonly obey: boolean;
  private readonly allowHosts: Set<string>;

  constructor(opts: RobotsCacheOptions) {
    this.recheckIntervalMs = Math.max(1000, opts.recheckIntervalSeconds * 1000);
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.now = opts.now ?? Date.now;
    this.obey = opts.obey ?? true;
    this.allowHosts = new Set((opts.allowHosts ?? []).map((h) => h.toLowerCase()));
  }

  private async load(origin: string): Promise<RobotsCacheEntry> {
    const url = `${origin}/robots.txt`;
    const res = await this.fetcher(url);
    const rules = res.status >= 200 && res.status < 300 ? parseRobotsTxt(res.body) : [];
    return { fetchedAt: this.now(), rules };
  }

  async ageSeconds(origin: string): Promise<number | undefined> {
    const entry = this.cache.get(origin);
    if (!entry) return undefined;
    return (this.now() - entry.fetchedAt) / 1000;
  }

  async isAllowed(targetUrl: string, userAgent: string): Promise<boolean> {
    if (!this.obey) return true;
    let url: URL;
    try {
      url = new URL(targetUrl);
    } catch {
      return false;
    }
    if (this.allowHosts.has(url.host.toLowerCase())) return true;
    const origin = url.origin;
    let entry = this.cache.get(origin);
    if (!entry || this.now() - entry.fetchedAt > this.recheckIntervalMs) {
      entry = await this.load(origin);
      this.cache.set(origin, entry);
    }
    return isAllowedByRules(entry.rules, userAgent, `${url.pathname}${url.search}`);
  }
}
