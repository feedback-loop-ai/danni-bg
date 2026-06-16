import { describe, expect, it } from 'bun:test';
import {
  type ChatMessage,
  MAX_CONTEXT_DATASETS,
  SessionStore,
  windowMessages,
} from '../src/chat/session.ts';

const msg = (role: 'user' | 'assistant', content: string): ChatMessage => ({ role, content });

describe('windowMessages', () => {
  it('keeps the most recent messages within the count budget, in order', () => {
    const all = Array.from({ length: 20 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `m${i}`));
    const out = windowMessages(all, 5, 1_000_000);
    expect(out).toHaveLength(5);
    expect(out.map((m) => m.content)).toEqual(['m15', 'm16', 'm17', 'm18', 'm19']);
  });

  it('respects the char budget but always keeps at least the last message', () => {
    const all = [msg('user', 'a'.repeat(100)), msg('assistant', 'b'.repeat(100)), msg('user', 'c')];
    const out = windowMessages(all, 50, 50);
    expect(out).toEqual([msg('user', 'c')]); // older two exceed the budget
  });
});

describe('SessionStore sticky context', () => {
  it('carries dataset context across turns, deduped and capped', () => {
    const s = new SessionStore(() => 'sess-1');
    const conv = s.getOrCreate(null);
    expect(conv.contextDatasetIds).toEqual([]);
    s.setContext('sess-1', ['d1', 'd1', 'd2', 'd3']);
    expect(s.get('sess-1')?.contextDatasetIds).toEqual(['d1', 'd2'].slice(0, MAX_CONTEXT_DATASETS));
    // A later turn replaces the context (does not accumulate).
    s.setContext('sess-1', ['d9']);
    expect(s.get('sess-1')?.contextDatasetIds).toEqual(['d9']);
  });
});
