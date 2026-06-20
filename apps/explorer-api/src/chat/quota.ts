// Per-user chat-token quota math (token metering). Pure so it's unit-tested and shared by the chat
// gate (enforcement), the admin overview, and the per-user self view.

export interface QuotaView {
  used: number;
  limit: number; // effective limit; 0 = unlimited
  remaining: number | null; // null = unlimited
  exceeded: boolean;
}

/** A user's own `token_limit` overrides (including an explicit 0 = unlimited for them); else the
 * platform default; else 0 = unlimited. */
export function effectiveLimit(userLimit: number | null, defaultLimit?: number): number {
  if (userLimit != null) return Math.max(0, userLimit);
  return Math.max(0, defaultLimit ?? 0);
}

export function quotaView(used: number, limit: number): QuotaView {
  const unlimited = limit <= 0;
  return {
    used,
    limit: unlimited ? 0 : limit,
    remaining: unlimited ? null : Math.max(0, limit - used),
    exceeded: !unlimited && used >= limit,
  };
}
