// Resolve the chat's default LLM provider at request time (spec 019): the settings store wins, else
// the EXPLORER_DEFAULT_* env (the seed/fallback), else null (→ the existing provider_unconfigured
// error). Pure + synchronous so it can run per request and be unit-tested without a live anything.

import type { PlatformSettingsRepo } from '../../../../src/store/repos/platform-settings.ts';
import { type ServerDefault, serverDefaultFromEnv } from '../chat/providers.ts';
import { LLM_SETTING_KEY, llmSettingSchema } from './settings-schema.ts';

export function resolveServerDefault(
  settings: PlatformSettingsRepo,
  env: NodeJS.ProcessEnv = process.env,
): ServerDefault | null {
  const raw = settings.get(LLM_SETTING_KEY);
  if (raw != null) {
    const v = llmSettingSchema.parse(raw);
    return {
      kind: v.kind,
      model: v.model,
      baseUrl: v.baseUrl ?? undefined,
      apiKey: v.apiKey ?? undefined,
    };
  }
  return serverDefaultFromEnv(env);
}
