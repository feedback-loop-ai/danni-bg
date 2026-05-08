import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
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
