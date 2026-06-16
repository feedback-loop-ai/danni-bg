// POST /api/chat — backend-mediated, grounded, streaming chat (T049). SSE event types per
// contracts/http-api.md: session, token, tool, citations, anchors, done, error. The browser never
// calls the LLM or the mirror tools directly (FR-016). Provider/secret handling lives in the
// provider seam; secrets are never logged (FR-024).

import type { LanguageModel, ModelMessage } from 'ai';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { runChatTurn } from '../chat/run.ts';
import { MAX_CONTEXT_DATASETS, type SessionStore, windowMessages } from '../chat/session.ts';
import { log } from '../logging.ts';
import type { ReadBridge } from '../read-bridge.ts';
import { scopeDescriptorSchema } from '../schemas.ts';
import { type ProviderConfig, ProviderError, providerConfigSchema } from './../chat/providers.ts';

export const chatRequestSchema = z
  .object({
    sessionId: z.string().nullable().optional(),
    message: z.string().min(1),
    scope: scopeDescriptorSchema.optional(),
    /**
     * Datasets to ground the turn in (their rows are injected as context) WITHOUT restricting tool
     * scope — e.g. the dataset currently open in the reader. Distinct from `scope.datasetIds`, which
     * is a hard focus that also narrows what tools may read.
     */
    groundingDatasetIds: z.array(z.string()).optional(),
    provider: providerConfigSchema,
  })
  .strict();

export interface ChatRouteDeps {
  bridge: ReadBridge;
  sessions: SessionStore;
  selectModel: (provider: ProviderConfig) => LanguageModel;
}

export function chatHandler(deps: ChatRouteDeps) {
  return async (c: Context): Promise<Response> => {
    let body: z.infer<typeof chatRequestSchema>;
    try {
      body = chatRequestSchema.parse(await c.req.json());
    } catch (e) {
      return c.json(
        { error: { code: 'bad_request', message: 'invalid chat request', details: String(e) } },
        400,
      );
    }

    const conv = deps.sessions.getOrCreate(body.sessionId ?? null);
    deps.sessions.append(conv.sessionId, { role: 'user', content: body.message });
    const scope = body.scope ?? {};
    // Grounding precedence (row injection only — never narrows tool scope): an explicit hard focus
    // (scope.datasetIds) > the dataset open in the reader (body.groundingDatasetIds) > whatever the
    // conversation was already about (sticky session context from the previous turn).
    const explicitFocus = scope.datasetIds ?? [];
    const readerFocus = body.groundingDatasetIds ?? [];
    const groundingDatasetIds =
      explicitFocus.length > 0
        ? explicitFocus
        : readerFocus.length > 0
          ? readerFocus
          : conv.contextDatasetIds;

    // Resolve the model up front so provider misconfig becomes a clean error event (FR-023).
    let model: LanguageModel;
    try {
      model = deps.selectModel(body.provider);
    } catch (e) {
      const code = e instanceof ProviderError ? e.code : 'provider_error';
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: 'session',
          data: JSON.stringify({ sessionId: conv.sessionId }),
        });
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code,
            message: e instanceof Error ? e.message : 'provider error',
          }),
        });
      });
    }

    // Replay only the recent window so a long conversation can't overflow the context (grounding
    // rows live in the system prompt, not the transcript).
    const messages: ModelMessage[] = windowMessages(conv.messages).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'session',
        data: JSON.stringify({ sessionId: conv.sessionId }),
      });
      try {
        const result = await runChatTurn({
          model,
          bridge: deps.bridge,
          scope,
          messages,
          groundingDatasetIds,
          events: {
            onToken: (delta) => {
              void stream.writeSSE({ event: 'token', data: JSON.stringify({ delta }) });
            },
            onTool: (name, status) => {
              void stream.writeSSE({ event: 'tool', data: JSON.stringify({ name, status }) });
            },
          },
        });
        await stream.writeSSE({
          event: 'citations',
          data: JSON.stringify({ citations: result.citations }),
        });
        await stream.writeSSE({ event: 'anchors', data: JSON.stringify(result.anchors) });
        await stream.writeSSE({ event: 'done', data: '{}' });
        deps.sessions.append(conv.sessionId, {
          role: 'assistant',
          content: result.text,
          citations: result.citations,
          anchors: result.anchors,
        });
        // Carry grounding forward: the conversation is now "about" the hard-focused dataset(s) if any,
        // else the dataset open in the reader, else whatever this answer cited — so the next
        // follow-up re-injects their rows.
        const nextContext =
          explicitFocus.length > 0
            ? explicitFocus
            : readerFocus.length > 0
              ? readerFocus
              : result.citations.map((cite) => cite.datasetId);
        if (nextContext.length > 0) {
          deps.sessions.setContext(conv.sessionId, nextContext.slice(0, MAX_CONTEXT_DATASETS));
        }
      } catch (e) {
        log.error('chat_turn_failed', { sessionId: conv.sessionId });
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code: 'provider_error',
            message: e instanceof Error ? e.message : 'chat failed',
          }),
        });
      }
    });
  };
}
