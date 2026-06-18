// Pure settings helpers + provider resolution (spec 019, Phase C).

import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../src/store/migrate.ts';
import { PlatformSettingsRepo } from '../../../src/store/repos/platform-settings.ts';
import { resolveServerDefault } from '../src/admin/resolve-default.ts';
import { LLM_SETTING_KEY, maskApiKey, mergeSecret } from '../src/admin/settings-schema.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
function repo(): { db: Database; r: PlatformSettingsRepo } {
  const db = new Database(':memory:');
  runMigrations(db, join(ROOT, 'migrations'));
  return { db, r: new PlatformSettingsRepo(db) };
}

describe('admin settings helpers', () => {
  it('maskApiKey hides all but the last 4 chars', () => {
    expect(maskApiKey(null)).toEqual({ apiKeyMasked: false, apiKeyHint: null });
    expect(maskApiKey('')).toEqual({ apiKeyMasked: false, apiKeyHint: null });
    expect(maskApiKey('sk-abcd1234')).toEqual({ apiKeyMasked: true, apiKeyHint: '••••1234' });
  });

  it('mergeSecret keeps the existing key on empty/omitted input, replaces otherwise', () => {
    expect(mergeSecret(undefined, 'old')).toBe('old');
    expect(mergeSecret('', 'old')).toBe('old');
    expect(mergeSecret(null, 'old')).toBe('old');
    expect(mergeSecret('new', 'old')).toBe('new');
    expect(mergeSecret(undefined, undefined)).toBeNull();
  });

  describe('resolveServerDefault', () => {
    it('prefers the settings store over env', () => {
      const { db, r } = repo();
      r.set(LLM_SETTING_KEY, {
        kind: 'openai-compatible',
        model: 'deepseek-v4-pro',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-x',
      });
      expect(resolveServerDefault(r, { EXPLORER_DEFAULT_PROVIDER: 'anthropic' })).toEqual({
        kind: 'openai-compatible',
        model: 'deepseek-v4-pro',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-x',
      });
      db.close();
    });

    it('falls back to the env seed when no settings row exists', () => {
      const { db, r } = repo();
      const env = { EXPLORER_DEFAULT_PROVIDER: 'anthropic', EXPLORER_DEFAULT_MODEL: 'claude-x' };
      expect(resolveServerDefault(r, env)?.model).toBe('claude-x');
      db.close();
    });

    it('returns null when neither settings nor env are configured', () => {
      const { db, r } = repo();
      expect(resolveServerDefault(r, {})).toBeNull();
      db.close();
    });
  });
});
