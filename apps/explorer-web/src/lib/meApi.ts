// Per-user self API client (token metering): the caller's own token usage + quota.

export interface MyUsage {
  used: number;
  input: number;
  output: number;
  cached: number; // cache-hit input tokens (a subset of input)
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

export async function setMyAvatar(avatarUrl: string | null): Promise<void> {
  const res = await fetch('/api/me/avatar', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ avatarUrl }),
  });
  if (!res.ok) throw new Error(`avatar update failed: ${res.status}`);
}
