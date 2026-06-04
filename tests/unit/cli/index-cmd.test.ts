import { describe, expect, it } from 'bun:test';
import { parseFlags, resolveMode } from '../../../src/cli/index-cmd.ts';
import type { DanniConfig } from '../../../src/config/schema.ts';

function cfg(incremental: boolean): DanniConfig['index'] {
  return { incremental };
}

describe('cli.index-cmd parseFlags', () => {
  it('parses --full', () => {
    expect(parseFlags(['--full']).full).toBe(true);
  });

  it('parses --datasets into a trimmed list', () => {
    expect(parseFlags(['--datasets', 'a, b ,c']).datasets).toEqual(['a', 'b', 'c']);
  });

  it('throws when --datasets has no value', () => {
    expect(() => parseFlags(['--datasets'])).toThrow();
  });

  it('throws __HELP__ on --help', () => {
    expect(() => parseFlags(['--help'])).toThrow('__HELP__');
  });

  it('throws on an unknown flag', () => {
    expect(() => parseFlags(['--nope'])).toThrow(/unknown flag/);
  });
});

describe('cli.index-cmd resolveMode (FR-009 precedence)', () => {
  it('--full overrides config (full:true, incremental:true is moot)', () => {
    const m = resolveMode({ full: true }, cfg(false));
    expect(m.full).toBe(true);
  });

  it('config.incremental=false (no --full) → incremental:false', () => {
    const m = resolveMode({}, cfg(false));
    expect(m.full).toBeUndefined();
    expect(m.incremental).toBe(false);
  });

  it('default (config true, no flag) → incremental:true', () => {
    const m = resolveMode({}, cfg(true));
    expect(m.incremental).toBe(true);
  });

  it('--full takes precedence over config=true too', () => {
    const m = resolveMode({ full: true }, cfg(true));
    expect(m.full).toBe(true);
  });

  it('passes through a --datasets subset', () => {
    const m = resolveMode({ datasets: ['x', 'y'] }, cfg(true));
    expect(m.datasetIds).toEqual(['x', 'y']);
  });

  it('omits datasetIds when no subset given', () => {
    const m = resolveMode({}, cfg(true));
    expect(m.datasetIds).toBeUndefined();
  });
});
