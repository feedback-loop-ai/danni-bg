import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha256Hex } from './hash.ts';

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/** Leave a margin under the common 255-byte per-component filesystem limit. */
const MAX_SEGMENT_BYTES = 200;

/**
 * A filesystem-safe directory/file name for an arbitrary identifier. Most data.egov.bg uris are
 * short UUIDs and pass through verbatim; some are long human-readable titles that blow past the
 * 255-byte per-component limit (Cyrillic costs 2 bytes/char) or contain path separators — those
 * crashed `mkdir` mid-crawl. Such ids collapse to a deterministic sha256 prefix so the on-disk path
 * stays stable and unique. The logical id is unchanged; only the on-disk segment is derived.
 */
export function safePathSegment(id: string): string {
  const unsafe =
    id.length === 0 ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\') ||
    Buffer.byteLength(id, 'utf-8') > MAX_SEGMENT_BYTES;
  return unsafe ? sha256Hex(id).slice(0, 32) : id;
}

export function atomicWriteFile(path: string, data: string | Uint8Array): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const fd = openSync(tmp, 'w');
  try {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
    writeSync(fd, buffer);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export function tempPath(targetPath: string): string {
  return `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
}
