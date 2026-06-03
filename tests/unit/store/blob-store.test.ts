import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, tempPath } from '../../../src/lib/fs.ts';
import { BlobStore, extForFormat } from '../../../src/store/blob-store.ts';

function makeTempFile(parent: string, body: string): string {
  ensureDir(parent);
  const target = join(parent, 'pending.bin');
  const tmp = tempPath(target);
  writeFileSync(tmp, body);
  return tmp;
}

describe('store.blob-store', () => {
  it('extForFormat maps known formats and falls back to bin', () => {
    expect(extForFormat('csv')).toBe('csv');
    expect(extForFormat('CSV')).toBe('csv');
    expect(extForFormat('json')).toBe('json');
    expect(extForFormat('xlsx')).toBe('xlsx');
    expect(extForFormat(null)).toBe('bin');
    expect(extForFormat(undefined)).toBe('bin');
    expect(extForFormat('weird-FORMAT@@!')).toBe('weirdfor');
  });

  it('extForFormat returns bin if normalized form is empty', () => {
    expect(extForFormat('@@!')).toBe('bin');
  });

  it('put places file at content-addressed path and returns relPath', () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const blob = new BlobStore({ storeRoot });
    const tmp = makeTempFile(join(storeRoot, 'tmp'), 'hello');
    const result = blob.put({
      datasetId: 'd1',
      resourceId: 'r1',
      sha256: 'a'.repeat(64),
      bytes: 5,
      tempPath: tmp,
      declaredFormat: 'csv',
    });
    expect(result.reused).toBe(false);
    expect(result.relPath.endsWith('.csv')).toBe(true);
    expect(existsSync(result.absPath)).toBe(true);
    expect(readFileSync(result.absPath, 'utf-8')).toBe('hello');
  });

  it('put short-circuits when same hash already exists with matching size', () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const blob = new BlobStore({ storeRoot });
    const tmp1 = makeTempFile(join(storeRoot, 'tmp'), 'world');
    const first = blob.put({
      datasetId: 'd1',
      resourceId: 'r1',
      sha256: 'b'.repeat(64),
      bytes: 5,
      tempPath: tmp1,
      declaredFormat: 'csv',
    });
    expect(first.reused).toBe(false);
    const tmp2 = makeTempFile(join(storeRoot, 'tmp'), 'world');
    const second = blob.put({
      datasetId: 'd1',
      resourceId: 'r1',
      sha256: 'b'.repeat(64),
      bytes: 5,
      tempPath: tmp2,
      declaredFormat: 'csv',
    });
    expect(second.reused).toBe(true);
    // tmp file removed on reuse
    expect(existsSync(tmp2)).toBe(false);
  });

  it('exists() reflects on-disk state', () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const blob = new BlobStore({ storeRoot });
    expect(blob.exists('d1', 'r1', 'c'.repeat(64), 'json')).toBe(false);
    const tmp = makeTempFile(join(storeRoot, 'tmp'), '{}');
    blob.put({
      datasetId: 'd1',
      resourceId: 'r1',
      sha256: 'c'.repeat(64),
      bytes: 2,
      tempPath: tmp,
      declaredFormat: 'json',
    });
    expect(blob.exists('d1', 'r1', 'c'.repeat(64), 'json')).toBe(true);
  });

  it('put still proceeds (not reused) if sizes differ', () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const blob = new BlobStore({ storeRoot });
    const target = blob.pathFor('d1', 'r1', 'd'.repeat(64), 'csv');
    ensureDir(join(storeRoot, 'raw', 'd1', 'r1'));
    writeFileSync(target, 'short');
    const tmp = makeTempFile(join(storeRoot, 'tmp'), 'a much longer body');
    const result = blob.put({
      datasetId: 'd1',
      resourceId: 'r1',
      sha256: 'd'.repeat(64),
      bytes: 'a much longer body'.length,
      tempPath: tmp,
      declaredFormat: 'csv',
    });
    expect(result.reused).toBe(false);
  });

  it('put cleans up gracefully when temp file already removed', () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const blob = new BlobStore({ storeRoot });
    const tmp1 = makeTempFile(join(storeRoot, 'tmp'), 'first');
    blob.put({
      datasetId: 'd1',
      resourceId: 'r1',
      sha256: 'e'.repeat(64),
      bytes: 5,
      tempPath: tmp1,
      declaredFormat: 'csv',
    });
    // create another tmp at the same logical name then unlink before put runs
    const tmp2 = join(storeRoot, 'tmp', 'doesnt-exist.bin');
    const second = blob.put({
      datasetId: 'd1',
      resourceId: 'r1',
      sha256: 'e'.repeat(64),
      bytes: 5,
      tempPath: tmp2,
      declaredFormat: 'csv',
    });
    expect(second.reused).toBe(true);
  });
});
