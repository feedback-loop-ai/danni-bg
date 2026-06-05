// Provider seam (T046/T053). Selects an AI SDK language model from the per-request ProviderConfig:
// any OpenAI-compatible endpoint (configurable baseURL — covers OpenAI + self-hosted vLLM) or
// Anthropic, or the server-configured default. The apiKey is used only to construct the client and
// is never logged or persisted (FR-024). Missing/invalid config surfaces as a typed ProviderError so
// the route can emit a clean SSE `error` event with no fabricated content (FR-023).

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { z } from 'zod';

export const providerConfigSchema = z
  .object({
    kind: z.enum(['openai-compatible', 'anthropic']),
    baseUrl: z.string().nullable().optional(),
    model: z.string().min(1),
    apiKey: z.string().nullable().optional(),
    useServerDefault: z.boolean().optional(),
  })
  .strict();
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export interface ServerDefault {
  kind: 'openai-compatible' | 'anthropic';
  baseUrl?: string | undefined;
  model: string;
  apiKey?: string | undefined;
}

export type ProviderErrorCode = 'provider_unconfigured' | 'provider_error';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Read the server-default provider from the environment, or null when none is configured. */
export function serverDefaultFromEnv(env: NodeJS.ProcessEnv = process.env): ServerDefault | null {
  const kind = env.EXPLORER_DEFAULT_PROVIDER;
  if (kind !== 'openai-compatible' && kind !== 'anthropic') return null;
  const model = env.EXPLORER_DEFAULT_MODEL;
  if (!model) return null;
  return {
    kind,
    model,
    baseUrl: env.EXPLORER_DEFAULT_BASE_URL,
    apiKey: env.EXPLORER_DEFAULT_API_KEY,
  };
}

function build(
  kind: 'openai-compatible' | 'anthropic',
  model: string,
  baseUrl?: string,
  apiKey?: string,
): LanguageModelV3 {
  if (kind === 'anthropic') {
    return createAnthropic({
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    })(model);
  }
  return createOpenAI({
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  }).chat(model);
}

/**
 * Resolve a language model for a chat request. When `useServerDefault`, the server default is used
 * (its key from server config only); otherwise the user-supplied config is used and MUST carry a key.
 */
export function selectModel(
  config: ProviderConfig,
  serverDefault: ServerDefault | null,
): LanguageModelV3 {
  if (config.useServerDefault) {
    if (!serverDefault) {
      throw new ProviderError('provider_unconfigured', 'no server default provider is configured');
    }
    return build(
      serverDefault.kind,
      serverDefault.model,
      serverDefault.baseUrl,
      serverDefault.apiKey,
    );
  }
  if (!config.apiKey) {
    throw new ProviderError(
      'provider_unconfigured',
      'an API key is required for the selected provider',
    );
  }
  return build(config.kind, config.model, config.baseUrl ?? undefined, config.apiKey);
}
