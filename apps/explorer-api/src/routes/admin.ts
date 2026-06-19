// Admin platform settings API (spec 019), under requireAuth + requireAdmin. GET returns the current
// settings with the LLM API key MASKED (never raw); PUT validates + persists, treating an empty key
// as "keep existing". The chat's default provider is resolved from these settings per request.

import { Hono } from 'hono';
import type { PlatformSettingsRepo } from '../../../../src/store/repos/platform-settings.ts';
import type { UsersRepo } from '../../../../src/store/repos/users.ts';
import {
  LLM_SETTING_KEY,
  type LlmSetting,
  TOGGLES_SETTING_KEY,
  llmSettingSchema,
  maskApiKey,
  mergeSecret,
  settingsPutSchema,
  togglesSchema,
} from '../admin/settings-schema.ts';
import type { SessionResolver } from '../auth/kratos-session.ts';
import { serverDefaultFromEnv } from '../chat/providers.ts';
import { type AuthEnv, requireAdmin, requireAuth } from '../middleware/require-auth.ts';

function maskedLlm(settings: PlatformSettingsRepo): {
  source: 'settings' | 'env';
  llm: {
    kind: string;
    model: string;
    baseUrl: string | null;
    apiKeyMasked: boolean;
    apiKeyHint: string | null;
  } | null;
} {
  const raw = settings.get(LLM_SETTING_KEY);
  if (raw != null) {
    const v = llmSettingSchema.parse(raw);
    return {
      source: 'settings',
      llm: { kind: v.kind, model: v.model, baseUrl: v.baseUrl ?? null, ...maskApiKey(v.apiKey) },
    };
  }
  const env = serverDefaultFromEnv(process.env);
  if (env) {
    return {
      source: 'env',
      llm: {
        kind: env.kind,
        model: env.model,
        baseUrl: env.baseUrl ?? null,
        ...maskApiKey(env.apiKey),
      },
    };
  }
  return { source: 'env', llm: null };
}

function togglesView(settings: PlatformSettingsRepo): Record<string, unknown> {
  const raw = settings.get(TOGGLES_SETTING_KEY);
  return raw != null ? togglesSchema.parse(raw) : {};
}

export function adminRoutes(
  users: UsersRepo,
  settings: PlatformSettingsRepo,
  resolveSession?: SessionResolver,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use('*', requireAuth(users, resolveSession), requireAdmin);

  app.get('/settings', (c) => {
    const { source, llm } = maskedLlm(settings);
    return c.json({ llm, toggles: togglesView(settings), source });
  });

  app.put('/settings', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'bad_request', message: 'invalid JSON body' } }, 400);
    }
    const parsed = settingsPutSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'bad_request',
            message: 'invalid settings',
            details: parsed.error.flatten(),
          },
        },
        400,
      );
    }
    const by = c.get('user').email;
    if (parsed.data.llm) {
      const existing = settings.get(LLM_SETTING_KEY) as LlmSetting | null;
      const merged: LlmSetting = {
        kind: parsed.data.llm.kind,
        model: parsed.data.llm.model,
        baseUrl: parsed.data.llm.baseUrl ?? null,
        apiKey: mergeSecret(parsed.data.llm.apiKey, existing?.apiKey),
      };
      settings.set(LLM_SETTING_KEY, merged, by);
    }
    if (parsed.data.toggles) settings.set(TOGGLES_SETTING_KEY, parsed.data.toggles, by);
    const { source, llm } = maskedLlm(settings);
    return c.json({ llm, toggles: togglesView(settings), source });
  });

  return app;
}
