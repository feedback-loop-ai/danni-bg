// POST /api/chat — backend-mediated, grounded, streaming chat (T049). SSE event types per
// contracts/http-api.md: session, token, tool, citations, anchors, done, error. The browser never
// calls the LLM or the mirror tools directly (FR-016). Provider/secret handling lives in the
// provider seam; secrets are never logged (FR-024).

import type { LanguageModel, ModelMessage } from 'ai';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { TokenUsageRepo } from '../../../../src/store/repos/token-usage.ts';
import type { UserRow } from '../../../../src/store/repos/users.ts';
import type { GenEvent, GenSnapshot, GenerationManager } from '../chat/generation-manager.ts';
import { billableTokens, effectiveLimit, quotaView } from '../chat/quota.ts';
import { runChatTurn } from '../chat/run.ts';
import { type ConversationStore, MAX_CONTEXT_DATASETS, windowMessages } from '../chat/session.ts';
import { expandGeoUnitIds } from '../geo-rollup.ts';
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
    /** When true, emit a `grounding` SSE event with the exact context injected into the model.
     * For observability / offline faithfulness evals; clients don't set it in normal use. */
    debug: z.boolean().optional(),
  })
  .strict();

export interface ChatRouteDeps {
  bridge: ReadBridge;
  sessions: ConversationStore;
  /** Runs turns detached so they survive a client disconnect (mid-stream resume). */
  generations: GenerationManager;
  selectModel: (provider: ProviderConfig) => LanguageModel;
  /** Per-user token metering (optional; omitted in focused unit tests). */
  usage?: TokenUsageRepo;
  /** Resolve the platform default token quota (0/undefined = unlimited) per request. */
  defaultTokenLimit?: () => number | undefined;
  /** Resolve the cache-hit token weight (0–1) per request; undefined = default. */
  cacheWeight?: () => number | undefined;
  /** Resolve the max output tokens per answer; undefined = built-in default. */
  maxOutputTokens?: () => number | undefined;
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

    // Enforce the per-user token quota up front (token metering): an over-quota user is rejected with
    // 429 before any model work. `user` is set by requireAuth; metering is skipped if no repo is wired.
    const user = c.get('user') as UserRow | undefined;
    if (deps.usage && user) {
      const limit = effectiveLimit(user.token_limit, deps.defaultTokenLimit?.());
      const { used, cached } = deps.usage.usageForUser(user.id, user.usage_reset_at);
      const billable = billableTokens(used, cached, deps.cacheWeight?.());
      if (quotaView(billable, limit).exceeded) {
        return c.json(
          {
            error: {
              code: 'quota_exceeded',
              message: 'token quota exceeded',
              details: { used: billable, limit },
            },
          },
          429,
        );
      }
    }

    const conv = deps.sessions.getOrCreate(body.sessionId ?? null, user?.id ?? '');
    // Snapshot the prior transcript BEFORE appending this turn's question: the persistent store's
    // `append` doesn't mutate the returned snapshot (unlike the in-memory one), so build the model's
    // message list from prior history + the new question explicitly.
    const priorMessages = [...conv.messages];
    deps.sessions.append(conv.sessionId, { role: 'user', content: body.message });
    const rawScope = body.scope ?? {};
    // Expand an oblast geo-scope to its municipalities (mirrors the explorer list + the choropleth
    // roll-up, spec 013): scoping chat to Стара Загора must see its municipalities' datasets too,
    // both for the hard scope filter (inScope) and the geo fallback that pulls a region's datasets.
    const scope =
      rawScope.geoUnitIds && rawScope.geoUnitIds.length > 0
        ? {
            ...rawScope,
            geoUnitIds: expandGeoUnitIds(rawScope.geoUnitIds, deps.bridge.partOfChildren()),
          }
        : rawScope;
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
    const modelId =
      typeof model === 'string' ? model : ((model as { modelId?: string }).modelId ?? null);
    const maxOut = deps.maxOutputTokens?.();

    // Replay only the recent window so a long conversation can't overflow the context (grounding
    // rows live in the system prompt, not the transcript).
    const messages: ModelMessage[] = windowMessages([
      ...priorMessages,
      { role: 'user', content: body.message },
    ]).map((m) => ({ role: m.role, content: m.content }));

