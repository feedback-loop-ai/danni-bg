import type { DanniConfig } from '../../config/schema.ts';
import type { Embedder } from '../embedder.ts';
import { HostedApiEmbedder } from './hosted-api.ts';
import { LocalOnnxEmbedder } from './local-onnx.ts';

/**
 * Build the configured embedder, shared by `danni index`, `danni search`, and `danni eval` so the
 * three never drift on provider selection. `hosted-api` targets any OpenAI-compatible `/embeddings`
 * endpoint (a hosted API, or a local server such as text-embeddings-inference / Ollama). The
 * `local-onnx` provider is a deterministic hash stub unless a real `embedFn` is injected — using it
 * emits a loud stderr warning so its (non-semantic) vectors are not mistaken for a real model.
 */
export function buildEmbedder(e: DanniConfig['enrichment']['embedder']): Embedder {
  if (e.provider === 'hosted-api') {
    if (!e.endpointUrl) throw new Error('embedder.endpointUrl is required for hosted-api');
    const bearer = e.apiKeyEnv ? process.env[e.apiKeyEnv] : undefined;
    return new HostedApiEmbedder({
      endpointUrl: e.endpointUrl,
      ...(bearer ? { bearer } : {}),
      ...(e.modelId ? { modelId: e.modelId } : {}),
      ...(e.dimension != null ? { dimension: e.dimension } : {}),
      ...(e.maxBatchSize != null ? { maxBatchSize: e.maxBatchSize } : {}),
    });
  }
  const embedder = new LocalOnnxEmbedder({
    ...(e.modelId ? { modelId: e.modelId } : {}),
    ...(e.dimension != null ? { dimension: e.dimension } : {}),
  });
  if (embedder.isStub) {
    process.stderr.write(
      `warning: embedder provider 'local-onnx' is a deterministic hash stub (${embedder.id}) — semantic ranking is NOT meaningful; only the FTS/keyword leg is real. Set enrichment.embedder.provider='hosted-api' for genuine semantic vectors.\n`,
    );
  }
  return embedder;
}
