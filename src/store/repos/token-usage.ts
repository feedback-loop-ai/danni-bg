import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

export interface TokenUsageInput {
  userId: string;
  sessionId?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  now?: string;
}

export interface UserUsage {
  used: number; // total tokens since the user's reset window
  requests: number;
  lastUsedAt: string | null;
}

/** Per-user usage joined with the user's tier + effective limit, for the admin overview. */
export interface UserUsageRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'user';
  tokenLimit: number | null; // per-user override (null = platform default)
  used: number;
  requests: number;
  lastUsedAt: string | null;
  resetAt: string | null;
}

/**
 * Records and aggregates per-user LLM token usage. Usage is always counted from the user's
 * `usage_reset_at` (NULL = all time), so an admin "reset" bumps that timestamp instead of deleting
 * rows. Plain class over the shared `bun:sqlite` Database, like the other repos.
 */
export class TokenUsageRepo {
  constructor(private readonly db: Database) {}

  record(input: TokenUsageInput): void {
    this.db
      .query(
        `INSERT INTO token_usage (id, user_id, session_id, model, input_tokens, output_tokens, total_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        input.userId,
        input.sessionId ?? null,
        input.model ?? null,
        Math.max(0, Math.trunc(input.inputTokens || 0)),
        Math.max(0, Math.trunc(input.outputTokens || 0)),
        Math.max(0, Math.trunc(input.totalTokens || 0)),
        input.now ?? nowIso(),
      );
  }

  /** Usage for one user since `resetAt` (null → all time). */
  usageForUser(userId: string, resetAt: string | null): UserUsage {
    const row = this.db
      .query<{ used: number | null; requests: number; last_used: string | null }, [string, string]>(
        `SELECT COALESCE(SUM(total_tokens), 0) AS used, COUNT(*) AS requests, MAX(created_at) AS last_used
         FROM token_usage WHERE user_id = ? AND created_at >= ?`,
      )
      .get(userId, resetAt ?? '');
    return {
      used: row?.used ?? 0,
      requests: row?.requests ?? 0,
      lastUsedAt: row?.last_used ?? null,
    };
  }

  /** Per-user overview for admins: every user with their tier, effective-limit override, and usage. */
  summaryByUser(): UserUsageRow[] {
    return this.db
      .query<
        {
          user_id: string;
          email: string;
          display_name: string | null;
          role: 'admin' | 'user';
          token_limit: number | null;
          reset_at: string | null;
          used: number;
          requests: number;
          last_used: string | null;
        },
        []
      >(
        `SELECT u.id AS user_id, u.email, u.display_name, u.role, u.token_limit, u.usage_reset_at AS reset_at,
                COALESCE(SUM(t.total_tokens), 0) AS used,
                COUNT(t.id) AS requests,
                MAX(t.created_at) AS last_used
         FROM users u
         LEFT JOIN token_usage t
           ON t.user_id = u.id AND t.created_at >= COALESCE(u.usage_reset_at, '')
         GROUP BY u.id
         ORDER BY used DESC, u.email ASC`,
      )
      .all()
      .map((r) => ({
        userId: r.user_id,
        email: r.email,
        displayName: r.display_name,
        role: r.role,
        tokenLimit: r.token_limit,
        used: r.used,
        requests: r.requests,
        lastUsedAt: r.last_used,
        resetAt: r.reset_at,
      }));
  }
}
