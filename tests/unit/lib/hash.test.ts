import { describe, expect, it } from 'bun:test';
import { Sha256Stream, sha256Hex } from '../../../src/lib/hash.ts';

describe('hash.sha256Hex', () => {
  it('matches the well-known empty-string sha256', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes a UTF-8 Cyrillic string deterministically', () => {
    const a = sha256Hex('данни');
    const b = sha256Hex('данни');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('hashes raw bytes', () => {
    const buf = new Uint8Array([0x68, 0x69]);
    expect(sha256Hex(buf)).toBe(sha256Hex('hi'));
  });
});

describe('hash.Sha256Stream', () => {
  it('streams update + digest matches one-shot hash', () => {
    const s = new Sha256Stream();
    s.update(new TextEncoder().encode('foo'));
    s.update(new TextEncoder().encode('bar'));
    const { sha256, bytes } = s.digest();
    expect(sha256).toBe(sha256Hex('foobar'));
    expect(bytes).toBe(6);
  });

  it('throws on update after digest', () => {
    const s = new Sha256Stream();
    s.digest();
    expect(() => s.update(new Uint8Array(1))).toThrow(/update after digest/);
  });

  it('throws on double digest', () => {
    const s = new Sha256Stream();
    s.digest();
    expect(() => s.digest()).toThrow(/digest called twice/);
  });
});
