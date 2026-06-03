import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../lib/hash.ts';
import { MigrationError } from '../lib/errors.ts';
import { nowIso } from '../lib/time.ts';

export interface Migration {
  version: number;
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

const MIGRATION_RE = /^(\d+)_([A-Za-z0-9_-]+)\.sql$/;

export function discoverMigrations(dir: string): Migration[] {
  const entries = readdirSync(dir).sort();
  const migrations: Migration[] = [];
  for (const entry of entries) {
    const match = MIGRATION_RE.exec(entry);
    if (!match) continue;
    const versionStr = match[1];
    const name = match[2];
    if (!versionStr || !name) continue;
    const path = join(dir, entry);
    const sql = readFileSync(path, 'utf-8');
    const checksum = sha256Hex(sql);
    migrations.push({ version: Number.parseInt(versionStr, 10), name, path, sql, checksum });
  }
  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

export interface RunMigrationsResult {
  applied: Migration[];
  skipped: Migration[];
}

export function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function runMigrations(db: Database, dir: string): RunMigrationsResult {
  ensureMigrationsTable(db);
  const migrations = discoverMigrations(dir);
  const appliedRows = db
    .query<{ version: number; checksum: string; name: string }, []>(
      'SELECT version, checksum, name FROM schema_migrations',
    )
    .all();
  const appliedByVersion = new Map<number, { checksum: string; name: string }>();
  for (const row of appliedRows) appliedByVersion.set(row.version, row);

  const applied: Migration[] = [];
  const skipped: Migration[] = [];

  for (const m of migrations) {
    const prior = appliedByVersion.get(m.version);
    if (prior) {
      if (prior.checksum !== m.checksum) {
        throw new MigrationError(
          `Migration ${m.version}_${m.name} checksum mismatch (file changed since applied)`,
          { version: m.version, name: m.name, expectedChecksum: prior.checksum, actualChecksum: m.checksum },
        );
      }
      skipped.push(m);
      continue;
    }
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.query(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(m.version, m.name, m.checksum, nowIso());
    });
    try {
      tx();
    } catch (err) {
      throw new MigrationError(
        `Failed to apply migration ${m.version}_${m.name}: ${err instanceof Error ? err.message : String(err)}`,
        { version: m.version, name: m.name },
      );
    }
    applied.push(m);
  }

  return { applied, skipped };
}
