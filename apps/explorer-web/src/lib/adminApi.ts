// Admin platform settings API client (spec 019). Same-origin (cookies flow through Oathkeeper).

export interface AdminLlm {
  kind: string;
  model: string;
  baseUrl: string | null;
  apiKeyMasked: boolean;
  apiKeyHint: string | null;
}

export interface AdminToggles {
  freshnessSloSeconds?: number;
  chatEnabled?: boolean;
  defaultTokenLimit?: number;
}

export interface AdminSettings {
  llm: AdminLlm | null;
  toggles: AdminToggles;
  source: 'settings' | 'env';
}

export interface SettingsPut {
  llm?: { kind: string; model: string; baseUrl?: string | null; apiKey?: string };
  toggles?: AdminToggles;
}

export interface AdminUsageRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'user';
  tokenLimit: number | null; // per-user override
  used: number;
  input: number;
  output: number;
  cached: number; // cache-hit input tokens (a subset of input)
  limit: number; // effective (0 = unlimited)
  remaining: number | null;
  exceeded: boolean;
  requests: number;
  lastUsedAt: string | null;
}

export interface AdminUsage {
  users: AdminUsageRow[];
  defaultLimit: number;
}

export async function getSettings(): Promise<AdminSettings> {
  const res = await fetch('/api/admin/settings', { credentials: 'include' });
  if (!res.ok) throw new Error(`settings request failed: ${res.status}`);
  return (await res.json()) as AdminSettings;
}

export async function putSettings(body: SettingsPut): Promise<AdminSettings> {
  const res = await fetch('/api/admin/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`settings update failed: ${res.status}`);
  return (await res.json()) as AdminSettings;
}

export async function getUsage(): Promise<AdminUsage> {
  const res = await fetch('/api/admin/usage', { credentials: 'include' });
  if (!res.ok) throw new Error(`usage request failed: ${res.status}`);
  return (await res.json()) as AdminUsage;
}

export async function setUserLimit(userId: string, limit: number | null): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}/limit`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) throw new Error(`set limit failed: ${res.status}`);
}

export async function resetUserUsage(userId: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}/reset`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}
