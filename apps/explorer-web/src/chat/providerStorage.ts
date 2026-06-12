// Client-side provider config persistence (T054). The user's provider/model choice + key live only
// in the browser (localStorage) and are sent per request over TLS — never persisted server-side
// (FR-024). Pure functions over a Storage-like interface so they are unit-testable.

import type { ProviderConfig } from '../types.ts';

const KEY = 'danni.provider';

export const DEFAULT_PROVIDER: ProviderConfig = {
  kind: 'openai-compatible',
  baseUrl: null,
  // Non-empty placeholder so the request passes validation; ignored server-side when
  // useServerDefault is true (the server uses its own configured model).
  model: 'server-default',
  apiKey: null,
  useServerDefault: true,
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadProvider(storage: StorageLike): ProviderConfig {
  const raw = storage.getItem(KEY);
  if (!raw) return { ...DEFAULT_PROVIDER };
  try {
    return { ...DEFAULT_PROVIDER, ...(JSON.parse(raw) as Partial<ProviderConfig>) };
  } catch {
    return { ...DEFAULT_PROVIDER };
  }
}

export function saveProvider(storage: StorageLike, config: ProviderConfig): void {
  storage.setItem(KEY, JSON.stringify(config));
}

/** Build the per-request provider payload (used by the chat POST body). */
export function toRequestProvider(config: ProviderConfig): ProviderConfig {
  return config;
}
