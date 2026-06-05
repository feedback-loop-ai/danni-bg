import { describe, expect, it } from 'bun:test';
import {
  type ProviderConfig,
  ProviderError,
  selectModel,
  serverDefaultFromEnv,
} from '../src/chat/providers.ts';

describe('serverDefaultFromEnv', () => {
  it('returns null when provider or model is missing/invalid', () => {
    expect(serverDefaultFromEnv({})).toBeNull();
    expect(
      serverDefaultFromEnv({ EXPLORER_DEFAULT_PROVIDER: 'bogus', EXPLORER_DEFAULT_MODEL: 'm' }),
    ).toBeNull();
    expect(serverDefaultFromEnv({ EXPLORER_DEFAULT_PROVIDER: 'anthropic' })).toBeNull();
  });

  it('reads a complete config from env', () => {
    const d = serverDefaultFromEnv({
      EXPLORER_DEFAULT_PROVIDER: 'openai-compatible',
      EXPLORER_DEFAULT_MODEL: 'qwen',
      EXPLORER_DEFAULT_BASE_URL: 'http://spark:8889/v1',
      EXPLORER_DEFAULT_API_KEY: 'sk',
    });
    expect(d).toEqual({
      kind: 'openai-compatible',
      model: 'qwen',
      baseUrl: 'http://spark:8889/v1',
      apiKey: 'sk',
    });
  });
});

describe('selectModel', () => {
  const oc: ProviderConfig = { kind: 'openai-compatible', model: 'gpt', apiKey: 'sk' };

  it('builds an openai-compatible model from a user key', () => {
    expect(selectModel(oc, null).modelId).toBe('gpt');
  });

  it('builds an anthropic model', () => {
    expect(selectModel({ kind: 'anthropic', model: 'claude', apiKey: 'sk' }, null).modelId).toBe(
      'claude',
    );
  });

  it('throws provider_unconfigured without a key and not using server default', () => {
    try {
      selectModel({ kind: 'anthropic', model: 'claude' }, null);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('provider_unconfigured');
    }
  });

  it('uses the server default when requested; errors when absent', () => {
    const sd = {
      kind: 'openai-compatible' as const,
      model: 'srv',
      baseUrl: 'http://x/v1',
      apiKey: 'k',
    };
    expect(selectModel({ ...oc, useServerDefault: true }, sd).modelId).toBe('srv');
    expect(() => selectModel({ ...oc, useServerDefault: true }, null)).toThrow(ProviderError);
  });
});
