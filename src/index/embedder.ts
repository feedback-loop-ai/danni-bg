export interface Embedder {
  readonly id: string;
  readonly dimension: number;
  /**
   * Optional capability signal (002-batch-embedding, FR-005, R3): the provider's hard
   * per-request cap. `maxBatchSize === 1` STATICALLY forces single-text mode in the batcher
   * (one text per request) — a *capability*, distinct from the FR-004 transient single-text
   * retry. Unset means the provider declares no cap and is exercised through real batching.
   */
  readonly maxBatchSize?: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
