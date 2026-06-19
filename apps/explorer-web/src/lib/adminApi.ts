// Admin platform settings API client (spec 019). Same-origin (cookies flow through Oathkeeper).

export interface AdminLlm {
  kind: string;
  model: string;
  baseUrl: string | null;
  apiKeyMasked: boolean;
  apiKeyHint: string | null;
}

export interface AdminSettings {
  llm: AdminLlm | null;
  toggles: { freshnessSloSeconds?: number; chatEnabled?: boolean };
  source: 'settings' | 'env';
}

export interface SettingsPut {
  llm?: { kind: string; model: string; baseUrl?: string | null; apiKey?: string };
  toggles?: { freshnessSloSeconds?: number; chatEnabled?: boolean };
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
