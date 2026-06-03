import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile, ensureDir, tempPath } from '../../../src/lib/fs.ts';

describe('fs.ensureDir', () => {
  it('creates nested directories idempotently', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'a', 'b', 'c');
    ensureDir(dir);
    ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('fs.atomicWriteFile', () => {
  it('writes a string file atomically and creates parent dirs', () => {
    const path = join(globalThis.__TEST_TMP_DIR__, 'sub', 'file.txt');
    atomicWriteFile(path, 'данни');
    expect(readFileSync(path, 'utf-8')).toBe('данни');
  });

  it('writes a Uint8Array buffer', () => {
    const path = join(globalThis.__TEST_TMP_DIR__, 'buf.bin');
    const buf = new Uint8Array([1, 2, 3, 4]);
    atomicWriteFile(path, buf);
    expect(Array.from(readFileSync(path))).toEqual([1, 2, 3, 4]);
  });

  it('overwrites an existing file', () => {
    const path = join(globalThis.__TEST_TMP_DIR__, 'twice.txt');
    atomicWriteFile(path, 'first');
    atomicWriteFile(path, 'second');
    expect(readFileSync(path, 'utf-8')).toBe('second');
  });
});

describe('fs.tempPath', () => {
  it('returns a path beneath the same parent', () => {
    const target = join(globalThis.__TEST_TMP_DIR__, 'thing.bin');
    const tmp = tempPath(target);
    expect(tmp.startsWith(target)).toBe(true);
    expect(tmp).not.toBe(target);
  });

  it('returns distinct paths on successive calls', () => {
    const a = tempPath('/x/y');
    const b = tempPath('/x/y');
    expect(a).not.toBe(b);
  });
});
