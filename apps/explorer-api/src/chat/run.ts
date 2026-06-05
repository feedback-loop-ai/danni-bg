// Chat turn orchestration (T049). Default path: an AI-SDK tool-use loop over the four scoped tools.
// Fallback path (runRagTurn): when the provider can't do tool-calling (many self-hosted vLLM/Gemma
// deployments aren't started with --enable-auto-tool-choice), the backend does the retrieval itself
// and feeds the scoped datasets to the model as context — so grounded chat works with ANY
// OpenAI-compatible model. Either way the model is injected so tests drive it with a stub (no LLM).

import { type LanguageModel, type ModelMessage, stepCountIs, streamText } from 'ai';
import type { CuratedDatasetView } from '../../../../src/read/dataset-view.ts';
import type { ReadBridge } from '../read-bridge.ts';
import type { ScopeDescriptor } from '../schemas.ts';
import {
  type Citation,
  type MapAnchor,
  NO_DATA_REPLY,
  SYSTEM_PROMPT,
  buildAnchors,
  buildCitations,
} from './grounding.ts';
import { inScope } from './scope.ts';
import { buildTools } from './tools.ts';

export interface ChatTurnEvents {
  onToken?: (delta: string) => void;
  onTool?: (name: string, status: 'start' | 'done') => void;
}

export interface ChatTurnResult {
  text: string;
  citations: Citation[];
  anchors: MapAnchor;
}

export interface RunChatTurnOptions {
  model: LanguageModel;
  bridge: ReadBridge;
  scope: ScopeDescriptor;
  messages: ModelMessage[];
  maxSteps?: number;
  events?: ChatTurnEvents;
}

const EMPTY_ANCHOR: MapAnchor = { geoEntityIds: [], datasetIds: [] };
const RAG_LIMIT = 6;

const resolver =
  (bridge: ReadBridge) =>
  (id: string): CuratedDatasetView | null => {
    try {
      return bridge.view(id);
    } catch {
      return null;
    }
  };

/** True when the provider rejected tool-calling (so we should retry without tools). */
export function isToolChoiceUnsupported(error: unknown): boolean {
  const m = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    m.includes('tool choice') ||
    m.includes('tool_choice') ||
    m.includes('enable-auto-tool-choice') ||
    m.includes('does not support tools') ||
    m.includes('tools are not supported')
  );
}

function lastUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') return typeof m.content === 'string' ? m.content : '';
  }
  return '';
}

export async function runChatTurn(opts: RunChatTurnOptions): Promise<ChatTurnResult> {
  try {
    return await runToolLoop(opts);
  } catch (error) {
    if (isToolChoiceUnsupported(error)) return runRagTurn(opts);
    throw error;
  }
}

/** Tool-use loop for providers with native function-calling. */
export async function runToolLoop(opts: RunChatTurnOptions): Promise<ChatTurnResult> {
  const { model, bridge, scope, messages, events } = opts;
  const { tools, citedDatasetIds } = buildTools(bridge, scope);

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: stepCountIs(opts.maxSteps ?? 6),
  });

  let text = '';
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.text;
      events?.onToken?.(part.text);
    } else if (part.type === 'tool-call') {
      events?.onTool?.(part.toolName, 'start');
    } else if (part.type === 'tool-result') {
      events?.onTool?.(part.toolName, 'done');
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }

  if (text.trim() === '') {
    return { text: NO_DATA_REPLY, citations: [], anchors: EMPTY_ANCHOR };
  }
  const resolve = resolver(bridge);
  const citations = buildCitations(citedDatasetIds, resolve, (v) => inScope(v, scope));
  return { text, citations, anchors: buildAnchors(citations, resolve) };
}

/** Retrieval-augmented fallback: the backend retrieves scoped datasets and feeds them as context. */
export async function runRagTurn(opts: RunChatTurnOptions): Promise<ChatTurnResult> {
  const { model, bridge, scope, messages, events } = opts;
  const query = lastUserText(messages);
  const resolve = resolver(bridge);

  // Retrieve scoped candidates ourselves (the model never sees out-of-scope data).
  const hits = await bridge.search(query, undefined, 12);
  const candidates: CuratedDatasetView[] = [];
  for (const hit of hits) {
    const view = resolve(hit.datasetId);
    if (view && inScope(view, scope)) candidates.push(view);
    if (candidates.length >= RAG_LIMIT) break;
  }
  events?.onTool?.('mirrorSearch', 'start');
  events?.onTool?.('mirrorSearch', 'done');

  if (candidates.length === 0) {
    return { text: NO_DATA_REPLY, citations: [], anchors: EMPTY_ANCHOR };
  }

  const context = candidates
    .map(
      (v, i) =>
        `${i + 1}. ${v.title.bg} (id: ${v.datasetId}; издател: ${v.publisher?.title.bg ?? '—'}; ${v.freshness.isStale ? 'остарели' : 'актуални'} данни)`,
    )
    .join('\n');
  const system = `${SYSTEM_PROMPT}\nОтговаряй само въз основа на изброените по-долу набори от данни. Когато използваш набор, посочи неговото id в отговора. Ако никой не е релевантен на въпроса, отговори, че няма релевантни публични данни.`;
  const userMsg = `Налични набори от данни:\n${context}\n\nВъпрос: ${query}`;

  const result = streamText({ model, system, messages: [{ role: 'user', content: userMsg }] });
  let text = '';
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.text;
      events?.onToken?.(part.text);
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }

  if (text.trim() === '') {
    return { text: NO_DATA_REPLY, citations: [], anchors: EMPTY_ANCHOR };
  }
  // Cite the candidates the answer actually referenced (by id or title); fall back to the top hit so a
  // substantive answer always carries ≥1 citation (SC-004). All are retrieved + in-scope (SC-005/008).
  const mentioned = candidates.filter(
    (v) => text.includes(v.datasetId) || text.includes(v.title.bg),
  );
  const chosen = mentioned.length > 0 ? mentioned : candidates.slice(0, 1);
  const citations = buildCitations(
    chosen.map((v) => v.datasetId),
    resolve,
    (v) => inScope(v, scope),
  );
  return { text, citations, anchors: buildAnchors(citations, resolve) };
}
