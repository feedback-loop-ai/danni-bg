import type { Embedder } from '../embedder.ts';

export interface LocalOnnxEmbedderOptions {
  modelId?: string;
  dimension?: number;
  /** Override the embedding function (used in tests). */
  embedFn?: (texts: string[]) => Promise<Float32Array[]>;
  /** Optional provider cap (FR-005); left unset by default so CI exercises real batching. */
  maxBatchSize?: number;
}

/**
 * v1 stub: a deterministic hash-based embedder. Real ONNX model bundling is a
 * follow-up; the operator may supply `embedFn` for genuine semantic vectors or
 * use the `hosted-api` provider.
 */
export class LocalOnnxEmbedder implements Embedder {
  readonly id: string;
  readonly dimension: number;
  readonly maxBatchSize?: number;
  private readonly fn: (texts: string[]) => Promise<Float32Array[]>;

  constructor(opts: LocalOnnxEmbedderOptions = {}) {
    this.id = `local-onnx:${opts.modelId ?? 'hash-stub-32'}`;
    this.dimension = opts.dimension ?? 32;
    if (opts.maxBatchSize !== undefined) this.maxBatchSize = opts.maxBatchSize;
    this.fn =
      opts.embedFn ??
      ((texts) => Promise.resolve(texts.map((t) => hashEmbedding(t, this.dimension))));
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    return this.fn(texts);
  }
}

function hashEmbedding(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    v[code % dim] = (v[code % dim] ?? 0) + 1;
  }
  // Normalize
  let mag = 0;
  for (let i = 0; i < dim; i++) mag += (v[i] ?? 0) * (v[i] ?? 0);
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / mag;
  return v;
}
