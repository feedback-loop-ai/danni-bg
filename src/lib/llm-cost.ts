// LLM cost estimation (spec 032, FR-153) — pure, for margin monitoring + anomaly alerts. Cost =
// input tokens × input price + output tokens × output price, with cached input tokens discounted by
// the same cache weight the billing uses (spec 021/026): a cached input token costs `cacheWeight × the
// input price` (weight 0 = cache hits are free, 1 = no discount). Prices are USD per 1M tokens.
//
// Pricing is data, not code: pass a table (admin-configurable / per-deployment). Unknown models cost 0
// (and should be flagged) rather than guessed.

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cached input tokens (a subset of inputTokens), discounted by the cache weight. */
  cachedInputTokens?: number;
}

/** Default per-model prices (USD / 1M tokens). Self-hosted models are free; extend per deployment. */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-8': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'deepseek-chat': { inputPerMTok: 0.27, outputPerMTok: 1.1 },
};

const clamp = (n: number) => Math.max(0, n || 0);

/**
 * Estimate the USD cost of one turn. Cached input tokens are billed at `cacheWeight ×` the input price
 * (default 0.1, matching the metering discount); the remaining (uncached) input tokens are full price.
 * Returns 0 for an unknown/free model.
 */
export function estimateCost(
  usage: TokenUsage,
  pricing: ModelPricing | undefined,
  cacheWeight = 0.1,
): number {
  if (!pricing) return 0;
  const input = clamp(usage.inputTokens);
  const output = clamp(usage.outputTokens);
  const cached = Math.min(clamp(usage.cachedInputTokens ?? 0), input);
  const uncachedInput = input - cached;
  const weight = Math.min(1, Math.max(0, cacheWeight));
  const inputCost = ((uncachedInput + cached * weight) * pricing.inputPerMTok) / 1_000_000;
  const outputCost = (output * pricing.outputPerMTok) / 1_000_000;
  return inputCost + outputCost;
}

/** Look up a model's price (exact id, else a prefix match), or undefined if unknown. */
export function pricingFor(
  modelId: string | null | undefined,
  table: Record<string, ModelPricing> = DEFAULT_PRICING,
): ModelPricing | undefined {
  if (!modelId) return undefined;
  if (table[modelId]) return table[modelId];
  const key = Object.keys(table).find((k) => modelId.startsWith(k));
  return key ? table[key] : undefined;
}
