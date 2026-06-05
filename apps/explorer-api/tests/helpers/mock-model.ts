// Shared test helper: build a MockLanguageModelV3 that replays scripted provider stream steps across
// successive doStream calls (one per tool-use loop step). Not a *.test.ts file, so bun test won't run
// it. Used by the chat route tests and the grounding benchmark to drive the loop without a live LLM.

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

export type StreamStep = { stream: ReadableStream<LanguageModelV3StreamPart> };

function streamOf(parts: LanguageModelV3StreamPart[]): StreamStep {
  return { stream: convertArrayToReadableStream(parts) };
}

export const toolCallStep = (toolName: string, input: unknown): StreamStep =>
  streamOf([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'c1', toolName, input: JSON.stringify(input) },
    { type: 'finish', finishReason: 'tool-calls', usage },
  ] as LanguageModelV3StreamPart[]);

export const textStep = (text: string): StreamStep =>
  streamOf([
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: 'stop', usage },
  ] as LanguageModelV3StreamPart[]);

export const emptyStep = (): StreamStep =>
  streamOf([
    { type: 'stream-start', warnings: [] },
    { type: 'finish', finishReason: 'stop', usage },
  ] as LanguageModelV3StreamPart[]);

/** Returns each scripted step on successive doStream calls (throws if the loop overruns the script). */
export function mockModel(steps: StreamStep[]): MockLanguageModelV3 {
  let i = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      const step = steps[i++];
      if (!step) throw new Error('mock model exhausted');
      return step;
    },
  });
}
