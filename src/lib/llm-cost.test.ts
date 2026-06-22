import { describe, expect, it } from 'bun:test';
import { DEFAULT_PRICING, estimateCost, pricingFor } from './llm-cost.ts';

describe('llm-cost (spec 032)', () => {
  const price = { inputPerMTok: 3, outputPerMTok: 15 };

  it('costs input + output at the per-MTok rate', () => {
    // 1M input @ $3 + 1M output @ $15 = $18 (no cache).
    expect(
      estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, price, 0.1),
    ).toBeCloseTo(18);
  });

  it('discounts cached input tokens by the cache weight', () => {
    // 1M input, all cached, weight 0 → input free; + 1M output @ $15.
    expect(
      estimateCost(
        { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 1_000_000 },
        price,
        0,
      ),
    ).toBeCloseTo(15);
    // weight 0.1 → cached input billed at 10%: 1M × 0.1 × $3 = $0.30, + $15 output.
    expect(
      estimateCost(
        { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 1_000_000 },
        price,
        0.1,
      ),
    ).toBeCloseTo(15.3);
  });

  it('returns 0 for an unknown/free model (no pricing)', () => {
    expect(estimateCost({ inputTokens: 1000, outputTokens: 1000 }, undefined)).toBe(0);
  });

  it('clamps negatives and caps cached at input', () => {
    expect(estimateCost({ inputTokens: -5, outputTokens: -1 }, price)).toBe(0);
    // cached > input is capped to input (so cost can't go negative).
    const c = estimateCost(
      { inputTokens: 100, outputTokens: 0, cachedInputTokens: 9999 },
      price,
      0,
    );
    expect(c).toBe(0);
  });

  it('pricingFor resolves exact + prefix, else undefined', () => {
    expect(pricingFor('claude-sonnet-4-6')).toEqual(DEFAULT_PRICING['claude-sonnet-4-6']);
    expect(pricingFor('claude-sonnet-4-6-20991231')).toEqual(DEFAULT_PRICING['claude-sonnet-4-6']);
    expect(pricingFor('some-local-model')).toBeUndefined();
    expect(pricingFor(null)).toBeUndefined();
  });
});
