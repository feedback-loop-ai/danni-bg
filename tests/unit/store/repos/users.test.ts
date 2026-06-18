import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { UsersRepo } from '../../../../src/store/repos/users.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function open(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

describe('store.repos.users', () => {
  let db: Database;
  let repo: UsersRepo;
  beforeEach(() => {
    db = open();
    repo = new UsersRepo(db);
  });
  afterEach(() => db.close());

  it('creates a user on first sight (default role user) and is idempotent on kratos id', () => {
    const a = repo.findOrCreateByKratosId({
      kratosIdentityId: 'k1',
      email: 'a@example.com',
      emailVerified: true,
      now: '2026-06-19T00:00:00Z',
    });
    expect(a.role).toBe('user');
    expect(a.email_verified).toBe(1);
    expect(a.last_login_at).toBe('2026-06-19T00:00:00Z');

    // Second call for the same identity returns the same row (no duplicate), refreshes login/email.
    const b = repo.findOrCreateByKratosId({
      kratosIdentityId: 'k1',
      email: 'a2@example.com',
      now: '2026-06-20T00:00:00Z',
    });
    expect(b.id).toBe(a.id);
    expect(b.email).toBe('a2@example.com');
    expect(b.last_login_at).toBe('2026-06-20T00:00:00Z');
    expect(repo.listAll()).toHaveLength(1);
  });

  it('honors createRole on insert but keeps the role on later calls', () => {
    const created = repo.findOrCreateByKratosId({
      kratosIdentityId: 'k2',
      email: 'boss@example.com',
      createRole: 'admin',
    });
    expect(created.role).toBe('admin');
    // A subsequent login must NOT downgrade an existing admin even if createRole defaults to user.
    const again = repo.findOrCreateByKratosId({ kratosIdentityId: 'k2', email: 'boss@example.com' });
    expect(again.role).toBe('admin');
  });

  it('setRoleByEmail promotes/demotes and reports whether a row matched', () => {
    repo.findOrCreateByKratosId({ kratosIdentityId: 'k3', email: 'u@example.com' });
    expect(repo.setRoleByEmail('u@example.com', 'admin')).toBe(true);
    expect(repo.findByEmail('u@example.com')?.role).toBe('admin');
    expect(repo.setRoleByEmail('u@example.com', 'user')).toBe(true);
    expect(repo.findByEmail('u@example.com')?.role).toBe('user');
    expect(repo.setRoleByEmail('nobody@example.com', 'admin')).toBe(false);
  });

  it('round-trips a Cyrillic display name and looks up by kratos id / app id', () => {
    const u = repo.findOrCreateByKratosId({
      kratosIdentityId: 'k4',
      email: 'и@example.com',
      displayName: 'Иван Петров',
    });
    expect(repo.findByKratosId('k4')?.display_name).toBe('Иван Петров');
    expect(repo.get(u.id)?.display_name).toBe('Иван Петров');
    expect(repo.findByKratosId('missing')).toBeNull();
    expect(repo.get('missing')).toBeNull();
  });
});
