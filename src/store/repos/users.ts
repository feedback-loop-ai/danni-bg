import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

export type UserRole = 'admin' | 'user';

export interface UserRow {
  id: string;
  kratos_identity_id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  email_verified: number; // SQLite boolean (0/1)
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface FindOrCreateInput {
  kratosIdentityId: string;
  email: string;
  emailVerified?: boolean;
  displayName?: string | null;
  /** Tier to assign IF the row is created (e.g. admin bootstrap). Existing rows keep their role. */
  createRole?: UserRole;
  now?: string;
}

/**
 * App-side users keyed by the Kratos identity id. The identity itself lives in Kratos; this table
 * adds the access tier (`role`) and login bookkeeping. Mirrors the other repos: a plain class over
 * the shared `bun:sqlite` Database.
 */
export class UsersRepo {
  constructor(private readonly db: Database) {}

  get(id: string): UserRow | null {
    return this.db.query<UserRow, [string]>('SELECT * FROM users WHERE id = ?').get(id) ?? null;
  }

  findByKratosId(kratosIdentityId: string): UserRow | null {
    return (
      this.db
        .query<UserRow, [string]>('SELECT * FROM users WHERE kratos_identity_id = ?')
        .get(kratosIdentityId) ?? null
    );
  }

  findByEmail(email: string): UserRow | null {
    return this.db.query<UserRow, [string]>('SELECT * FROM users WHERE email = ?').get(email) ?? null;
  }

  /**
   * Find the user for a Kratos identity, creating it on first sight. Idempotent on
   * `kratos_identity_id`: an existing row has its email/verification refreshed and `last_login_at`
   * bumped (it keeps its role); a new row is inserted with `createRole` (default 'user').
   */
  findOrCreateByKratosId(input: FindOrCreateInput): UserRow {
    const now = input.now ?? nowIso();
    const verified = input.emailVerified ? 1 : 0;
    const existing = this.findByKratosId(input.kratosIdentityId);
    if (existing) {
      // `display_name` is COALESCEd so a session carrying a name (the Kratos whoami path) keeps it
      // current after a profile edit, while one without (e.g. header-only) leaves the name intact.
      this.db
        .query(
          'UPDATE users SET email = ?, email_verified = ?, display_name = COALESCE(?, display_name), last_login_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(input.email, verified, input.displayName ?? null, now, now, existing.id);
      return this.get(existing.id) as UserRow;
    }
    const id = crypto.randomUUID();
    this.db
      .query(
        `INSERT INTO users (id, kratos_identity_id, email, display_name, role, email_verified, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kratosIdentityId,
        input.email,
        input.displayName ?? null,
        input.createRole ?? 'user',
        verified,
        now,
        now,
        now,
      );
    return this.get(id) as UserRow;
  }

  /** Set a user's tier by email. Returns true if a row was updated. Used by `danni admin-grant`. */
  setRoleByEmail(email: string, role: UserRole, now: string = nowIso()): boolean {
    const res = this.db
      .query('UPDATE users SET role = ?, updated_at = ? WHERE email = ?')
      .run(role, now, email);
    return res.changes > 0;
  }

  listAll(): UserRow[] {
    return this.db.query<UserRow, []>('SELECT * FROM users ORDER BY created_at').all();
  }
}
