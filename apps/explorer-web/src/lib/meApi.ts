// Per-user self API client (token metering): the caller's own token usage + quota.

export interface MyUsage {
  used: number;
  limit: number; // 0 = unlimited
  remaining: number | null; // null = unlimited
  exceeded: boolean;
  requests: number;
  lastUsedAt: string | null;
}

export async function getMyUsage(): Promise<MyUsage> {
  const res = await fetch('/api/me/usage', { credentials: 'include' });
  if (!res.ok) throw new Error(`usage request failed: ${res.status}`);
  return (await res.json()) as MyUsage;
}