    // Run the turn DETACHED via the generation manager so a client disconnect/reload doesn't kill it
    // (mid-stream resume). The SSE below just subscribes to the live generation.
    const messageId = crypto.randomUUID();
    deps.generations.start({
      messageId,
      sessionId: conv.sessionId,
      userId: user?.id ?? '',
      run: async (h, signal) => {
        const startedAt = Date.now();
        const result = await runChatTurn({
          model,
          bridge: deps.bridge,
          scope,
          messages,
          groundingDatasetIds,
          abortSignal: signal,
          ...(maxOut ? { maxOutputTokens: maxOut } : {}),
          events: { onToken: h.onToken, onTool: h.onTool, onUsage: h.onUsage },
        });
        const durationMs = Date.now() - startedAt;
        if (body.debug && result.groundingText) h.onGrounding(result.groundingText);
        h.onCitations(result.citations);
        h.onAnchors(result.anchors);
        // Persist the reply, meter usage, and carry grounding forward — all before 'done' fires, so a
        // reload immediately after completion finds the saved assistant message. Keep per-message token
        // usage + reply duration so the chat shows "tokens consumed" + "how long it took" on reload.
        deps.sessions.append(conv.sessionId, {
          role: 'assistant',
          content: result.text,
          citations: result.citations,
          anchors: result.anchors,
          ...(result.usage
            ? {
                usage: {
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  cachedInputTokens: result.usage.cachedInputTokens,
                },
              }
            : {}),
          durationMs,
        });
        if (deps.usage && user && result.usage) {
          deps.usage.record({
            userId: user.id,
            sessionId: conv.sessionId,
            model: modelId,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
          });
        }
        const nextContext =
          explicitFocus.length > 0
            ? explicitFocus
            : readerFocus.length > 0
              ? readerFocus
              : result.citations.map((cite) => cite.datasetId);
        if (nextContext.length > 0) {
          deps.sessions.setContext(conv.sessionId, nextContext.slice(0, MAX_CONTEXT_DATASETS));
        }
      },
    });

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'session',
        data: JSON.stringify({ sessionId: conv.sessionId }),
      });
      await stream.writeSSE({ event: 'message', data: JSON.stringify({ messageId }) });
      await streamGeneration(stream, deps.generations, messageId);
    });
  };
}

/** Forward a generation's events (snapshot replay + live) to an SSE stream until it ends. Shared by
 * the initial POST and the reconnect endpoint. */
export async function streamGeneration(
  stream: { writeSSE: (m: { event: string; data: string }) => unknown },
  generations: GenerationStream,
  messageId: string,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const sub = generations.subscribe(messageId, (e) => {
      forwardEvent(stream, e);
      if (e.type === 'done' || e.type === 'error') {
        sub?.unsubscribe();
        resolve();
      }
    });
    if (!sub) {
      // Generation already evicted — nothing live to attach to.
      void stream.writeSSE({ event: 'done', data: '{}' });
      resolve();
      return;
    }
    // Replay what's already been produced (for reconnects), then live events flow via the listener.
    const s = sub.snapshot;
    if (s.text) void stream.writeSSE({ event: 'token', data: JSON.stringify({ delta: s.text }) });
    if (s.citations)
      void stream.writeSSE({
        event: 'citations',
        data: JSON.stringify({ citations: s.citations }),
      });
    if (s.anchors) void stream.writeSSE({ event: 'anchors', data: JSON.stringify(s.anchors) });
    if (s.usage) void stream.writeSSE({ event: 'usage', data: JSON.stringify(s.usage) });
    if (s.status === 'done') {
      void stream.writeSSE({ event: 'done', data: '{}' });
      sub.unsubscribe();
      resolve();
    } else if (s.status === 'error') {
      void stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ code: 'provider_error', message: s.error ?? 'chat failed' }),
      });
      sub.unsubscribe();
      resolve();
    }
  });
}

/** Minimal view of the manager that streamGeneration needs (eases testing). */
export interface GenerationStream {
  subscribe(
    messageId: string,
    listener: (e: GenEvent) => void,
  ): { snapshot: GenSnapshot; unsubscribe: () => void } | null;
}

function forwardEvent(
  stream: { writeSSE: (m: { event: string; data: string }) => unknown },
  e: GenEvent,
): void {
  if (e.type === 'token')
    void stream.writeSSE({ event: 'token', data: JSON.stringify({ delta: e.delta }) });
  else if (e.type === 'tool')
    void stream.writeSSE({
      event: 'tool',
      data: JSON.stringify({ name: e.name, status: e.status }),
    });
  else if (e.type === 'citations')
    void stream.writeSSE({ event: 'citations', data: JSON.stringify({ citations: e.citations }) });
  else if (e.type === 'anchors')
    void stream.writeSSE({ event: 'anchors', data: JSON.stringify(e.anchors) });
  else if (e.type === 'grounding')
    void stream.writeSSE({ event: 'grounding', data: JSON.stringify({ text: e.text }) });
  else if (e.type === 'usage')
    void stream.writeSSE({ event: 'usage', data: JSON.stringify(e.usage) });
  else if (e.type === 'done') void stream.writeSSE({ event: 'done', data: '{}' });
  else if (e.type === 'error')
    void stream.writeSSE({
      event: 'error',
      data: JSON.stringify({ code: 'provider_error', message: e.message }),
    });
}
