import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

interface SettingRow {
  key: string;
  value_json: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Extensible key/value platform settings (spec 019). Values are JSON; callers validate per-key on
 * read with a Zod schema (Constitution VII). Used by the admin settings API and the chat's default
 * provider resolution.
 */
export class PlatformSettingsRepo {
  constructor(private readonly db: Database) {}

  /** Parsed JSON value for a key, or null if unset. */
  get(key: string): unknown {
    const row = this.db
      .query<SettingRow, [string]>('SELECT * FROM platform_settings WHERE key = ?')
      .get(key);
    if (!row) return null;
    return JSON.parse(row.value_json);
  }

  set(key: string, value: unknown, updatedBy: string | null = null, now: string = nowIso()): void {
    this.db
      .query(
        `INSERT INTO platform_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(key, JSON.stringify(value), now, updatedBy);
  }

  all(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of this.db.query<SettingRow, []>('SELECT * FROM platform_settings').all()) {
      out[row.key] = JSON.parse(row.value_json);
    }
    return out;
  }
}
