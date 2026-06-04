import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../src/store/migrate.ts';
import {
  CheckpointCorruptError,
  CrawlCheckpointsRepo,
} from '../../src/store/repos/crawl-checkpoints.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db, join(ROOT, 'migrations'));
  return db;
}

function seed(repo: CrawlCheckpointsRepo, frozenIds: string[] = ['a', 'b', 'c']) {
  return repo.createCampaign({
    scopeHash: 'sh1',
    scopeJson: { all: true },
    frozenIds,
  });
}

describe('store.crawl-checkpoints', () => {
  it('createCampaign defaults max_attempts to the fixed cap of 3 (FR-009)', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    const c = repo.getCampaign('sh1');
    expect(c?.max_attempts).toBe(3);
    expect(c?.status).toBe('active');
    expect(c?.total_datasets).toBe(3);
    expect(JSON.parse(c?.frozen_ids_json ?? '[]')).toEqual(['a', 'b', 'c']);
    expect(c?.cursor_uri).toBeNull();
    db.close();
  });

  it('getCampaign returns null when absent', () => {
    const db = freshDb();
    expect(new CrawlCheckpointsRepo(db).getCampaign('nope')).toBeNull();
    db.close();
  });

  it('frozenIds() and scope() parse the persisted JSON', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo, ['x', 'y']);
    expect(repo.frozenIds('sh1')).toEqual(['x', 'y']);
    expect(repo.scope('sh1')).toEqual({ all: true });
    db.close();
  });

  it('createCampaign accepts an explicit maxAttempts (reserved column, not used by CLI)', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    repo.createCampaign({
      scopeHash: 'sh2',
      scopeJson: { all: true },
      frozenIds: [],
      maxAttempts: 5,
    });
    expect(repo.getCampaign('sh2')?.max_attempts).toBe(5);
    db.close();
  });

  it('appendFrozenIds reconciles new uris preserving order, never reorders', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo, ['b', 'd']);
    repo.appendFrozenIds('sh1', ['a', 'c', 'b']); // 'b' already present (dedup), 'a','c' appended
    expect(repo.frozenIds('sh1')).toEqual(['b', 'd', 'a', 'c']);
    expect(repo.getCampaign('sh1')?.total_datasets).toBe(4);
    expect(repo.getCampaign('sh1')?.reconciled_at).not.toBeNull();
    db.close();
  });

  it('appendFrozenIds with no new uris is a no-op (still stamps reconciled_at)', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo, ['a']);
    repo.appendFrozenIds('sh1', ['a']);
    expect(repo.frozenIds('sh1')).toEqual(['a']);
    expect(repo.getCampaign('sh1')?.reconciled_at).not.toBeNull();
    db.close();
  });

  it('advanceCursor records the last completed uri + run id', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.advanceCursor('sh1', 'b', 'run-1');
    const c = repo.getCampaign('sh1');
    expect(c?.cursor_uri).toBe('b');
    expect(c?.last_run_id).toBe('run-1');
    db.close();
  });

  it('markCampaignCompleted flips status active→completed', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.markCampaignCompleted('sh1');
    expect(repo.getCampaign('sh1')?.status).toBe('completed');
    db.close();
  });

  it('upsertDataset creates then updates a per-dataset row (validator + counts)', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v1', resourceCount: 2 });
    let row = repo.getDataset('sh1', 'a');
    expect(row?.outcome).toBe('pending');
    expect(row?.validator).toBe('v1');
    expect(row?.resource_count).toBe(2);
    expect(row?.first_seen_at).not.toBeNull();
    // update keeps first_seen_at, bumps last_visited_at + validator
    const firstSeen = row?.first_seen_at;
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v2', resourceCount: 3 });
    row = repo.getDataset('sh1', 'a');
    expect(row?.validator).toBe('v2');
    expect(row?.resource_count).toBe(3);
    expect(row?.first_seen_at).toBe(firstSeen as string);
    db.close();
  });

  it('markDatasetComplete and markDatasetFailed (attempt++) transition the row', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v1', resourceCount: 1 });
    repo.markDatasetComplete('sh1', 'a');
    expect(repo.getDataset('sh1', 'a')?.outcome).toBe('complete');

    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'b', validator: 'v1', resourceCount: 1 });
    repo.markDatasetFailed('sh1', 'b', 'boom');
    let row = repo.getDataset('sh1', 'b');
    expect(row?.outcome).toBe('failed');
    expect(row?.attempts).toBe(1);
    expect(row?.last_failure_reason).toBe('boom');
    repo.markDatasetFailed('sh1', 'b', 'boom2');
    row = repo.getDataset('sh1', 'b');
    expect(row?.attempts).toBe(2);
    db.close();
  });

  it('upsertResource + markResourceSuccess records sha256/validator/captured_at', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v1', resourceCount: 1 });
    repo.upsertResource({ scopeHash: 'sh1', datasetUri: 'a', resourceUri: 'r1' });
    expect(repo.getResource('sh1', 'a', 'r1')?.outcome).toBe('pending');
    repo.markResourceSuccess({
      scopeHash: 'sh1',
      datasetUri: 'a',
      resourceUri: 'r1',
      sha256: 'abc',
      validator: 'v1',
    });
    const row = repo.getResource('sh1', 'a', 'r1');
    expect(row?.outcome).toBe('success');
    expect(row?.sha256).toBe('abc');
    expect(row?.validator).toBe('v1');
    expect(row?.captured_at).not.toBeNull();
    db.close();
  });

  it('markResourceFailed increments attempts and records reason', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v1', resourceCount: 1 });
    repo.upsertResource({ scopeHash: 'sh1', datasetUri: 'a', resourceUri: 'r1' });
    repo.markResourceFailed({ scopeHash: 'sh1', datasetUri: 'a', resourceUri: 'r1', reason: 'x' });
    expect(repo.getResource('sh1', 'a', 'r1')?.attempts).toBe(1);
    repo.markResourceFailed({ scopeHash: 'sh1', datasetUri: 'a', resourceUri: 'r1', reason: 'y' });
    const row = repo.getResource('sh1', 'a', 'r1');
    expect(row?.attempts).toBe(2);
    expect(row?.last_failure_reason).toBe('y');
    db.close();
  });

  it('listResources returns all resource rows for a dataset', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v1', resourceCount: 2 });
    repo.upsertResource({ scopeHash: 'sh1', datasetUri: 'a', resourceUri: 'r1' });
    repo.upsertResource({ scopeHash: 'sh1', datasetUri: 'a', resourceUri: 'r2' });
    expect(
      repo
        .listResources('sh1', 'a')
        .map((r) => r.resource_uri)
        .sort(),
    ).toEqual(['r1', 'r2']);
    db.close();
  });

  it('a row is capped at exactly attempts == max_attempts (== 3); a sub-cap failed row is NOT excluded', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo, ['a', 'b', 'c']);
    // 'a' complete
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v1', resourceCount: 0 });
    repo.markDatasetComplete('sh1', 'a');
    // 'b' failed but sub-cap (1 attempt) → counts as remaining (retry-eligible)
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'b', validator: 'v1', resourceCount: 0 });
    repo.markDatasetFailed('sh1', 'b', 'one');
    // 'c' failed at the cap (3 attempts) → excluded from remaining
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'c', validator: 'v1', resourceCount: 0 });
    repo.markDatasetFailed('sh1', 'c', '1');
    repo.markDatasetFailed('sh1', 'c', '2');
    repo.markDatasetFailed('sh1', 'c', '3');
    expect(repo.getDataset('sh1', 'c')?.attempts).toBe(3);

    expect(repo.remaining('sh1')).toBe(1); // only 'b' (sub-cap) remains; 'a' complete, 'c' capped
    db.close();
  });

  it('counts() reports discovered/captured/failed across datasets', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo, ['a', 'b']);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v', resourceCount: 0 });
    repo.markDatasetComplete('sh1', 'a');
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'b', validator: 'v', resourceCount: 0 });
    repo.markDatasetFailed('sh1', 'b', 'x');
    const counts = repo.counts('sh1');
    expect(counts.total).toBe(2);
    expect(counts.discovered).toBe(2);
    expect(counts.captured).toBe(1);
    expect(counts.failed).toBe(1);
    db.close();
  });

  it('listRetryableFailed returns only sub-cap failed datasets (FR-009)', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo, ['b', 'c']);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'b', validator: 'v', resourceCount: 0 });
    repo.markDatasetFailed('sh1', 'b', '1'); // attempts 1 < 3
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'c', validator: 'v', resourceCount: 0 });
    repo.markDatasetFailed('sh1', 'c', '1');
    repo.markDatasetFailed('sh1', 'c', '2');
    repo.markDatasetFailed('sh1', 'c', '3'); // capped
    expect(repo.listRetryableFailed('sh1')).toEqual(['b']);
    db.close();
  });

  it('reopenFailed sets a failed dataset back to pending (for --retry-failed)', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v', resourceCount: 0 });
    repo.markDatasetFailed('sh1', 'a', 'x');
    repo.reopenDataset('sh1', 'a');
    expect(repo.getDataset('sh1', 'a')?.outcome).toBe('pending');
    db.close();
  });

  it('CASCADE delete of a campaign drops its dataset + resource children', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    repo.upsertDataset({ scopeHash: 'sh1', datasetUri: 'a', validator: 'v', resourceCount: 1 });
    repo.upsertResource({ scopeHash: 'sh1', datasetUri: 'a', resourceUri: 'r1' });
    repo.deleteCampaign('sh1');
    expect(repo.getCampaign('sh1')).toBeNull();
    expect(repo.getDataset('sh1', 'a')).toBeNull();
    expect(repo.getResource('sh1', 'a', 'r1')).toBeNull();
    db.close();
  });

  it('frozenIds() throws CheckpointCorruptError on malformed frozen_ids_json (FR-008 boundary)', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    db.query('UPDATE crawl_checkpoints SET frozen_ids_json = ? WHERE scope_hash = ?').run(
      '{not an array}',
      'sh1',
    );
    expect(() => repo.frozenIds('sh1')).toThrow(CheckpointCorruptError);
    db.close();
  });

  it('frozenIds() throws CheckpointCorruptError when the array holds a non-string', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    db.query('UPDATE crawl_checkpoints SET frozen_ids_json = ? WHERE scope_hash = ?').run(
      '[1, 2, 3]',
      'sh1',
    );
    expect(() => repo.frozenIds('sh1')).toThrow(CheckpointCorruptError);
    db.close();
  });

  it('frozenIds() throws CheckpointCorruptError on invalid JSON syntax', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    db.query('UPDATE crawl_checkpoints SET frozen_ids_json = ? WHERE scope_hash = ?').run(
      'not json at all',
      'sh1',
    );
    expect(() => repo.frozenIds('sh1')).toThrow(CheckpointCorruptError);
    db.close();
  });

  it('scope() throws CheckpointCorruptError on malformed scope_json', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    seed(repo);
    db.query('UPDATE crawl_checkpoints SET scope_json = ? WHERE scope_hash = ?').run(
      '{"publishers": 5}',
      'sh1',
    );
    expect(() => repo.scope('sh1')).toThrow(CheckpointCorruptError);
    db.close();
  });

  it('scope() accepts the explicit four-array canonical form', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    repo.createCampaign({
      scopeHash: 'sh3',
      scopeJson: { publishers: ['p'], categories: [], tags: [], datasetIds: [] },
      frozenIds: [],
    });
    expect(repo.scope('sh3')).toEqual({
      publishers: ['p'],
      categories: [],
      tags: [],
      datasetIds: [],
    });
    db.close();
  });

  it('frozenIds()/scope() throw when the campaign is absent', () => {
    const db = freshDb();
    const repo = new CrawlCheckpointsRepo(db);
    expect(() => repo.frozenIds('absent')).toThrow(CheckpointCorruptError);
    expect(() => repo.scope('absent')).toThrow(CheckpointCorruptError);
    db.close();
  });
});
