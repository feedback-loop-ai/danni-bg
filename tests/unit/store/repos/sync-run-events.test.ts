import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { SyncRunEventsRepo } from '../../../../src/store/repos/sync-run-events.ts';
import { SyncRunsRepo } from '../../../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  new SyncRunsRepo(d).create({ id: 'r1', trigger: 'manual', scopeFilterJson: '{}' });
  return d;
}

describe('store.repos.sync-run-events', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('inserts and lists events', () => {
    const repo = new SyncRunEventsRepo(database);
    repo.insert({
      runId: 'r1',
      datasetId: 'd1',
      outcome: 'discovered',
    });
    repo.insert({
      runId: 'r1',
      datasetId: 'd1',
      resourceId: 'res1',
      outcome: 'captured',
      bytes: 100,
      sha256: 'a'.repeat(64),
      eventAt: '2026-05-08T00:00:01Z',
    });
    const list = repo.listByRun('r1');
    expect(list.length).toBe(2);
    const captured = list.find((e) => e.outcome === 'captured');
    expect(captured?.bytes).toBe(100);
    expect(captured?.resource_id).toBe('res1');
  });

  it('records failure events with reason and status', () => {
    const repo = new SyncRunEventsRepo(database);
    repo.insert({
      runId: 'r1',
      datasetId: 'd1',
      resourceId: 'res1',
      outcome: 'failed',
      failureReason: 'boom',
      httpStatus: 500,
    });
    const list = repo.listByRun('r1');
    expect(list[0]?.failure_reason).toBe('boom');
    expect(list[0]?.http_status).toBe(500);
  });

  it('countsByOutcome groups across the run', () => {
    const repo = new SyncRunEventsRepo(database);
    repo.insert({ runId: 'r1', datasetId: 'd1', outcome: 'discovered' });
    repo.insert({ runId: 'r1', datasetId: 'd2', outcome: 'discovered' });
    repo.insert({
      runId: 'r1',
      datasetId: 'd1',
      resourceId: 'res1',
      outcome: 'captured',
    });
    const counts = repo.countsByOutcome('r1');
    expect(counts.discovered).toBe(2);
    expect(counts.captured).toBe(1);
    expect(counts.failed).toBe(0);
  });

  it('insert OR REPLACE re-uses the same key', () => {
    const repo = new SyncRunEventsRepo(database);
    repo.insert({
      runId: 'r1',
      datasetId: 'd1',
      resourceId: 'res1',
      outcome: 'failed',
      failureReason: 'first',
      eventAt: '2026-05-08T00:00:00Z',
    });
    repo.insert({
      runId: 'r1',
      datasetId: 'd1',
      resourceId: 'res1',
      outcome: 'captured',
      eventAt: '2026-05-08T00:00:00Z',
    });
    const list = repo.listByRun('r1');
    expect(list.length).toBe(1);
    expect(list[0]?.outcome).toBe('captured');
  });
});
