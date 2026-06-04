import { describe, expect, it } from 'bun:test';
import { EmbedderConfigSchema, effectiveBatchSize } from '../../../src/config/schema.ts';

const BASE = { provider: 'local-onnx' as const };

describe('config.EmbedderConfigSchema batchSize/maxBatchSize (FR-002)', () => {
  it('defaults batchSize to 32 when omitted', () => {
    const cfg = EmbedderConfigSchema.parse(BASE);
    expect(cfg.batchSize).toBe(32);
  });

  it('accepts batchSize 1 (lower bound)', () => {
    expect(EmbedderConfigSchema.parse({ ...BASE, batchSize: 1 }).batchSize).toBe(1);
  });

  it('accepts batchSize 256 (upper bound)', () => {
    expect(EmbedderConfigSchema.parse({ ...BASE, batchSize: 256 }).batchSize).toBe(256);
  });

  it('rejects batchSize 0 (below range)', () => {
    expect(() => EmbedderConfigSchema.parse({ ...BASE, batchSize: 0 })).toThrow();
  });

  it('rejects batchSize 257 (above range)', () => {
    expect(() => EmbedderConfigSchema.parse({ ...BASE, batchSize: 257 })).toThrow();
  });

  it('rejects a non-integer batchSize', () => {
    expect(() => EmbedderConfigSchema.parse({ ...BASE, batchSize: 12.5 })).toThrow();
  });

  it('leaves maxBatchSize unset by default', () => {
    expect(EmbedderConfigSchema.parse(BASE).maxBatchSize).toBeUndefined();
  });

  it('accepts maxBatchSize within 1–256', () => {
    expect(EmbedderConfigSchema.parse({ ...BASE, maxBatchSize: 128 }).maxBatchSize).toBe(128);
  });

  it('accepts an explicit null maxBatchSize (no cap)', () => {
    expect(EmbedderConfigSchema.parse({ ...BASE, maxBatchSize: null }).maxBatchSize).toBeNull();
  });

  it('rejects maxBatchSize 0 and 257', () => {
    expect(() => EmbedderConfigSchema.parse({ ...BASE, maxBatchSize: 0 })).toThrow();
    expect(() => EmbedderConfigSchema.parse({ ...BASE, maxBatchSize: 257 })).toThrow();
  });

  it('keeps the existing fields and stays strict (rejects unknown keys)', () => {
    expect(() => EmbedderConfigSchema.parse({ ...BASE, bogus: 1 })).toThrow();
    const cfg = EmbedderConfigSchema.parse({
      provider: 'hosted-api',
      endpointUrl: 'https://api.example.com/v1/embeddings',
      apiKeyEnv: 'EMBED_API_KEY',
      modelId: 'm',
    });
    expect(cfg.provider).toBe('hosted-api');
  });
});

describe('config.effectiveBatchSize (FR-002, data-model §2)', () => {
  it('returns batchSize when no caps are present', () => {
    expect(effectiveBatchSize(64)).toBe(64);
    expect(effectiveBatchSize(64, undefined, undefined)).toBe(64);
    expect(effectiveBatchSize(64, null, null)).toBe(64);
  });

  it('applies the config maxBatchSize cap (min wins)', () => {
    expect(effectiveBatchSize(64, 32)).toBe(32);
    expect(effectiveBatchSize(16, 32)).toBe(16);
  });

  it('applies the provider cap (min wins)', () => {
    expect(effectiveBatchSize(64, undefined, 8)).toBe(8);
    expect(effectiveBatchSize(64, 128, 8)).toBe(8);
  });

  it('a config or provider cap of 1 yields effective 1 (forced single)', () => {
    expect(effectiveBatchSize(64, 1)).toBe(1);
    expect(effectiveBatchSize(64, undefined, 1)).toBe(1);
  });

  it('treats null caps as unset (no cap)', () => {
    expect(effectiveBatchSize(64, null, 8)).toBe(8);
    expect(effectiveBatchSize(64, 16, null)).toBe(16);
  });
});
