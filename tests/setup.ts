import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

declare global {
  var __TEST_TMP_DIR__: string;
}

beforeEach(() => {
  globalThis.__TEST_TMP_DIR__ = mkdtempSync(join(tmpdir(), 'danni-test-'));
});

afterEach(() => {
  if (globalThis.__TEST_TMP_DIR__) {
    rmSync(globalThis.__TEST_TMP_DIR__, { recursive: true, force: true });
  }
});
