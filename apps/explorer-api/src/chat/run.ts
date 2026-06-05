// Chat turn orchestration (T049 core). Runs the AI SDK tool-use loop against the selected model and
// the four scoped tools, streaming text + tool events out via callbacks. After the model finishes,
// it validates the datasets the model relied on into citations (existence + scope) and derives map
// anchors. The model is injected so tests drive it with a stub (Constitution VI) — no live LLM.

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

export async function runChatTurn(opts: RunChatTurnOptions): Promise<ChatTurnResult> {
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

  // No substantive answer → no relevant data found; nothing is grounded, so emit no citations (SC-006).
  if (text.trim() === '') {
    return { text: NO_DATA_REPLY, citations: [], anchors: { geoEntityIds: [], datasetIds: [] } };
  }

  const resolve = (id: string): CuratedDatasetView | null => {
    try {
      return bridge.view(id);
    } catch {
      return null;
    }
  };
  const citations = buildCitations(citedDatasetIds, resolve, (v) => inScope(v, scope));
  const anchors = buildAnchors(citations, resolve);
  return { text, citations, anchors };
}
