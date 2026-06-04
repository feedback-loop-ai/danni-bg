import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { MigrationError } from '../../../src/lib/errors.ts';
import { discoverMigrations, runMigrations } from '../../../src/store/migrate.ts';

function makeMigrations(dir: string, files: Array<[string, string]>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, sql] of files) writeFileSync(join(dir, name), sql);
}

function newDb(): Database {
  return new Database(':memory:');
}

describe('migrate.discoverMigrations', () => {
  it('returns ordered Migration entries from a directory', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [
      ['002_b.sql', 'CREATE TABLE b (id INTEGER);'],
      ['001_a.sql', 'CREATE TABLE a (id INTEGER);'],
      ['readme.md', 'ignored'],
    ]);
    const m = discoverMigrations(dir);
    expect(m.map((x) => x.version)).toEqual([1, 2]);
    expect(m[0]?.name).toBe('a');
    expect(m[1]?.name).toBe('b');
    expect(m[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('migrate.runMigrations', () => {
  it('applies all pending migrations on a fresh DB', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [
      ['001_a.sql', 'CREATE TABLE a (id INTEGER);'],
      ['002_b.sql', 'CREATE TABLE b (id INTEGER);'],
    ]);
    const db = newDb();
    const result = runMigrations(db, dir);
    expect(result.applied.map((m) => m.version)).toEqual([1, 2]);
    expect(result.skipped).toEqual([]);
    const tables = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all();
    expect(tables.map((t) => t.name)).toContain('a');
    expect(tables.map((t) => t.name)).toContain('b');
  });

  it('is idempotent: a second run applies nothing and skips known versions', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [['001_a.sql', 'CREATE TABLE a (id INTEGER);']]);
    const db = newDb();
    runMigrations(db, dir);
    const second = runMigrations(db, dir);
    expect(second.applied).toEqual([]);
    expect(second.skipped.map((m) => m.version)).toEqual([1]);
  });

  it('fails on checksum drift for an already-applied migration', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [['001_a.sql', 'CREATE TABLE a (id INTEGER);']]);
    const db = newDb();
    runMigrations(db, dir);
    writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (id TEXT);');
    expect(() => runMigrations(db, dir)).toThrow(MigrationError);
  });

  it('rolls back a failing migration in a transaction', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [['001_a.sql', 'CREATE TABLE a (id INTEGER); BAD SQL;']]);
    const db = newDb();
    expect(() => runMigrations(db, dir)).toThrow(MigrationError);
    const tables = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='a'",
    ).all();
    expect(tables).toEqual([]);
  });

  it('ignores non-matching files in the migrations directory', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [
      ['001_a.sql', 'CREATE TABLE a (id INTEGER);'],
      ['notes.txt', 'ignored'],
      ['no-prefix.sql', 'CREATE TABLE x (id INTEGER);'],
    ]);
    const db = newDb();
    const result = runMigrations(db, dir);
    expect(result.applied.map((m) => m.version)).toEqual([1]);
  });
});

describe('migrate duplicate-prefix guard (003 T002)', () => {
  it('discoverMigrations throws MigrationError when two files share a numeric prefix', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [
      ['001_a.sql', 'CREATE TABLE a (id INTEGER);'],
      ['004_index_failures.sql', 'CREATE TABLE f (id INTEGER);'],
      ['004_index_state.sql', 'CREATE TABLE s (id INTEGER);'],
    ]);
    expect(() => discoverMigrations(dir)).toThrow(MigrationError);
  });

  it('runMigrations throws MigrationError on a duplicate numeric prefix', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [
      ['005_x.sql', 'CREATE TABLE x (id INTEGER);'],
      ['005_y.sql', 'CREATE TABLE y (id INTEGER);'],
    ]);
    const db = newDb();
    expect(() => runMigrations(db, dir)).toThrow(MigrationError);
  });

  it('the guard surfaces the colliding prefix in the error message', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [
      ['006_alpha.sql', 'CREATE TABLE a (id INTEGER);'],
      ['006_beta.sql', 'CREATE TABLE b (id INTEGER);'],
    ]);
    expect(() => discoverMigrations(dir)).toThrow(/Duplicate migration prefix 6/);
    expect(() => discoverMigrations(dir)).toThrow(/alpha/);
  });

  it('distinct prefixes still apply in order (guard does not over-trigger)', () => {
    const dir = join(globalThis.__TEST_TMP_DIR__, 'migrations');
    makeMigrations(dir, [
      ['004_a.sql', 'CREATE TABLE a (id INTEGER);'],
      ['005_b.sql', 'CREATE TABLE b (id INTEGER);'],
      ['006_c.sql', 'CREATE TABLE c (id INTEGER);'],
    ]);
    const db = newDb();
    const result = runMigrations(db, dir);
    expect(result.applied.map((m) => m.version)).toEqual([4, 5, 6]);
  });
});
