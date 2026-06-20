// Validation + secret helpers for the admin platform settings (spec 019). The LLM provider reuses
// the ServerDefault shape; the API key is write-only over the wire (masked on read, kept on empty
// write, never logged).

import { z } from 'zod';

export const LLM_SETTING_KEY = 'llm.default';
export const TOGGLES_SETTING_KEY = 'toggles';

/** Stored value for the chat's default LLM provider (the ServerDefault shape). */
export const llmSettingSchema = z.object({
  kind: z.enum(['openai-compatible', 'anthropic']),
  model: z.string().min(1),
  baseUrl: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
});
export type LlmSetting = z.infer<typeof llmSettingSchema>;

/** Platform toggles (extensible). */
export const togglesSchema = z
  .object({
    freshnessSloSeconds: z.number().int().positive().optional(),
    chatEnabled: z.boolean().optional(),
    // Default per-user chat-token quota; 0 (or unset) = unlimited. A user's own `token_limit` overrides.
    defaultTokenLimit: z.number().int().nonnegative().optional(),
    // Weight (0–1) at which cache-hit input tokens count toward the quota; unset = 0.1.
    cachedTokenWeight: z.number().min(0).max(1).optional(),
  })
  .strict();
export type Toggles = z.infer<typeof togglesSchema>;

/** PUT /api/admin/settings body — any subset; the LLM apiKey is optional (empty = keep existing). */
export const settingsPutSchema = z
  .object({
    llm: llmSettingSchema.optional(),
    toggles: togglesSchema.optional(),
  })
  .strict();
export type SettingsPut = z.infer<typeof settingsPutSchema>;

/** Mask an API key for read responses — never return the raw value. */
export function maskApiKey(key: string | null | undefined): {
  apiKeyMasked: boolean;
  apiKeyHint: string | null;
} {
  if (!key) return { apiKeyMasked: false, apiKeyHint: null };
  return { apiKeyMasked: true, apiKeyHint: `••••${key.slice(-4)}` };
}

/** On write: an omitted/empty incoming key keeps the existing stored key. */
export function mergeSecret(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  if (incoming === undefined || incoming === null || incoming === '') return existing ?? null;
  return incoming;
}
