import { describe, expect, it } from 'bun:test';
import type { ProviderConfig } from '../types.ts';
import {
  DEFAULT_PROVIDER,
  type StorageLike,
  loadProvider,
  saveProvider,
  toRequestProvider,
} from './providerStorage.ts';

function memStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('provider storage', () => {
  it('returns the default when nothing is stored', () => {
    expect(loadProvider(memStorage())).toEqual(DEFAULT_PROVIDER);
  });

  it('round-trips a saved config', () => {
    const storage = memStorage();
    const cfg: ProviderConfig = {
      kind: 'anthropic',
      baseUrl: null,
      model: 'claude',
      apiKey: 'sk',
      useServerDefault: false,
    };
    saveProvider(storage, cfg);
    expect(loadProvider(storage)).toEqual(cfg);
  });

  it('falls back to default on malformed JSON', () => {
    expect(loadProvider(memStorage({ 'danni.provider': '{not json' }))).toEqual(DEFAULT_PROVIDER);
  });

  it('merges partial stored config onto defaults', () => {
    const loaded = loadProvider(memStorage({ 'danni.provider': '{"model":"gpt"}' }));
    expect(loaded.model).toBe('gpt');
    expect(loaded.kind).toBe(DEFAULT_PROVIDER.kind);
  });

  it('toRequestProvider passes the config through', () => {
    expect(toRequestProvider(DEFAULT_PROVIDER)).toEqual(DEFAULT_PROVIDER);
  });
});
