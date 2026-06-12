import { describe, expect, it } from 'bun:test';
import { createSSEDecoder, parseEventData } from './sse.ts';

describe('createSSEDecoder', () => {
  it('decodes complete events and buffers partial ones across chunks', () => {
    const dec = createSSEDecoder();
    expect(dec.push('event: session\ndata: {"sessionId":"s1"}\n\n')).toEqual([
      { event: 'session', data: '{"sessionId":"s1"}' },
    ]);
    // split across two chunks
    expect(dec.push('event: token\ndata: {"del')).toEqual([]);
    expect(dec.push('ta":"hi"}\n\n')).toEqual([{ event: 'token', data: '{"delta":"hi"}' }]);
  });

  it('decodes multiple events in one chunk and ignores incomplete blocks', () => {
    const dec = createSSEDecoder();
    const out = dec.push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: 3');
    expect(out).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('skips blocks missing an event line', () => {
    const dec = createSSEDecoder();
    expect(dec.push(': comment only\n\n')).toEqual([]);
  });
});

describe('parseEventData', () => {
  it('parses JSON payloads', () => {
    expect(parseEventData<{ delta: string }>({ event: 'token', data: '{"delta":"x"}' })).toEqual({
      delta: 'x',
    });
  });
});
