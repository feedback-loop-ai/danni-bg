// Readiness probe (spec 030, FR-138). Distinct from /healthz (quality/liveness): readiness answers
// "can this process serve requests right now?" — the DB is reachable and the schema is current. A
// deploy that forgot `db:migrate` (the per-turn-tokens 500 had exactly this cause) reports NOT ready
// instead of serving 500s. The provider/ freshness are reported for visibility but do NOT block
// readiness: the public browse + map work without an LLM provider (chat is separately gated).

import type { Database } from 'bun:sqlite';
import { pendingMigrations } from '../../../src/store/migrate.ts';
import type { PlatformSettingsRepo } from '../../../src/store/repos/platform-settings.ts';
import { resolveServerDefault } from './admin/resolve-default.ts';

export interface ReadinessReport {
  ready: boolean;
  checks: {
    db: boolean;
    migrationsCurrent: boolean;
    /** Informational: a default LLM provider is configured. Does NOT gate readiness. */
    providerConfigured: boolean;
  };
  /** Names of migrations discovered but not yet applied (diagnostics when not ready). */
  pending?: string[];
}

export interface ReadinessDeps {
  db: Database;
  migrationsDir: string;
  settings?: PlatformSettingsRepo | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export function checkReadiness(deps: ReadinessDeps): ReadinessReport {
  let db = false;
  try {
    deps.db.query('SELECT 1').get();
    db = true;
  } catch {
    db = false;
  }

  let pending: string[] = [];
  let migrationsCurrent = false;
  try {
    pending = pendingMigrations(deps.db, deps.migrationsDir).map((m) => `${m.version}_${m.name}`);
    migrationsCurrent = pending.length === 0;
  } catch {
    migrationsCurrent = false;
  }

  let providerConfigured = false;
  try {
    providerConfigured = deps.settings
      ? resolveServerDefault(deps.settings, deps.env ?? process.env) != null
      : false;
  } catch {
    providerConfigured = false;
  }

  // Readiness gates ONLY on the hard prerequisites to serve traffic safely.
  const ready = db && migrationsCurrent;
  return {
    ready,
    checks: { db, migrationsCurrent, providerConfigured },
    ...(pending.length > 0 ? { pending } : {}),
  };
}
