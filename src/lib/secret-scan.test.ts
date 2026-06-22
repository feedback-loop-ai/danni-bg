import { describe, expect, it } from 'bun:test';
import { auditSecrets, isPlaceholder } from './secret-scan.ts';

describe('secret-scan (spec 030)', () => {
  const realSecrets = {
    KRATOS_SECRETS_COOKIE: 'b7f3c1d9e2a45f6890ab12cd34ef56a7',
    KRATOS_SECRETS_CIPHER: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
  };

  it('isPlaceholder catches the committed dev placeholders', () => {
    expect(isPlaceholder('PLEASE-CHANGE-ME-I-AM-VERY-INSECURE')).toBe(true);
    expect(isPlaceholder('32-LONG-SECRET-NOT-SECURE-AT-ALL')).toBe(true);
    expect(isPlaceholder('kratos')).toBe(true);
    expect(isPlaceholder('EMPTY')).toBe(true);
    expect(isPlaceholder('a-genuinely-random-32-char-secret-x')).toBe(false);
  });

  it('is a no-op for dev-like profiles even with placeholders present', () => {
    const env = { DANNI_PROFILE: 'dev', KRATOS_SECRETS_COOKIE: 'PLEASE-CHANGE-ME' };
    const a = auditSecrets(env);
    expect(a.isDev).toBe(true);
    expect(a.violations).toEqual([]);
    // ci is treated as dev-like too.
    expect(auditSecrets({ ...env, DANNI_PROFILE: 'ci' }).violations).toEqual([]);
  });

  it('flags placeholder values on secret-named vars for a non-dev profile', () => {
    const a = auditSecrets({
      DANNI_PROFILE: 'production',
      ...realSecrets,
      EXPLORER_DEFAULT_API_KEY: 'EMPTY',
      POSTGRES_PASSWORD: 'kratos',
    });
    expect(a.isDev).toBe(false);
    const names = a.violations.map((v) => v.name).sort();
    expect(names).toEqual(['EXPLORER_DEFAULT_API_KEY', 'POSTGRES_PASSWORD']);
    expect(a.violations.every((v) => v.reason === 'placeholder')).toBe(true);
  });

  it('flags missing required secrets for a non-dev profile', () => {
    const a = auditSecrets({ DANNI_PROFILE: 'staging' });
    const missing = a.violations.filter((v) => v.reason === 'missing').map((v) => v.name);
    expect(missing).toEqual(['KRATOS_SECRETS_COOKIE', 'KRATOS_SECRETS_CIPHER']);
  });

  it('passes (no violations) when a non-dev profile has real secrets', () => {
    const a = auditSecrets({ DANNI_PROFILE: 'production', ...realSecrets });
    expect(a.violations).toEqual([]);
  });

  it('does not flag a non-secret-named var that happens to contain a placeholder word', () => {
    const a = auditSecrets({
      DANNI_PROFILE: 'production',
      ...realSecrets,
      PUBLIC_HOST: 'example.com',
    });
    expect(a.violations).toEqual([]);
  });
});
