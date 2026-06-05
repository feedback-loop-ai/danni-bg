import { describe, expect, it } from 'bun:test';
import { log, redact } from '../src/logging.ts';

describe('redact', () => {
  it('redacts secret-named fields at the top level', () => {
    expect(redact({ apiKey: 'sk-123', model: 'gpt' })).toEqual({
      apiKey: '[redacted]',
      model: 'gpt',
    });
  });

  it('redacts secrets nested inside provider objects', () => {
    expect(redact({ provider: { kind: 'anthropic', apiKey: 'sk', token: 't' } })).toEqual({
      provider: { kind: 'anthropic', apiKey: '[redacted]', token: '[redacted]' },
    });
  });

  it('passes through arrays and primitives untouched', () => {
    expect(redact({ tags: ['a', 'b'], n: 3, ok: true })).toEqual({
      tags: ['a', 'b'],
      n: 3,
      ok: true,
    });
  });
});

describe('log wrappers', () => {
  it('emit at each level without throwing and accept empty context', () => {
    expect(() => {
      log.info('explorer_test_info', { apiKey: 'sk' });
      log.warn('explorer_test_warn');
      log.error('explorer_test_error', { detail: 'x' });
    }).not.toThrow();
  });
});
