// Per-user chat-token quota math (token metering). Pure so it's unit-tested and shared by the chat
// gate (enforcement), the admin overview, and the per-user self view.

export interface QuotaView {
  used: number;
  limit: number; // effective limit; 0 = unlimited
  remaining: number | null; // null = unlimited
  exceeded: boolean;
}

/** Cache-hit input tokens count toward the quota at this weight (they're far cheaper). */
export const CACHE_WEIGHT = 0.1;

/**
 * Tokens that count toward the quota. Cache-hit input tokens are discounted to CACHE_WEIGHT of their
 * raw count (the rest of `total` counts in full): billable = total − (1 − weight)·cached.
 */
export function billableTokens(
  total: number,
  cached: number,
  weight: number = CACHE_WEIGHT,
): number {
  const capped = Math.min(Math.max(0, cached), Math.max(0, total));
  return Math.max(0, Math.round(total - (1 - weight) * capped));
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
