import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('integration.quickstart (T129)', () => {
  it('quickstart.md references files that exist', () => {
    const path = join(ROOT, 'specs/001-egov-data-sync/quickstart.md');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    // Each path-like reference of the form `path/to/file` should exist relative to repo root.
    const refs = [
      'package.json',
      'bunfig.toml',
      'migrations',
      'src/cli/danni.ts',
      'specs/001-egov-data-sync/contracts',
    ];
    for (const r of refs) {
      if (content.includes(r)) {
        expect(existsSync(join(ROOT, r))).toBe(true);
      }
    }
  });
});
